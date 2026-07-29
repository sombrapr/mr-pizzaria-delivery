'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { JsonStore } = require('./src/store');
const { ORDER_STATUSES, buildOrder, normalizePhone, asMoney } = require('./src/domain');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadLocalEnv();

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const store = new JsonStore(process.env.DATA_FILE || './data/mr-delivery.json');

function saoPauloDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function secureCompare(a, b) {
  const one = Buffer.from(String(a || ''));
  const two = Buffer.from(String(b || ''));
  return one.length === two.length && one.length > 0 && crypto.timingSafeEqual(one, two);
}

function authorized(req, envName, headerName) {
  const expected = process.env[envName];
  if (!expected && process.env.NODE_ENV !== 'production') return true;
  return secureCompare(req.headers[headerName.toLowerCase()], expected);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function unauthorized(res) {
  sendJson(res, 401, { error: 'Acesso não autorizado.' });
}

async function readJson(req, limitBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limitBytes) {
      const error = new Error('O conteúdo enviado é muito grande.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('JSON inválido.');
    error.statusCode = 400;
    throw error;
  }
}

function upsertCustomer(data, order) {
  if (!order.customerPhone) return null;
  let customer = data.customers.find((item) => item.phone === order.customerPhone);
  if (!customer) {
    customer = {
      id: crypto.randomUUID(),
      name: order.customerName,
      phone: order.customerPhone,
      addresses: [],
      orderCount: 0,
      totalSpent: 0,
      firstOrderAt: order.createdAt,
      lastOrderAt: order.createdAt
    };
    data.customers.push(customer);
  }
  customer.name = order.customerName || customer.name;
  customer.orderCount += 1;
  customer.totalSpent = asMoney(customer.totalSpent + order.total);
  if (!customer.firstOrderAt || order.createdAt < customer.firstOrderAt) customer.firstOrderAt = order.createdAt;
  if (!customer.lastOrderAt || order.createdAt > customer.lastOrderAt) customer.lastOrderAt = order.createdAt;
  if (order.addressText && !customer.addresses.includes(order.addressText)) {
    customer.addresses.unshift(order.addressText);
    customer.addresses = customer.addresses.slice(0, 5);
  }
  order.customerId = customer.id;
  return customer;
}

async function createOrder(payload, sourceOverride, options = {}) {
  return store.write((data) => {
    const number = Number(data.meta.nextOrderNumber || 101);
    data.meta.nextOrderNumber = number + 1;
    const order = buildOrder(payload, number, data.settings, sourceOverride);
    if (options.preserveHistory) {
      const historicalDate = new Date(payload.createdAt || '');
      if (!Number.isNaN(historicalDate.getTime())) {
        order.createdAt = historicalDate.toISOString();
        order.updatedAt = order.createdAt;
        order.timeline = [{ status: ORDER_STATUSES.includes(payload.status) ? payload.status : 'Finalizado', at: order.createdAt, by: 'IMPORTACAO' }];
      }
      if (ORDER_STATUSES.includes(payload.status)) order.status = payload.status;
      else order.status = 'Finalizado';
      if (['Finalizado', 'Cancelado'].includes(order.status)) order.closedAt = order.updatedAt;
      order.importedLegacyNumber = payload.number || null;
    }
    upsertCustomer(data, order);
    data.orders.unshift(order);
    return order;
  });
}

function idFrom(pathname, suffix = '') {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pathname.match(new RegExp(`^/api/orders/([^/]+)${escaped}$`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    const state = await store.read((data) => ({ orders: data.orders.length, version: data.meta.version }));
    return sendJson(res, 200, { ok: true, service: 'MR Delivery', ...state, now: new Date().toISOString() });
  }

  if (method === 'GET' && pathname === '/api/catalog') {
    const result = await store.read((data) => ({ settings: data.settings, catalog: data.catalog }));
    return sendJson(res, 200, result);
  }

  if (method === 'PUT' && pathname === '/api/catalog') {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const body = await readJson(req);
    const result = await store.write((data) => {
      if (body.settings) data.settings = { ...data.settings, ...body.settings };
      if (body.catalog) data.catalog = { ...data.catalog, ...body.catalog };
      return { settings: data.settings, catalog: data.catalog };
    });
    return sendJson(res, 200, result);
  }

  if (method === 'GET' && pathname === '/api/orders') {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const status = String(searchParams.get('status') || '').trim();
    const source = String(searchParams.get('source') || '').trim().toUpperCase();
    const serviceType = String(searchParams.get('serviceType') || '').trim().toUpperCase();
    const search = String(searchParams.get('search') || '').trim().toLowerCase();
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200)));
    const orders = await store.read((data) => data.orders
      .filter((order) => !status || order.status === status)
      .filter((order) => !source || order.source === source)
      .filter((order) => !serviceType || order.serviceType === serviceType)
      .filter((order) => !search || [order.number, order.customerName, order.customerPhone, order.addressText].join(' ').toLowerCase().includes(search))
      .slice(0, limit));
    return sendJson(res, 200, { orders });
  }

  if (method === 'POST' && pathname === '/api/orders') {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const body = await readJson(req);
    const order = await createOrder(body, body.source || 'BALCAO');
    return sendJson(res, 201, { order });
  }

  if (method === 'POST' && pathname === '/api/integrations/whatsapp/orders') {
    if (!authorized(req, 'WHATSAPP_INTERNAL_KEY', 'x-whatsapp-key')) return unauthorized(res);
    const body = await readJson(req);
    const order = await createOrder(body, 'WHATSAPP');
    return sendJson(res, 201, { order });
  }

  if (method === 'GET' && pathname === '/api/customers') {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const search = String(searchParams.get('search') || '').trim().toLowerCase();
    const customers = await store.read((data) => data.customers
      .filter((customer) => !search || [customer.name, customer.phone].join(' ').toLowerCase().includes(search))
      .sort((a, b) => new Date(b.lastOrderAt) - new Date(a.lastOrderAt)));
    return sendJson(res, 200, { customers });
  }

  const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (method === 'GET' && customerMatch) {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const phone = normalizePhone(decodeURIComponent(customerMatch[1]));
    const result = await store.read((data) => {
      const customer = data.customers.find((item) => item.phone === phone);
      const orders = customer ? data.orders.filter((order) => order.customerId === customer.id).slice(0, 20) : [];
      return { customer, orders };
    });
    if (!result.customer) return sendJson(res, 404, { error: 'Cliente não encontrado.' });
    return sendJson(res, 200, result);
  }

  if (method === 'GET' && pathname === '/api/reports/summary') {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const date = String(searchParams.get('date') || saoPauloDateKey());
    const report = await store.read((data) => {
      const dayOrders = data.orders.filter((order) => saoPauloDateKey(order.createdAt) === date && order.status !== 'Cancelado');
      const revenue = asMoney(dayOrders.reduce((sum, order) => sum + order.total, 0));
      const itemCount = new Map();
      dayOrders.forEach((order) => order.items.forEach((item) => itemCount.set(item.name, (itemCount.get(item.name) || 0) + item.qty)));
      const topItems = [...itemCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, qty]) => ({ name, qty }));
      return {
        date,
        orders: dayOrders.length,
        finalized: dayOrders.filter((order) => order.status === 'Finalizado').length,
        revenue,
        averageTicket: dayOrders.length ? asMoney(revenue / dayOrders.length) : 0,
        deliveryOrders: dayOrders.filter((order) => order.serviceType === 'DELIVERY').length,
        pickupOrders: dayOrders.filter((order) => order.serviceType === 'PICKUP').length,
        whatsappOrders: dayOrders.filter((order) => order.source === 'WHATSAPP').length,
        topItems
      };
    });
    return sendJson(res, 200, report);
  }

  if (method === 'GET' && pathname === '/api/print-queue') {
    if (!authorized(req, 'PRINT_API_KEY', 'x-api-key')) return unauthorized(res);
    const jobs = await store.read((data) => {
      const result = [];
      for (const order of data.orders) {
        if (['Finalizado', 'Cancelado'].includes(order.status)) continue;
        if (!order.prints?.pizza && order.items.some((item) => item.type === 'pizza')) result.push({ type: 'pizza', order });
        if (!order.prints?.kitchen && order.items.some((item) => item.type !== 'pizza')) result.push({ type: 'kitchen', order });
      }
      return result.slice(0, 50);
    });
    return sendJson(res, 200, { jobs });
  }

  if (method === 'POST' && pathname === '/api/import/orders') {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const body = await readJson(req);
    const sourceOrders = Array.isArray(body) ? body : body.orders;
    if (!Array.isArray(sourceOrders)) return sendJson(res, 400, { error: 'Envie uma lista de pedidos.' });
    const imported = [];
    for (const legacy of sourceOrders.slice(0, 5000).reverse()) {
      const order = await createOrder({ ...legacy, source: legacy.source || 'BALCAO' }, legacy.source || 'BALCAO', { preserveHistory: true });
      imported.push(order.number);
    }
    return sendJson(res, 201, { imported: imported.length, orderNumbers: imported });
  }

  const statusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const body = await readJson(req);
    const status = String(body.status || '').trim();
    if (!ORDER_STATUSES.includes(status)) return sendJson(res, 400, { error: 'Status inválido.' });
    const id = decodeURIComponent(statusMatch[1]);
    const order = await store.write((data) => {
      const found = data.orders.find((item) => item.id === id || String(item.number) === id);
      if (!found) return null;
      found.status = status;
      found.updatedAt = new Date().toISOString();
      if (status === 'Finalizado' || status === 'Cancelado') found.closedAt = found.updatedAt;
      found.timeline.push({ status, at: found.updatedAt, by: String(body.by || 'PAINEL') });
      return found;
    });
    if (!order) return sendJson(res, 404, { error: 'Pedido não encontrado.' });
    return sendJson(res, 200, { order });
  }

  const paymentMatch = pathname.match(/^\/api\/orders\/([^/]+)\/payment$/);
  if (method === 'PATCH' && paymentMatch) {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const body = await readJson(req);
    const id = decodeURIComponent(paymentMatch[1]);
    const order = await store.write((data) => {
      const found = data.orders.find((item) => item.id === id || String(item.number) === id);
      if (!found) return null;
      if (body.paymentMethod) {
        found.paymentMethod = String(body.paymentMethod);
        found.payment = found.paymentMethod;
      }
      if (body.paymentStatus) found.paymentStatus = String(body.paymentStatus);
      found.updatedAt = new Date().toISOString();
      return found;
    });
    if (!order) return sendJson(res, 404, { error: 'Pedido não encontrado.' });
    return sendJson(res, 200, { order });
  }

  const printedMatch = pathname.match(/^\/api\/orders\/([^/]+)\/printed$/);
  if (method === 'POST' && printedMatch) {
    if (!authorized(req, 'PRINT_API_KEY', 'x-api-key')) return unauthorized(res);
    const body = await readJson(req);
    const type = body.type === 'pizza' ? 'pizza' : 'kitchen';
    const number = decodeURIComponent(printedMatch[1]);
    const order = await store.write((data) => {
      const found = data.orders.find((item) => String(item.number) === number);
      if (!found) return null;
      found.prints = found.prints || { pizza: null, kitchen: null, complete: null };
      found.prints[type] = new Date().toISOString();
      found.updatedAt = new Date().toISOString();
      return found;
    });
    if (!order) return sendJson(res, 404, { error: 'Pedido não encontrado.' });
    return sendJson(res, 200, { ok: true, orderNumber: order.number, type });
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (method === 'GET' && orderMatch) {
    if (!authorized(req, 'ADMIN_API_KEY', 'x-admin-key')) return unauthorized(res);
    const id = decodeURIComponent(orderMatch[1]);
    const order = await store.read((data) => data.orders.find((item) => item.id === id || String(item.number) === id));
    if (!order) return sendJson(res, 404, { error: 'Pedido não encontrado.' });
    return sendJson(res, 200, { order });
  }

  return sendJson(res, 404, { error: 'Rota não encontrada.' });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function serveStatic(res, pathname) {
  let requested = pathname === '/' ? '/index.html' : pathname === '/admin' ? '/admin.html' : pathname;
  requested = decodeURIComponent(requested);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: 'Acesso negado.' });
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not-file');
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'Arquivo não encontrado.' });
  }
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (['GET', 'HEAD'].includes(req.method || 'GET')) await serveStatic(res, url.pathname);
    else sendJson(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    console.error(error);
    const status = Number(error.statusCode || 500);
    sendJson(res, status, { error: status >= 500 ? 'Erro interno do sistema.' : error.message });
  }
});

store.init()
  .then(() => server.listen(port, () => console.log(`MR Delivery disponível na porta ${port}`)))
  .catch((error) => {
    console.error('Falha ao iniciar o banco:', error);
    process.exit(1);
  });
