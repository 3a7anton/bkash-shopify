const axios = require('axios');

let bkashToken = null;
let tokenExpiry = null;

// ─── Get bKash Token ──────────────────────────────────────────────────────
async function getToken() {
  if (bkashToken && tokenExpiry && Date.now() < tokenExpiry) {
    return bkashToken;
  }

  try {
    const response = await axios.post(
      `${process.env.BKASH_BASE_URL}/checkout/token/grant`,
      {
        app_key:    process.env.BKASH_APP_KEY,
        app_secret: process.env.BKASH_APP_SECRET
      },
      {
        headers: {
          'Content-Type': 'application/json',
          username:       process.env.BKASH_USERNAME,
          password:       process.env.BKASH_PASSWORD
        }
      }
    );

    bkashToken  = response.data.id_token;
    tokenExpiry = Date.now() + 3500 * 1000; // ~58 minutes
    console.log('✅ bKash token acquired');
    return bkashToken;

  } catch (error) {
    console.error('bKash token error:', error.response?.data || error.message);
    throw new Error('Failed to get bKash token');
  }
}

// ─── Create Payment ───────────────────────────────────────────────────────
async function createPayment({ amount, orderId, customerPhone }) {
  const token = await getToken();

  const response = await axios.post(
    `${process.env.BKASH_BASE_URL}/checkout/payment/create`,
    {
      mode:                  '0011',
      payerReference:        customerPhone || ' ',
      callbackURL:           `${process.env.SERVER_URL}/bkash/callback`,
      amount:                amount,
      currency:              'BDT',
      intent:                'sale',
      merchantInvoiceNumber: orderId
    },
    {
      headers: {
        'Content-Type':  'application/json',
        Authorization:   token,
        'X-APP-Key':     process.env.BKASH_APP_KEY
      }
    }
  );

  return response.data;
}

// ─── Execute Payment ──────────────────────────────────────────────────────
async function executePayment(paymentID) {
  const token = await getToken();

  const response = await axios.post(
    `${process.env.BKASH_BASE_URL}/checkout/payment/execute`,
    { paymentID },
    {
      headers: {
        'Content-Type':  'application/json',
        Authorization:   token,
        'X-APP-Key':     process.env.BKASH_APP_KEY
      }
    }
  );

  return response.data;
}

// ─── Query Payment ────────────────────────────────────────────────────────
async function queryPayment(paymentID) {
  const token = await getToken();

  const response = await axios.post(
    `${process.env.BKASH_BASE_URL}/checkout/payment/query/${paymentID}`,
    { paymentID },
    {
      headers: {
        'Content-Type':  'application/json',
        Authorization:   token,
        'X-APP-Key':     process.env.BKASH_APP_KEY
      }
    }
  );

  return response.data;
}

module.exports = { getToken, createPayment, executePayment, queryPayment };
