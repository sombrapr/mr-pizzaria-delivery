'use strict';

const crypto = require('node:crypto');

const ORDER_STATUSES = [
  'Novo',
  'Aceito',
  'Em preparo',
  'Pronto',
  'Saiu para entrega',
  'Finalizado',
  'Cancelado'
];

const SERVICE_TYPES = ['DELIVERY', 'PICKUP', 'TABLE'];
const SOURCES = ['WHATSAPP', 'BALCAO', 'SITE', 'MESA'];

function asMoney(value) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  return digits.length >= 10 ? `55${digits}` : digits;
}

function normalizeAddress(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const street = String(value.street || '').trim();
    const number = String(value.number || '').trim();
    const district = String(value.district || '').trim();
    const reference = String(value.reference || '').trim();
    const city = String(value.city || 'Loanda').trim();
    const state = String(value.state || 'PR').trim();
    return { street, number, district, reference, city, state };
  }

  const text = String(value).trim();
  const parts = text.split(/\s+[—-]\s+/);
  const streetNumber = (parts[0] || '').split(',');
  return {
    street: String(streetNumber[0] || '').trim(),
    number: String(streetNumber.slice(1).join(',') || '').trim(),
    district: String(parts[1] || '').trim(),
    reference: String(parts.slice(2).join(' - ') || '').trim(),
    city: 'Loanda',
    state: 'PR'
  };
}

function addressToText(address) {
  if (!address) return '';
  if (typeof address === 'string') return address;
  return [
    [address.street, address.number].filter(Boolean).join(', '),
    address.district,
    address.reference,
    [address.city, address.state].filter(Boolean).join(' - ')
  ].filter(Boolean).join(' — ');
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const qty = Math.max(1, Number.parseInt(item.qty, 10) || 1);
      const unitPrice = asMoney(item.unitPrice ?? item.unit ?? item.price);
      const type = item.type === 'pizza' ? 'pizza' : 'product';
      return {
        id: item.id || crypto.randomUUID(),
        type,
        category: String(item.category || (type === 'pizza' ? 'Pizzas' : 'Outros')),
        name: String(item.name || '').trim(),
        size: item.size || null,
        flavors: Array.isArray(item.flavors) ? item.flavors.map(String) : [],
        border: item.border || null,
        qty,
        unitPrice,
        unit: unitPrice,
        total: asMoney(unitPrice * qty),
        note: String(item.note || '').trim(),
        productionStation: type === 'pizza' ? 'PIZZA' : 'COZINHA'
      };
    })
    .filter((item) => item.name && item.unitPrice >= 0);
}

function validateOrderPayload(payload) {
  const errors = [];
  const serviceType = String(payload.serviceType || (payload.delivery === false ? 'PICKUP' : 'DELIVERY')).toUpperCase();
  const customerName = String(payload.customerName || payload.customer?.name || '').trim();
  const customerPhone = normalizePhone(payload.customerPhone || payload.customer?.phone);
  const items = normalizeItems(payload.items);
  const address = normalizeAddress(payload.address || payload.deliveryAddress);

  if (!SERVICE_TYPES.includes(serviceType)) errors.push('Tipo de atendimento inválido.');
  if (!customerName && serviceType !== 'TABLE') errors.push('Informe o nome do cliente.');
  if (!customerPhone && serviceType !== 'TABLE') errors.push('Informe o telefone do cliente.');
  if (!items.length) errors.push('Adicione pelo menos um item.');
  if (serviceType === 'DELIVERY' && (!address?.street || !address?.number || !address?.district)) {
    errors.push('Para entrega, informe rua, número e bairro.');
  }
  if (serviceType === 'TABLE' && !String(payload.tableNumber || '').trim()) {
    errors.push('Informe o número da mesa.');
  }

  return { errors, serviceType, customerName, customerPhone, items, address };
}

function buildOrder(payload, number, settings, sourceOverride) {
  const checked = validateOrderPayload(payload);
  if (checked.errors.length) {
    const error = new Error(checked.errors.join(' '));
    error.statusCode = 400;
    throw error;
  }

  const subtotal = asMoney(checked.items.reduce((sum, item) => sum + item.total, 0));
  const deliveryFee = checked.serviceType === 'DELIVERY'
    ? asMoney(payload.deliveryFee ?? settings.deliveryFee ?? 0)
    : 0;
  const total = asMoney(subtotal + deliveryFee);
  const paymentMethod = String(payload.paymentMethod || payload.payment?.method || payload.payment || 'Não informado');
  const changeForRaw = payload.changeFor ?? payload.payment?.changeFor;
  const changeFor = changeForRaw === null || changeForRaw === undefined || changeForRaw === ''
    ? null
    : asMoney(changeForRaw);
  if (paymentMethod === 'Dinheiro' && changeFor !== null && changeFor < total) {
    const error = new Error('O valor informado para troco é menor que o total do pedido.');
    error.statusCode = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const source = String(sourceOverride || payload.source || 'BALCAO').toUpperCase();
  return {
    id: crypto.randomUUID(),
    number,
    createdAt: now,
    updatedAt: now,
    source: SOURCES.includes(source) ? source : 'BALCAO',
    serviceType: checked.serviceType,
    deliveryType: checked.serviceType === 'DELIVERY' ? 'Entrega' : checked.serviceType === 'PICKUP' ? 'Retirada' : 'Mesa',
    customerName: checked.customerName || `Mesa ${String(payload.tableNumber || '').trim()}`,
    customerPhone: checked.customerPhone,
    customerId: null,
    address: checked.address,
    addressText: addressToText(checked.address),
    tableNumber: checked.serviceType === 'TABLE' ? String(payload.tableNumber || '').trim() : null,
    waiterName: checked.serviceType === 'TABLE' ? String(payload.waiterName || '').trim() : null,
    items: checked.items,
    subtotal,
    deliveryFee,
    total,
    payment: paymentMethod,
    paymentMethod,
    paymentStatus: String(payload.paymentStatus || 'Pendente'),
    changeFor,
    note: String(payload.note || '').trim(),
    status: 'Novo',
    prints: { pizza: null, kitchen: null, complete: null },
    timeline: [{ status: 'Novo', at: now, by: String(payload.createdBy || source) }],
    closedAt: null
  };
}

module.exports = {
  ORDER_STATUSES,
  SERVICE_TYPES,
  SOURCES,
  asMoney,
  normalizePhone,
  normalizeAddress,
  addressToText,
  normalizeItems,
  validateOrderPayload,
  buildOrder
};
