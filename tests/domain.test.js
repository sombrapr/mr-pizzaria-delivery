'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, buildOrder } = require('../src/domain');

const settings = { deliveryFee: 7 };

test('normaliza telefone brasileiro', () => {
  assert.equal(normalizePhone('(44) 99999-9999'), '5544999999999');
  assert.equal(normalizePhone('+55 44 99999-9999'), '5544999999999');
});

test('calcula pedido delivery', () => {
  const order = buildOrder({
    customerName: 'Cliente Teste',
    customerPhone: '44999999999',
    serviceType: 'DELIVERY',
    address: { street: 'Rua A', number: '10', district: 'Centro' },
    items: [{ name: 'Pizza Grande', type: 'pizza', qty: 2, unitPrice: 80 }],
    paymentMethod: 'Pix'
  }, 101, settings, 'WHATSAPP');

  assert.equal(order.subtotal, 160);
  assert.equal(order.deliveryFee, 7);
  assert.equal(order.total, 167);
  assert.equal(order.source, 'WHATSAPP');
  assert.equal(order.deliveryType, 'Entrega');
});

test('exige endereço no delivery', () => {
  assert.throws(() => buildOrder({
    customerName: 'Cliente', customerPhone: '44999999999', serviceType: 'DELIVERY',
    items: [{ name: 'X-Burger', qty: 1, unitPrice: 18 }]
  }, 101, settings), /rua, número e bairro/i);
});
