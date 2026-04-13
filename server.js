require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const bkash = require('./bkashService');
const shopify = require('./shopifyService');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// â”€â”€â”€ In-memory cart store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Holds cart data between "Pay with bKash" click and payment callback
// { [pendingId]: { lineItems, customerEmail, customerPhone, amount, createdAt } }
const pendingPayments = {};

// Clean up entries older than 2 hours
setInterval(() => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const id in pendingPayments) {
    if (pendingPayments[id].createdAt < twoHoursAgo) {
      delete pendingPayments[id];
    }
  }
}, 30 * 60 * 1000);

// â”€â”€â”€ Health Check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'Stickify bKash Payment Gateway',
    version: '4.0.0'
  });
});

// â”€â”€â”€ Test Shopify Token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/test-shopify', async (req, res) => {
  try {
    const response = await axios.get(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-01/shop.json`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json({
      success: true,
      shop: response.data.shop.name,
      domain: response.data.shop.domain,
      plan: response.data.shop.plan_name,
      message: 'âœ… Shopify token is working!'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// â”€â”€â”€ Shopify OAuth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/auth', (req, res) => {
  const shop        = process.env.SHOPIFY_STORE_URL;
  const clientId    = process.env.SHOPIFY_API_KEY;
  const redirectUri = `${process.env.SERVER_URL}/auth/callback`;
  const scopes      = 'write_orders,read_orders';
  const state       = crypto.randomBytes(16).toString('hex');
  const authUrl     = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code, shop } = req.query;
  if (!code || !shop) return res.status(400).send('Missing code or shop');

  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id:     process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    });

    const accessToken = response.data.access_token;
    console.log('âœ… SHOPIFY TOKEN:', accessToken);

    res.send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#f0f0f0;">
        <div style="background:white;padding:30px;border-radius:10px;max-width:600px;margin:0 auto;">
          <h2 style="color:#00a650;">âœ… App Installed!</h2>
          <p>Your Shopify Admin Token:</p>
          <div style="background:#f5f5f5;padding:15px;border-radius:5px;word-break:break-all;font-family:monospace;font-size:14px;">
            ${accessToken}
          </div>
          <br/>
          <p style="color:red;font-weight:bold;">âš ï¸ Copy this token NOW and add to Railway as SHOPIFY_ADMIN_TOKEN</p>
        </div>
      </body></html>
    `);
  } catch (error) {
    res.status(500).send('OAuth failed: ' + error.message);
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// THANK YOU PAGE: Shopify order already exists â†’ store orderId â†’ redirect to /pay
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/thankyou/initiate', async (req, res) => {
  const { orderId, orderName, amount, email, phone, source } = req.body;

  if (!orderId || !amount) {
    return res.status(400).json({ error: 'orderId and amount are required' });
  }

  const pendingId = crypto.randomBytes(12).toString('hex');

  pendingPayments[pendingId] = {
    source:        'thankyou_page',
    shopifyOrderId: orderId,
    orderName:     orderName || '',
    amount:        parseFloat(amount).toFixed(2),
    customerEmail: email || null,
    customerPhone: phone || null,
    createdAt:     Date.now()
  };

  console.log(`ðŸ“‹ Thank-you pending stored: ${pendingId}, Order: ${orderName}, Amount: ${amount} BDT`);

  const paymentPageUrl = `${process.env.SERVER_URL}/pay?pendingId=${pendingId}&amount=${parseFloat(amount).toFixed(2)}&phone=${phone || ''}`;

  res.json({ success: true, pendingId, amount, paymentPageUrl });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CART PAGE: store cart in memory â†’ return payment page URL
// No draft orders â€” works on all Shopify plans
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/checkout/initiate', async (req, res) => {
  const { lineItems, customerEmail, customerPhone, amount, shippingAddress, shippingLine, payType, totalAmount, note } = req.body;

  if (!lineItems || lineItems.length === 0) {
    return res.status(400).json({ error: 'lineItems are required' });
  }

  if (!amount || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: 'amount is required' });
  }

  const pendingId = crypto.randomBytes(12).toString('hex');

  pendingPayments[pendingId] = {
    lineItems,
    customerEmail:   customerEmail || null,
    customerPhone:   customerPhone || null,
    amount:          parseFloat(amount).toFixed(2),
    shippingAddress: shippingAddress || null,
    shippingLine:    shippingLine || null,
    payType:         payType || 'full',
    totalAmount:     totalAmount || amount,
    note:            note || null,
    createdAt:       Date.now()
  };

  console.log(`ðŸ“‹ Pending payment stored: ${pendingId}, Amount: ${amount} BDT`);

  const paymentPageUrl = `${process.env.SERVER_URL}/pay?pendingId=${pendingId}&amount=${amount}&phone=${customerPhone || ''}`;

  res.json({ success: true, pendingId, amount, paymentPageUrl });
});

// â”€â”€â”€ Payment page (inline â€” no static file needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/pay', (req, res) => {
  const { pendingId, amount, phone } = req.query;
  if (!pendingId || !amount) return res.status(400).send('Missing payment details');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Pay with bKash</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#f7f7f7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);width:100%;max-width:420px;overflow:hidden}
    .header{background:linear-gradient(135deg,#e2136e 0%,#c0115c 100%);padding:28px 32px;display:flex;align-items:center;gap:14px}
    .bkash-logo{background:white;border-radius:10px;width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#e2136e;flex-shrink:0}
    .header-text h1{color:white;font-size:18px;font-weight:600}
    .header-text p{color:rgba(255,255,255,0.8);font-size:13px;margin-top:2px}
    .body{padding:28px 32px}
    .amount-box{background:#fff5f9;border:1.5px solid #fce4ef;border-radius:12px;padding:18px 20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center}
    .amount-label{font-size:13px;color:#888;font-weight:500}
    .amount-value{font-size:26px;font-weight:700;color:#e2136e}
    .amount-currency{font-size:14px;font-weight:500;color:#e2136e;margin-left:4px}
    .field{margin-bottom:18px}
    .field label{display:block;font-size:13px;font-weight:500;color:#444;margin-bottom:7px}
    .field input{width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:15px;font-family:inherit;outline:none;transition:border-color 0.2s}
    .field input:focus{border-color:#e2136e}
    .pay-btn{width:100%;background:#e2136e;color:white;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:600;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background 0.2s}
    .pay-btn:hover{background:#c0115c}
    .pay-btn:disabled{background:#f0aac8;cursor:not-allowed}
    .spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,0.4);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite;display:none}
    @keyframes spin{to{transform:rotate(360deg)}}
    .status{margin-top:14px;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;display:none}
    .status.error{background:#fff0f0;color:#c00;border:1px solid #ffd0d0;display:block}
    .footer{padding:16px 32px 24px;display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#bbb}
    .redirecting{text-align:center;padding:40px 20px}
    .big-spinner{width:48px;height:48px;border:3px solid #fce4ef;border-top-color:#e2136e;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px}
    .redirecting p{color:#666;font-size:15px}
    .redirecting small{color:#aaa;font-size:12px;display:block;margin-top:6px}
  </style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="bkash-logo">bK</div>
    <div class="header-text">
      <h1>Pay with bKash</h1>
      <p>Secure mobile payment</p>
    </div>
  </div>

  <div class="body" id="payment-form">
    <div class="amount-box">
      <span class="amount-label">Total Amount</span>
      <div>
        <span class="amount-value">${parseFloat(amount).toFixed(2)}</span>
        <span class="amount-currency">BDT</span>
      </div>
    </div>

    <div class="field">
      <label for="phone">bKash Account Number</label>
      <input type="tel" id="phone" placeholder="01XXXXXXXXX" maxlength="11" value="${phone || ''}"/>
    </div>

    <button class="pay-btn" id="pay-btn" onclick="startPayment()">
      <span id="btn-text">Continue to bKash</span>
      <div class="spinner" id="spinner"></div>
    </button>

    <div class="status" id="status-msg"></div>
  </div>

  <div class="body redirecting" id="redirecting" style="display:none">
    <div class="big-spinner"></div>
    <p>Redirecting to bKash...</p>
    <small>Please complete payment in the bKash window</small>
  </div>

  <div class="footer">ðŸ”’ Secured by SSL encryption</div>
</div>

<script>
  async function startPayment() {
    const btn       = document.getElementById('pay-btn');
    const spinner   = document.getElementById('spinner');
    const btnText   = document.getElementById('btn-text');
    const statusMsg = document.getElementById('status-msg');

    statusMsg.className = 'status';
    statusMsg.textContent = '';
    btn.disabled = true;
    spinner.style.display = 'block';
    btnText.textContent = 'Creating payment...';

    try {
      const response = await fetch('/bkash/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pendingId: '${pendingId}',
          amount:    '${parseFloat(amount).toFixed(2)}',
          phone:     document.getElementById('phone').value.trim()
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || data.details || 'Payment creation failed');

      document.getElementById('payment-form').style.display = 'none';
      document.getElementById('redirecting').style.display  = 'block';

      setTimeout(() => { window.location.href = data.bkashURL; }, 800);

    } catch (err) {
      btn.disabled = false;
      spinner.style.display = 'none';
      btnText.textContent = 'Continue to bKash';
      statusMsg.className = 'status error';
      statusMsg.textContent = 'âŒ ' + err.message;
    }
  }
</script>
</body>
</html>`);
});

// â”€â”€â”€ STEP 2: /pay page calls this to start bKash â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/bkash/create', async (req, res) => {
  const { pendingId, amount, phone } = req.body;

  if (!pendingId || !amount) {
    return res.status(400).json({ error: 'pendingId and amount are required' });
  }

  if (!pendingPayments[pendingId]) {
    return res.status(400).json({ error: 'Payment session expired. Please go back and try again.' });
  }

  // â”€â”€ DUMMY MODE (no real bKash credentials yet) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const isDummy = !process.env.BKASH_APP_KEY || process.env.BKASH_APP_KEY === 'your_app_key_here';
  if (isDummy) {
    console.log(`ðŸ§ª DUMMY MODE: Simulating bKash payment for pending: ${pendingId}, amount: ${amount}`);
    return res.json({
      success:   true,
      paymentID: 'DUMMY_' + pendingId,
      bkashURL:  `${process.env.SERVER_URL}/bkash/dummy-payment?pendingId=${pendingId}&amount=${amount}&phone=${phone || ''}`
    });
  }
  // â”€â”€ END DUMMY MODE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  try {
    console.log(`ðŸ”„ Creating bKash payment for pending: ${pendingId}, amount: ${amount}`);

    const payment = await bkash.createPayment({
      amount,
      orderId:       pendingId,
      customerPhone: phone
    });

    if (payment.statusCode !== '0000') {
      return res.status(400).json({
        error:   'bKash payment creation failed',
        details: payment.statusMessage
      });
    }

    console.log(`âœ… bKash payment created. PaymentID: ${payment.paymentID}`);

    res.json({
      success:   true,
      paymentID: payment.paymentID,
      bkashURL:  payment.bkashURL
    });

  } catch (error) {
    console.error('Create payment error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// â”€â”€â”€ DUMMY bKash Payment Page (only active when no real API keys) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/bkash/dummy-payment', (req, res) => {
  const { pendingId, amount, phone } = req.query;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>bKash [TEST MODE]</title>
  <style>
    body { font-family: sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: white; border-radius: 16px; padding: 32px; max-width: 380px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
    .badge { background: #fff3cd; color: #856404; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px; display: inline-block; margin-bottom: 16px; }
    h2 { color: #e2136e; margin: 0 0 8px; font-size: 22px; }
    .amount { font-size: 32px; font-weight: 700; color: #111; margin: 16px 0; }
    .amount span { font-size: 16px; color: #666; }
    .info { font-size: 13px; color: #888; margin-bottom: 24px; line-height: 1.6; }
    .btn { width: 100%; padding: 14px; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; margin-bottom: 10px; }
    .btn-success { background: #e2136e; color: white; }
    .btn-success:hover { background: #c0115c; }
    .btn-fail { background: #f5f5f5; color: #666; border: 1px solid #ddd; }
    .btn-fail:hover { background: #eee; }
    .note { font-size: 11px; color: #aaa; text-align: center; margin-top: 8px; }
  </style>
</head>
<body>
<div class="card">
  <div class="badge">ðŸ§ª TEST MODE â€” Not a real bKash page</div>
  <h2>bKash Payment</h2>
  <div class="amount">à§³${parseFloat(amount).toFixed(2)} <span>BDT</span></div>
  <div class="info">
    Phone: <strong>${phone || 'N/A'}</strong><br/>
    This is a dummy payment page to test your Shopify order flow.<br/>
    Click <strong>Simulate Success</strong> to create a real order in your Shopify admin.
  </div>
  <button class="btn btn-success" onclick="simulate('success')">âœ… Simulate Success</button>
  <button class="btn btn-fail" onclick="simulate('cancel')">âŒ Simulate Cancel / Failure</button>
  <div class="note">No real money is charged. For testing only.</div>
</div>
<script>
  function simulate(status) {
    window.location.href = '/bkash/callback?paymentID=DUMMY_${pendingId}&status=' + status + '&pendingId=${pendingId}';
  }
</script>
</body>
</html>`);
});

// â”€â”€â”€ STEP 3: bKash callback â†’ execute â†’ mark paid or create order â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/bkash/callback', async (req, res) => {
  const { paymentID, status } = req.query;

  console.log(`ðŸ“© bKash callback: PaymentID=${paymentID}, Status=${status}`);

  if (status === 'cancel' || status === 'failure') {
    return res.redirect(
      `https://${process.env.SHOPIFY_STORE_URL}/pages/payment-failed?reason=${status}`
    );
  }

  if (status === 'success') {
    try {
      let trxID, amount, pendingId;

      // â”€â”€ DUMMY MODE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (paymentID && paymentID.startsWith('DUMMY_')) {
        pendingId = paymentID.replace('DUMMY_', '');
        trxID  = 'TEST' + Date.now();
        console.log(`ðŸ§ª DUMMY MODE: Simulating successful payment. TrxID: ${trxID}`);
      } else {
      // â”€â”€ REAL bKash â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const execution = await bkash.executePayment(paymentID);
        if (execution.statusCode !== '0000') {
          console.error('Execute failed:', execution.statusMessage);
          return res.redirect(`https://${process.env.SHOPIFY_STORE_URL}/pages/payment-failed?reason=execute_failed`);
        }
        trxID     = execution.trxID;
        amount    = execution.amount;
        pendingId = execution.merchantInvoiceNumber;
      }
      // â”€â”€ END MODE SPLIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      console.log(`ðŸ’° Payment! TrxID: ${trxID}, PendingID: ${pendingId}`);

      // Get stored cart
      const pending = pendingPayments[pendingId];

      if (!pending) {
        console.error('Pending cart not found for:', pendingId);
        return res.redirect(
          `https://${process.env.SHOPIFY_STORE_URL}/pages/payment-failed?reason=session_expired`
        );
      }

      // In dummy mode, use stored amount
      if (!amount) amount = pending.amount;

      // â”€â”€ THANK YOU PAGE FLOW: mark existing order as paid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (pending.source === 'thankyou_page') {
        console.log(`ðŸ“¦ Thank-you flow: marking order ${pending.shopifyOrderId} as paid`);

        await shopify.markOrderAsPaid(
          pending.shopifyOrderId,
          trxID,
          amount
        );

        delete pendingPayments[pendingId];

        console.log(`âœ… Order ${pending.orderName} marked as paid! TrxID: ${trxID}`);

        return res.redirect(
          `https://${process.env.SHOPIFY_STORE_URL}/pages/payment-success?trxID=${trxID}&order=${pending.orderName}`
        );
      }

      // â”€â”€ CART FLOW: create a new Shopify order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const order = await shopify.createOrder({
        lineItems:       pending.lineItems,
        customerEmail:   pending.customerEmail,
        customerPhone:   pending.customerPhone,
        shippingAddress: pending.shippingAddress,
        shippingLine:    pending.shippingLine,
        payType:         pending.payType,
        totalAmount:     pending.totalAmount,
        note:            pending.note,
        amount,
        trxID
      });

      delete pendingPayments[pendingId];

      console.log(`âœ… Shopify order created: #${order.order_number}`);

      return res.redirect(
        `https://${process.env.SHOPIFY_STORE_URL}/pages/payment-success?trxID=${trxID}&order=${order.order_number}`
      );

    } catch (error) {
      console.error('Callback error:', error.message);
      return res.redirect(
        `https://${process.env.SHOPIFY_STORE_URL}/pages/payment-failed?reason=server_error`
      );
    }
  }

  res.status(400).json({ error: 'Unknown status' });
});

// â”€â”€â”€ Query Payment Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/bkash/status/:paymentID', async (req, res) => {
  try {
    const status = await bkash.queryPayment(req.params.paymentID);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --- PAY ORDER PAGE (Checkout Blocks button links here) ---
app.get('/pay-order', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Complete bKash Payment</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#f7f7f7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);width:100%;max-width:440px;overflow:hidden}
    .header{background:linear-gradient(135deg,#e2136e 0%,#c0115c 100%);padding:28px 32px;text-align:center}
    .header h1{color:white;font-size:20px;font-weight:600;margin-bottom:4px}
    .header p{color:rgba(255,255,255,0.8);font-size:13px}
    .body{padding:28px 32px}
    .info-box{background:#fff5f9;border:1.5px solid #fce4ef;border-radius:12px;padding:16px;margin-bottom:24px;font-size:13px;color:#666;line-height:1.6;text-align:center}
    .info-box strong{color:#e2136e}
    .field{margin-bottom:20px}
    .field label{display:block;font-size:13px;font-weight:500;color:#444;margin-bottom:7px}
    .field input{width:100%;padding:13px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:15px;font-family:inherit;outline:none;transition:border-color 0.2s}
    .field input:focus{border-color:#e2136e}
    .field input::placeholder{color:#bbb}
    .btn{width:100%;background:#e2136e;color:white;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:600;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background 0.2s}
    .btn:hover{background:#c0115c}
    .btn:disabled{background:#f0aac8;cursor:not-allowed}
    .spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,0.4);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite;display:none}
    @keyframes spin{to{transform:rotate(360deg)}}
    .status{margin-top:14px;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;display:none}
    .status.error{background:#fff0f0;color:#c00;border:1px solid #ffd0d0;display:block}
    .order-found{margin-top:20px;background:#f8f8f8;border:1.5px solid #e0e0e0;border-radius:12px;padding:18px;display:none}
    .order-found h3{font-size:14px;color:#333;margin-bottom:10px}
    .order-row{display:flex;justify-content:space-between;font-size:13px;color:#666;margin-bottom:6px}
    .order-row .val{font-weight:600;color:#333}
    .order-amount{font-size:24px;font-weight:700;color:#e2136e;text-align:center;margin:14px 0}
    .footer{padding:16px 32px 24px;text-align:center;font-size:12px;color:#bbb}
  </style>
</head>
<body>
<div class="card">
  <div class="header"><h1>Complete bKash Payment</h1><p>Pay for your pending order via bKash</p></div>
  <div class="body">
    <div class="info-box">Enter the <strong>email address</strong> you used during checkout.<br/>We will find your pending order automatically.</div>
    <div class="field"><label for="email-input">Email Address</label><input type="email" id="email-input" placeholder="your@email.com" autofocus /></div>
    <button class="btn" id="find-btn" onclick="findOrder()"><span id="btn-text">Find My Order</span><div class="spinner" id="spinner"></div></button>
    <div class="status" id="status-msg"></div>
    <div class="order-found" id="order-found">
      <h3>Pending Order Found</h3>
      <div class="order-row"><span>Order</span><span class="val" id="found-name"></span></div>
      <div class="order-row"><span>Status</span><span class="val" style="color:#e2136e">Payment Pending</span></div>
      <div class="order-amount" id="found-amount"></div>
      <button class="btn" onclick="proceedToPayment()" style="margin-top:8px">Pay Now with bKash</button>
    </div>
  </div>
  <div class="footer">Secured by SSL encryption - Stickify</div>
</div>
<script>
  var foundPaymentUrl = null;
  async function findOrder() {
    var email = document.getElementById('email-input').value.trim();
    var btn = document.getElementById('find-btn');
    var spinner = document.getElementById('spinner');
    var btnText = document.getElementById('btn-text');
    var statusMsg = document.getElementById('status-msg');
    var orderFound = document.getElementById('order-found');
    if (!email || !email.includes('@')) { statusMsg.className = 'status error'; statusMsg.textContent = 'Please enter a valid email address'; return; }
    statusMsg.className = 'status'; statusMsg.style.display = 'none'; orderFound.style.display = 'none';
    btn.disabled = true; spinner.style.display = 'block'; btnText.textContent = 'Searching...';
    try {
      var res = await fetch('/pay-order/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No pending order found');
      document.getElementById('found-name').textContent = data.orderName;
      document.getElementById('found-amount').textContent = 'BDT ' + parseFloat(data.amount).toFixed(2);
      orderFound.style.display = 'block'; foundPaymentUrl = data.paymentPageUrl;
      btn.disabled = false; spinner.style.display = 'none'; btnText.textContent = 'Find My Order';
    } catch (err) {
      btn.disabled = false; spinner.style.display = 'none'; btnText.textContent = 'Find My Order';
      statusMsg.className = 'status error'; statusMsg.textContent = err.message;
    }
  }
  function proceedToPayment() { if (foundPaymentUrl) window.location.href = foundPaymentUrl; }
  document.getElementById('email-input').addEventListener('keypress', function(e) { if (e.key === 'Enter') findOrder(); });
</script>
</body>
</html>`);
});

// --- PAY ORDER LOOKUP (find unpaid order by email) ---
app.post('/pay-order/lookup', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email address is required' });
  try {
    console.log('Looking up unpaid orders for: ' + email);
    const response = await axios.get(
      'https://' + process.env.SHOPIFY_STORE_URL + '/admin/api/2024-01/orders.json?email=' + encodeURIComponent(email) + '&financial_status=pending&status=any&limit=5&order=created_at+desc',
      { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' } }
    );
    const orders = response.data.orders;
    if (!orders || orders.length === 0) {
      return res.status(404).json({ error: 'No pending payment found for this email.' });
    }
    const order = orders[0];
    const amount = parseFloat(order.total_price).toFixed(2);
    const phone = order.phone || (order.shipping_address && order.shipping_address.phone) || '';
    const pendingId = crypto.randomBytes(12).toString('hex');
    pendingPayments[pendingId] = {
      source: 'thankyou_page', shopifyOrderId: order.id, orderName: order.name,
      amount: amount, customerEmail: email, customerPhone: phone, createdAt: Date.now()
    };
    console.log('Order found: ' + order.name + ', Amount: ' + amount);
    res.json({ success: true, orderName: order.name, amount: amount, financialStatus: order.financial_status,
      paymentPageUrl: '/pay?pendingId=' + pendingId + '&amount=' + amount + '&phone=' + phone });
  } catch (error) {
    console.error('Order lookup error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to look up order. Please try again.' });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log('Stickify bKash server running on port ' + PORT);
  console.log('Callback URL: ' + process.env.SERVER_URL + '/bkash/callback');
  console.log('Payment Page: ' + process.env.SERVER_URL + '/pay');
  console.log('Pay Order: ' + process.env.SERVER_URL + '/pay-order');
});
