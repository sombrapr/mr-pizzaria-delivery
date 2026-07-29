'use strict';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const STATUS_FLOW = ['Novo', 'Aceito', 'Em preparo', 'Pronto', 'Saiu para entrega'];
function saoPauloDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
const state = {
  apiKey: localStorage.getItem('mr_admin_key') || '',
  catalog: null,
  orders: [],
  customers: [],
  cart: [],
  activeCategory: 'Lanches',
  currentView: 'dashboard',
  polling: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('error-toast', isError);
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state.apiKey) headers['x-admin-key'] = state.apiKey;
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.error || 'Falha na comunicação com o sistema.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function showLogin(visible) {
  $('#login').classList.toggle('hidden', !visible);
}

async function login(key) {
  state.apiKey = key.trim();
  await api('/api/orders?limit=1');
  localStorage.setItem('mr_admin_key', state.apiKey);
  showLogin(false);
  await initialize();
}

async function initialize() {
  try {
    $('#syncStatus').textContent = 'Sincronizando…';
    const [catalog, orders, customers] = await Promise.all([
      api('/api/catalog'),
      api('/api/orders?limit=300'),
      api('/api/customers')
    ]);
    state.catalog = catalog;
    state.orders = orders.orders;
    state.customers = customers.customers;
    hydrateCatalog();
    renderOrders();
    renderCustomers();
    renderCart();
    await loadReport();
    $('#syncStatus').textContent = 'Online';
    startPolling();
  } catch (error) {
    $('#syncStatus').textContent = 'Sem conexão';
    if (error.status === 401) {
      localStorage.removeItem('mr_admin_key');
      state.apiKey = '';
      showLogin(true);
    } else {
      toast(error.message, true);
    }
  }
}

function startPolling() {
  clearInterval(state.polling);
  state.polling = setInterval(async () => {
    if (document.hidden || state.currentView !== 'dashboard') return;
    try {
      const result = await api('/api/orders?limit=300');
      const previousTop = state.orders[0]?.number;
      state.orders = result.orders;
      renderOrders();
      if (state.orders[0]?.number && state.orders[0].number !== previousTop) toast(`Novo pedido nº ${state.orders[0].number}`);
      $('#syncStatus').textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      $('#syncStatus').textContent = 'Falha ao atualizar';
    }
  }, 4000);
}

function orderMatchesSearch(order) {
  const search = $('#orderSearch').value.trim().toLowerCase();
  if (!search) return true;
  return [order.number, order.customerName, order.customerPhone, order.addressText]
    .join(' ').toLowerCase().includes(search);
}

function renderOrders() {
  const visible = state.orders.filter(orderMatchesSearch);
  $('#kpiNew').textContent = visible.filter((order) => order.status === 'Novo').length;
  $('#kpiProduction').textContent = visible.filter((order) => ['Aceito', 'Em preparo'].includes(order.status)).length;
  $('#kpiReady').textContent = visible.filter((order) => ['Pronto', 'Saiu para entrega'].includes(order.status)).length;
  const today = saoPauloDateKey();
  const sales = state.orders.filter((order) => saoPauloDateKey(order.createdAt) === today && order.status !== 'Cancelado').reduce((sum, order) => sum + order.total, 0);
  $('#kpiSales').textContent = BRL.format(sales);

  $('#kanban').innerHTML = STATUS_FLOW.map((status) => {
    const orders = visible.filter((order) => order.status === status);
    return `<section class="column"><div class="column-head"><span>${esc(status)}</span><span class="count">${orders.length}</span></div>${orders.map(orderCard).join('') || '<div class="cart-empty">Nenhum pedido</div>'}</section>`;
  }).join('');

  const finished = visible.filter((order) => ['Finalizado', 'Cancelado'].includes(order.status)).slice(0, 30);
  $('#finishedOrders').innerHTML = finished.map(orderCard).join('') || '<div class="cart-empty">Nenhum pedido finalizado.</div>';
}

function orderCard(order) {
  const items = order.items.slice(0, 4).map((item) => `<div>${item.qty}x ${esc(item.name)}</div>`).join('');
  const more = order.items.length > 4 ? `<div>+ ${order.items.length - 4} item(ns)</div>` : '';
  const delivery = order.serviceType === 'DELIVERY' ? `Entrega · ${esc(order.addressText || '')}` : order.serviceType === 'PICKUP' ? 'Retirada no balcão' : `Mesa ${esc(order.tableNumber || '')}`;
  return `<article class="order-card" data-status="${esc(order.status)}">
    <div class="order-top"><span class="order-number">#${order.number}</span><span class="source-badge">${esc(order.source)}</span></div>
    <div class="order-customer">${esc(order.customerName)}</div>
    <div class="order-meta">${esc(order.customerPhone || '')} · ${DATE_TIME.format(new Date(order.createdAt))}</div>
    <div class="order-meta">${delivery}</div>
    <div class="order-items">${items}${more}${order.note ? `<div><strong>Obs.:</strong> ${esc(order.note)}</div>` : ''}</div>
    <div class="order-total"><span>${esc(order.paymentMethod)}</span><span>${BRL.format(order.total)}</span></div>
    <div class="order-actions">
      <select data-status-order="${order.id}">${['Novo','Aceito','Em preparo','Pronto','Saiu para entrega','Finalizado','Cancelado'].map((status) => `<option ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select>
      <button class="btn secondary small" data-copy-order="${order.id}">Copiar</button>
    </div>
  </article>`;
}

async function changeStatus(orderId, status) {
  try {
    const result = await api(`/api/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    const index = state.orders.findIndex((order) => order.id === orderId);
    if (index >= 0) state.orders[index] = result.order;
    renderOrders();
    toast(`Pedido nº ${result.order.number}: ${status}`);
  } catch (error) {
    toast(error.message, true);
    await refreshOrders();
  }
}

function customerMessage(order) {
  const lines = [
    `🍕 *MR Pizzaria — Pedido nº ${order.number}*`, '',
    ...order.items.map((item) => `• ${item.qty}x ${item.name}${item.border && item.border !== 'Sem borda' ? ` — ${item.border}` : ''}${item.note ? ` (${item.note})` : ''} — ${BRL.format(item.total)}`),
    '', `Subtotal: ${BRL.format(order.subtotal)}`, `Entrega: ${BRL.format(order.deliveryFee)}`, `*Total: ${BRL.format(order.total)}*`, '',
    order.serviceType === 'DELIVERY' ? `Entrega: ${order.addressText}` : 'Retirada: Av. Paraná, 897, Centro, Loanda - PR',
    `Pagamento: ${order.paymentMethod}${order.changeFor ? ` — troco para ${BRL.format(order.changeFor)}` : ''}`,
    'Previsão: 40 a 60 minutos.', '', 'Pedido recebido! ✅'
  ];
  return lines.join('\n');
}

async function copyOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  await navigator.clipboard.writeText(customerMessage(order));
  toast('Mensagem do pedido copiada.');
}

async function refreshOrders() {
  const result = await api('/api/orders?limit=300');
  state.orders = result.orders;
  renderOrders();
}

function hydrateCatalog() {
  const { settings, catalog } = state.catalog;
  const flavorOptions = catalog.flavors.filter((flavor) => flavor.active !== false).map((flavor) => `<option value="${esc(flavor.name)}">${esc(flavor.name)}${flavor.premium ? ' — especial' : ''}</option>`).join('');
  $('#flavor1').innerHTML = flavorOptions;
  $('#flavor2').innerHTML = `<option value="">Pizza inteira</option>${flavorOptions}`;
  $('#border').innerHTML = settings.borders.map((border) => `<option value="${esc(border.key)}">${esc(border.name)}</option>`).join('');
  state.activeCategory = catalog.products.find((product) => product.active !== false)?.category || '';
  renderProducts();
  updatePizzaPrice();
}

function renderProducts() {
  if (!state.catalog) return;
  const products = state.catalog.catalog.products.filter((product) => product.active !== false);
  const categories = [...new Set(products.map((product) => product.category))];
  if (!categories.includes(state.activeCategory)) state.activeCategory = categories[0] || '';
  $('#categoryTabs').innerHTML = categories.map((category) => `<button type="button" class="${category === state.activeCategory ? 'active' : ''}" data-category="${esc(category)}">${esc(category)}</button>`).join('');
  const search = $('#productSearch').value.trim().toLowerCase();
  $('#productList').innerHTML = products
    .filter((product) => product.category === state.activeCategory)
    .filter((product) => !search || product.name.toLowerCase().includes(search))
    .map((product) => `<article class="product-card"><div><strong>${esc(product.name)}</strong><small>${BRL.format(product.price)}</small></div><button type="button" class="btn primary small" data-product="${esc(product.id)}">Adicionar</button></article>`)
    .join('') || '<div class="cart-empty">Nenhum produto encontrado.</div>';
}

function pizzaUnitPrice() {
  const settings = state.catalog.settings;
  const size = $('#pizzaSize').value;
  const first = state.catalog.catalog.flavors.find((item) => item.name === $('#flavor1').value);
  const second = state.catalog.catalog.flavors.find((item) => item.name === $('#flavor2').value);
  const priceFor = (flavor) => settings.pizzaPrices[flavor?.premium ? 'house' : 'regular'][size];
  let price = priceFor(first);
  if (second) price = (price + priceFor(second)) / 2;
  const border = settings.borders.find((item) => item.key === $('#border').value);
  return Number(price || 0) + Number(border?.prices?.[size] || 0);
}

function updatePizzaPrice() {
  if (!state.catalog) return;
  const size = $('#pizzaSize').value;
  $('#flavor2Wrap').classList.toggle('hidden', size === 'P');
  if (size === 'P') $('#flavor2').value = '';
  $('#pizzaPrice').textContent = BRL.format(pizzaUnitPrice());
}

function addPizza() {
  const size = $('#pizzaSize').value;
  const f1 = $('#flavor1').value;
  const f2 = $('#flavor2').value;
  const borderData = state.catalog.settings.borders.find((item) => item.key === $('#border').value);
  const qty = Math.max(1, Number.parseInt($('#pizzaQty').value, 10) || 1);
  const sizeName = { P: 'Pequena', M: 'Média', G: 'Grande' }[size];
  const flavorsLabel = f2 ? `½ ${f1} / ½ ${f2}` : f1;
  const unitPrice = pizzaUnitPrice();
  state.cart.push({
    id: crypto.randomUUID(), type: 'pizza', category: 'Pizzas', name: `Pizza ${sizeName} — ${flavorsLabel}`,
    size, flavors: [f1, f2].filter(Boolean), border: borderData.name, qty, unitPrice, total: unitPrice * qty,
    note: $('#pizzaNote').value.trim()
  });
  $('#pizzaQty').value = 1;
  $('#pizzaNote').value = '';
  renderCart();
}

function addProduct(productId) {
  const product = state.catalog.catalog.products.find((item) => item.id === productId);
  if (!product) return;
  const existing = state.cart.find((item) => item.type === 'product' && item.name === product.name);
  if (existing) {
    existing.qty += 1;
    existing.total = existing.qty * existing.unitPrice;
  } else {
    state.cart.push({ id: crypto.randomUUID(), type: 'product', category: product.category, name: product.name, qty: 1, unitPrice: product.price, total: product.price, note: '' });
  }
  renderCart();
}

function changeCartQty(itemId, delta) {
  const item = state.cart.find((entry) => entry.id === itemId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter((entry) => entry.id !== itemId);
  else item.total = item.qty * item.unitPrice;
  renderCart();
}

function renderCart() {
  const container = $('#cartItems');
  if (!state.cart.length) {
    container.innerHTML = '<div class="cart-empty">Adicione pizzas ou outros produtos.</div>';
  } else {
    container.innerHTML = state.cart.map((item) => `<article class="cart-item"><div><strong>${esc(item.name)}</strong><small>${BRL.format(item.unitPrice)} cada${item.note ? `<br>${esc(item.note)}` : ''}</small><div class="qty-row"><button type="button" data-qty="-1" data-item="${item.id}">−</button><span>${item.qty}</span><button type="button" data-qty="1" data-item="${item.id}">+</button></div></div><div><strong>${BRL.format(item.total)}</strong><button type="button" class="remove" data-remove="${item.id}">×</button></div></article>`).join('');
  }
  const subtotal = state.cart.reduce((sum, item) => sum + item.total, 0);
  const deliveryFee = $('#serviceType').value === 'DELIVERY' ? Number(state.catalog?.settings?.deliveryFee || 0) : 0;
  $('#subtotal').textContent = BRL.format(subtotal);
  $('#deliveryFee').textContent = BRL.format(deliveryFee);
  $('#total').textContent = BRL.format(subtotal + deliveryFee);
}

function resetOrderForm() {
  state.cart = [];
  $('#orderForm').reset();
  $('#serviceType').value = 'DELIVERY';
  $('#source').value = 'BALCAO';
  $('#pizzaSize').value = 'G';
  $('#pizzaQty').value = 1;
  $('#addressFields').classList.remove('hidden');
  $('#changeWrap').classList.add('hidden');
  hydrateCatalog();
  renderCart();
}

async function submitOrder(event) {
  event.preventDefault();
  if (!state.cart.length) return toast('Adicione pelo menos um item.', true);
  const serviceType = $('#serviceType').value;
  const payload = {
    customerName: $('#customerName').value.trim(),
    customerPhone: $('#customerPhone').value.trim(),
    source: $('#source').value,
    serviceType,
    address: serviceType === 'DELIVERY' ? {
      street: $('#street').value.trim(), number: $('#streetNumber').value.trim(), district: $('#district').value.trim(), reference: $('#reference').value.trim(), city: 'Loanda', state: 'PR'
    } : null,
    items: state.cart,
    paymentMethod: $('#paymentMethod').value,
    changeFor: $('#paymentMethod').value === 'Dinheiro' ? $('#changeFor').value : null,
    note: $('#orderNote').value.trim(),
    createdBy: 'PAINEL'
  };
  try {
    const result = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
    state.orders.unshift(result.order);
    resetOrderForm();
    renderOrders();
    await navigator.clipboard.writeText(customerMessage(result.order)).catch(() => {});
    toast(`Pedido nº ${result.order.number} criado. Mensagem copiada.`);
    switchView('dashboard');
  } catch (error) {
    toast(error.message, true);
  }
}

function renderCustomers() {
  const search = $('#customerSearch').value.trim().toLowerCase();
  $('#customerRows').innerHTML = state.customers
    .filter((customer) => !search || [customer.name, customer.phone].join(' ').toLowerCase().includes(search))
    .map((customer) => `<tr><td><strong>${esc(customer.name)}</strong></td><td>${esc(customer.phone)}</td><td>${customer.orderCount}</td><td>${BRL.format(customer.totalSpent)}</td><td>${DATE_TIME.format(new Date(customer.lastOrderAt))}</td><td>${customer.addresses.slice(0, 2).map((address) => `<div>${esc(address)}</div>`).join('')}</td></tr>`)
    .join('') || '<tr><td colspan="6">Nenhum cliente encontrado.</td></tr>';
}

async function refreshCustomers() {
  const result = await api('/api/customers');
  state.customers = result.customers;
  renderCustomers();
}

async function loadReport() {
  const date = $('#reportDate').value || saoPauloDateKey();
  $('#reportDate').value = date;
  const report = await api(`/api/reports/summary?date=${encodeURIComponent(date)}`);
  $('#reportOrders').textContent = report.orders;
  $('#reportRevenue').textContent = BRL.format(report.revenue);
  $('#reportTicket').textContent = BRL.format(report.averageTicket);
  $('#reportWhatsapp').textContent = report.whatsappOrders;
  $('#topItems').innerHTML = report.topItems.map((item, index) => `<div class="rank-row"><span class="rank-number">${index + 1}</span><strong>${esc(item.name)}</strong><span>${item.qty} un.</span></div>`).join('') || '<div class="cart-empty">Sem vendas nesta data.</div>';
}

async function importOrders() {
  const file = $('#importFile').files[0];
  if (!file) return toast('Escolha o arquivo JSON do painel antigo.', true);
  try {
    const content = JSON.parse(await file.text());
    const result = await api('/api/import/orders', { method: 'POST', body: JSON.stringify(Array.isArray(content) ? content : content.orders) });
    toast(`${result.imported} pedido(s) importado(s).`);
    await Promise.all([refreshOrders(), refreshCustomers(), loadReport()]);
  } catch (error) {
    toast(`Não foi possível importar: ${error.message}`, true);
  }
}

function switchView(view) {
  state.currentView = view;
  $$('.view').forEach((element) => element.classList.toggle('active', element.id === view));
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'customers') refreshCustomers().catch((error) => toast(error.message, true));
  if (view === 'reports') loadReport().catch((error) => toast(error.message, true));
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try { await login($('#adminKey').value); } catch (error) { $('#loginError').textContent = error.status === 401 ? 'Senha incorreta.' : error.message; }
});

$('#logoutBtn').addEventListener('click', () => { localStorage.removeItem('mr_admin_key'); state.apiKey = ''; location.reload(); });
$$('.nav-btn').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#refreshBtn').addEventListener('click', () => refreshOrders().then(() => toast('Pedidos atualizados.')).catch((error) => toast(error.message, true)));
$('#orderSearch').addEventListener('input', renderOrders);
$('#customerSearch').addEventListener('input', renderCustomers);
$('#productSearch').addEventListener('input', renderProducts);
$('#categoryTabs').addEventListener('click', (event) => { const category = event.target.closest('[data-category]')?.dataset.category; if (category) { state.activeCategory = category; renderProducts(); } });
$('#productList').addEventListener('click', (event) => { const id = event.target.closest('[data-product]')?.dataset.product; if (id) addProduct(id); });
$('#cartItems').addEventListener('click', (event) => {
  const qty = event.target.closest('[data-qty]');
  if (qty) changeCartQty(qty.dataset.item, Number(qty.dataset.qty));
  const remove = event.target.closest('[data-remove]');
  if (remove) { state.cart = state.cart.filter((item) => item.id !== remove.dataset.remove); renderCart(); }
});
$('#kanban').addEventListener('change', (event) => { const select = event.target.closest('[data-status-order]'); if (select) changeStatus(select.dataset.statusOrder, select.value); });
$('#finishedOrders').addEventListener('change', (event) => { const select = event.target.closest('[data-status-order]'); if (select) changeStatus(select.dataset.statusOrder, select.value); });
$('#kanban').addEventListener('click', (event) => { const button = event.target.closest('[data-copy-order]'); if (button) copyOrder(button.dataset.copyOrder); });
$('#finishedOrders').addEventListener('click', (event) => { const button = event.target.closest('[data-copy-order]'); if (button) copyOrder(button.dataset.copyOrder); });
['pizzaSize','flavor1','flavor2','border'].forEach((id) => $(`#${id}`).addEventListener('change', updatePizzaPrice));
$('#addPizzaBtn').addEventListener('click', addPizza);
$('#serviceType').addEventListener('change', () => { $('#addressFields').classList.toggle('hidden', $('#serviceType').value !== 'DELIVERY'); renderCart(); });
$('#paymentMethod').addEventListener('change', () => $('#changeWrap').classList.toggle('hidden', $('#paymentMethod').value !== 'Dinheiro'));
$('#clearCartBtn').addEventListener('click', resetOrderForm);
$('#orderForm').addEventListener('submit', submitOrder);
$('#reportDate').addEventListener('change', () => loadReport().catch((error) => toast(error.message, true)));
$('#importBtn').addEventListener('click', importOrders);

document.addEventListener('visibilitychange', () => { if (!document.hidden && state.currentView === 'dashboard' && state.apiKey) refreshOrders().catch(() => {}); });

if (state.apiKey) {
  showLogin(false);
  initialize();
} else {
  showLogin(true);
}
