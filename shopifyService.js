const axios = require('axios');

const SHOPIFY_URL = `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-01`;

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
  };
}

// ─── Create Order Directly (after successful bKash payment) ───────────────
// This creates a real paid order — no draft order needed
async function createOrder({ lineItems, customerEmail, customerPhone, customerName, shippingAddress, shippingLine, payType, totalAmount, note, amount, trxID }) {
  try {
    const isHalf   = payType === 'half';
    const orderNote = note || `bKash payment confirmed. TrxID: ${trxID}`;
    const tags      = isHalf ? 'bKash, PartPayment, COD' : 'bKash, FullPayment';

    const orderBody = {
      order: {
        line_items: lineItems.map(item => ({
          variant_id: item.variantId,
          quantity:   item.quantity
        })),
        financial_status: 'paid', // always 'paid' — Shopify needs this with transactions
        currency: 'BDT',
        transactions: [
          {
            kind:          'sale',
            status:        'success',
            amount:        amount,
            currency:      'BDT',
            gateway:       'bKash',
            authorization: trxID,
            message:       `bKash payment. TrxID: ${trxID}. Amount: ৳${amount}`
          }
        ],
        note: orderNote,
        tags
      }
    };

    if (customerEmail)   orderBody.order.email = customerEmail;
    if (customerPhone)   orderBody.order.phone = customerPhone;
    if (customerName)    orderBody.order.note_attributes = [{ name: 'Customer Name', value: customerName }];

    if (shippingAddress) {
      // Fill name fields from customerName if not provided
      if (customerName && !shippingAddress.first_name) {
        const parts = customerName.trim().split(' ');
        shippingAddress.first_name = parts[0] || '';
        shippingAddress.last_name  = parts.slice(1).join(' ') || '';
      }
      orderBody.order.shipping_address = shippingAddress;
      orderBody.order.billing_address  = shippingAddress;
    }

    if (shippingLine) {
      orderBody.order.shipping_lines = [
        {
          title:             shippingLine.title,
          price:             shippingLine.price,
          code:              shippingLine.title,
          source:            'custom'
        }
      ];
    }

    const response = await axios.post(
      `${SHOPIFY_URL}/orders.json`,
      orderBody,
      { headers: getHeaders() }
    );

    console.log(`✅ Order created: #${response.data.order.order_number}`);
    return response.data.order;

  } catch (error) {
    console.error('Shopify create order error:', error.response?.data || error.message);
    throw new Error('Failed to create Shopify order: ' + JSON.stringify(error.response?.data));
  }
}

// ─── Get Order ─────────────────────────────────────────────────────────────
async function getOrder(orderId) {
  try {
    const response = await axios.get(
      `${SHOPIFY_URL}/orders/${orderId}.json`,
      { headers: getHeaders() }
    );
    return response.data.order;
  } catch (error) {
    console.error('Shopify get order error:', error.response?.data || error.message);
    throw new Error('Failed to get Shopify order');
  }
}

// ─── Mark Order as Paid ───────────────────────────────────────────────────
async function markOrderAsPaid(orderId, transactionId, amount) {
  try {
    const response = await axios.post(
      `${SHOPIFY_URL}/orders/${orderId}/transactions.json`,
      {
        transaction: {
          kind:          'capture',
          status:        'success',
          amount:        amount,
          currency:      'BDT',
          gateway:       'bKash',
          source_name:   'bKash',
          authorization: transactionId,
          message:       `bKash payment confirmed. TrxID: ${transactionId}`
        }
      },
      { headers: getHeaders() }
    );

    console.log(`✅ Order ${orderId} marked as paid. TrxID: ${transactionId}`);
    return response.data.transaction;
  } catch (error) {
    console.error('Shopify mark paid error:', error.response?.data || error.message);
    throw new Error('Failed to mark order as paid in Shopify');
  }
}

module.exports = { createOrder, getOrder, markOrderAsPaid };
