'use strict';

/**
 * Use este trecho no ponto em que o cliente confirma o pedido no robô.
 * O pedido precisa estar completo antes do envio.
 */
async function enviarPedidoAoDelivery(pedido) {
  const response = await fetch(`${process.env.DELIVERY_API_URL}/api/integrations/whatsapp/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-whatsapp-key': process.env.WHATSAPP_INTERNAL_KEY
    },
    body: JSON.stringify({
      customerName: pedido.customerName,
      customerPhone: pedido.customerPhone,
      serviceType: pedido.delivery ? 'DELIVERY' : 'PICKUP',
      address: pedido.delivery ? pedido.address : null,
      items: pedido.items,
      paymentMethod: pedido.payment,
      changeFor: pedido.changeFor,
      note: pedido.note,
      createdBy: 'ROBO_WHATSAPP'
    })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Falha ao registrar o pedido.');
  return result.order;
}

module.exports = { enviarPedidoAoDelivery };
