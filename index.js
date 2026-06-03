'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'Cortex Escrow';
const APP_VERSION = process.env.APP_VERSION || '13.0.1';
const APP_NETWORK = process.env.APP_NETWORK || 'PI_TESTNET';
const PI_API_BASE_URL = (process.env.PI_API_BASE_URL || 'https://api.minepi.com/v2').replace(/\/+$/, '');
const PI_API_KEY = process.env.PI_API_KEY || '';
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || '';
const CURRENCY_LABEL = 'Pi';
const PI_DECIMALS = 7;
const MIN_AMOUNT = 0.0000001;
const MAX_AMOUNT = 100000;
const PI_FACTOR = 10 ** PI_DECIMALS;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const deals = new Map();

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes('*')) return true;
  return allowedOrigins.includes(origin);
}

const corsMiddleware = cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

app.use(helmet());
app.use(corsMiddleware);
app.options('*', corsMiddleware);
app.use(express.json({ limit: '100kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));

function cleanText(value, maxLength = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanLongText(value, maxLength = 2000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeAmountText(value) {
  return String(value ?? '')
    .trim()
    .replace(',', '.')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function parseAmount(value) {
  if (value === undefined || value === null) return null;
  const raw = normalizeAmountText(value);
  if (!raw) return null;
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw)) return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  if (number < MIN_AMOUNT || number > MAX_AMOUNT) return null;
  const units = Math.round(number * PI_FACTOR);
  if (Math.abs(number * PI_FACTOR - units) > 1e-8) return null;
  return units / PI_FACTOR;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function requirePiApiKey(req, res, next) {
  if (!PI_API_KEY || PI_API_KEY.includes('PASTE_') || PI_API_KEY.includes('put_')) {
    return res.status(500).json({
      success: false,
      message: 'PI_API_KEY is missing. Add your Pi Server API Key in environment variables.'
    });
  }
  return next();
}

function piHeaders() {
  return { Authorization: `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' };
}

async function callPiApi(method, path, data = undefined) {
  const response = await axios({
    method,
    url: `${PI_API_BASE_URL}${path}`,
    data,
    headers: piHeaders(),
    timeout: 15000
  });
  return response.data;
}

function sendPiError(res, error, message) {
  const status = error.response?.status || 500;
  const details = error.response?.data || { error: error.message };
  return res.status(status).json({ success: false, message, details });
}

function runTestnetPolicyCheck({ title, description, dealType, amount }) {
  const text = `${title} ${description}`.toLowerCase();
  const blockedWords = [
    'weapon',
    'drugs',
    'terror',
    'fraud',
    'fake documents',
    'سلاح',
    'مخدرات',
    'إرهاب',
    'تزوير',
    'احتيال',
    'غسيل أموال'
  ];

  for (const word of blockedWords) {
    if (text.includes(word.toLowerCase())) {
      return { approved: false, reason: `Deal rejected by Testnet policy check: blocked term "${word}"` };
    }
  }

  const allowedDealTypes = ['digital', 'service', 'physical', 'other'];
  if (!allowedDealTypes.includes(dealType)) {
    return { approved: false, reason: 'Invalid dealType. Use digital, service, physical, or other.' };
  }

  if (!amount || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return {
      approved: false,
      reason: 'السعر غير صحيح. النطاق المسموح من 0.0000001 إلى 100000 Pi، وبحد أقصى 7 أرقام عشرية.'
    };
  }

  return { approved: true, reason: 'Approved for Pi Testnet.' };
}

function buildDealResponse(deal) {
  return {
    success: true,
    message: 'Escrow deal created for Pi Testnet.',
    contractId: deal.dealId,
    dealId: deal.dealId,
    hash: deal.hash,
    status: deal.status,
    amount: deal.amount,
    currency: CURRENCY_LABEL,
    network: APP_NETWORK,
    platformWallet: PLATFORM_WALLET || null,
    createdAt: deal.createdAt,
    deal
  };
}

function handleCreateEscrow(req, res) {
  const description = cleanLongText(req.body.description || req.body.text, 2000);
  const terms = cleanLongText(req.body.terms || req.body.dealTerms, 2000);
  const dealType = cleanText(req.body.dealType || 'service', 30);
  const title = cleanText(req.body.title || 'Cortex Escrow Deal', 120);
  const buyer = cleanText(req.body.buyer || req.body.buyerUsername, 120);
  const amount = parseAmount(req.body.amount ?? req.body.price);

  if (!description || amount === null) {
    return res.status(400).json({
      success: false,
      message: 'Missing or invalid data. Required: text/description and price/amount. Amount must use max 7 decimal places.'
    });
  }

  const policy = runTestnetPolicyCheck({ title, description, dealType, amount });
  if (!policy.approved) {
    return res.status(403).json({ success: false, message: policy.reason });
  }

  const now = new Date().toISOString();
  const dealId = createId('CTX_TESTNET');
  const contractData = {
    dealId,
    title,
    description,
    terms,
    dealType,
    amount,
    currency: CURRENCY_LABEL,
    buyer,
    status: 'CREATED',
    network: APP_NETWORK,
    createdAt: now,
    updatedAt: now
  };

  const hash = sha256(JSON.stringify(contractData));
  const deal = { ...contractData, hash, paymentId: null, txid: null };
  deals.set(dealId, deal);

  return res.json(buildDealResponse(deal));
}

function handleGetEscrow(req, res) {
  const dealId = cleanText(req.params.id, 120);
  const deal = deals.get(dealId);
  if (!deal) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }
  return res.json({ success: true, deal });
}

async function handleApprovePayment(req, res) {
  const paymentId = cleanText(req.body.paymentId || req.body.identifier, 120);
  const dealId = cleanText(req.body.dealId || req.body.contractId, 120);

  if (!paymentId) {
    return res.status(400).json({ success: false, message: 'paymentId is required.' });
  }

  try {
    const piPayment = await callPiApi('post', `/payments/${encodeURIComponent(paymentId)}/approve`, {});

    if (dealId && deals.has(dealId)) {
      const deal = deals.get(dealId);
      deal.paymentId = paymentId;
      deal.status = 'APPROVED_BY_SERVER';
      deal.updatedAt = new Date().toISOString();
      deals.set(dealId, deal);
    }

    return res.json({ success: true, message: 'Payment approved by backend server.', paymentId, dealId: dealId || null, piPayment });
  } catch (error) {
    return sendPiError(res, error, 'Failed to approve Pi payment.');
  }
}

async function handleCompletePayment(req, res) {
  const paymentId = cleanText(req.body.paymentId || req.body.identifier, 120);
  const txid = cleanText(req.body.txid, 200);
  const dealId = cleanText(req.body.dealId || req.body.contractId, 120);

  if (!paymentId || !txid) {
    return res.status(400).json({ success: false, message: 'paymentId and txid are required.' });
  }

  try {
    const piPayment = await callPiApi('post', `/payments/${encodeURIComponent(paymentId)}/complete`, { txid });

    if (dealId && deals.has(dealId)) {
      const deal = deals.get(dealId);
      deal.paymentId = paymentId;
      deal.txid = txid;
      deal.status = 'COMPLETED';
      deal.updatedAt = new Date().toISOString();
      deals.set(dealId, deal);
    }

    return res.json({ success: true, message: 'Payment completed successfully.', paymentId, txid, dealId: dealId || null, piPayment });
  } catch (error) {
    return sendPiError(res, error, 'Failed to complete Pi payment.');
  }
}

async function handleCancelPayment(req, res) {
  const paymentId = cleanText(req.body.paymentId || req.body.identifier, 120);

  if (!paymentId) {
    return res.status(400).json({ success: false, message: 'paymentId is required.' });
  }

  try {
    const piPayment = await callPiApi('post', `/payments/${encodeURIComponent(paymentId)}/cancel`, {});
    return res.json({ success: true, message: 'Payment cancelled.', paymentId, piPayment });
  } catch (error) {
    return sendPiError(res, error, 'Failed to cancel Pi payment.');
  }
}

async function handleGetPayment(req, res) {
  const paymentId = cleanText(req.params.paymentId, 120);

  if (!paymentId) {
    return res.status(400).json({ success: false, message: 'paymentId is required.' });
  }

  try {
    const piPayment = await callPiApi('get', `/payments/${encodeURIComponent(paymentId)}`);
    return res.json({ success: true, paymentId, piPayment });
  } catch (error) {
    return sendPiError(res, error, 'Failed to get Pi payment.');
  }
}

function serviceInfo() {
  return {
    success: true,
    app: APP_NAME,
    version: APP_VERSION,
    network: APP_NETWORK,
    currency: CURRENCY_LABEL,
    decimals: PI_DECIMALS,
    minAmount: MIN_AMOUNT,
    maxAmount: MAX_AMOUNT,
    timestamp: new Date().toISOString()
  };
}

app.get('/', (req, res) => {
  res.json({ ...serviceInfo(), message: 'Cortex Escrow Pi Testnet backend is running.' });
});

app.get('/health', (req, res) => {
  res.json({ ...serviceInfo(), status: 'OK' });
});

app.get('/api/health', (req, res) => {
  res.json({ ...serviceInfo(), status: 'OK' });
});

app.post('/api/escrow/create', handleCreateEscrow);
app.post('/genesis/deploy', handleCreateEscrow);
app.get('/api/escrow/:id', handleGetEscrow);
app.get('/genesis/contract/:id', handleGetEscrow);
app.post('/api/pi/approve', requirePiApiKey, handleApprovePayment);
app.post('/payments/approve', requirePiApiKey, handleApprovePayment);
app.post('/api/pi/complete', requirePiApiKey, handleCompletePayment);
app.post('/payments/complete', requirePiApiKey, handleCompletePayment);
app.post('/api/pi/cancel', requirePiApiKey, handleCancelPayment);
app.post('/payments/cancel', requirePiApiKey, handleCancelPayment);
app.get('/api/pi/payment/:paymentId', requirePiApiKey, handleGetPayment);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found.' });
});

app.use((error, req, res, next) => {
  if (error.message && error.message.startsWith('CORS blocked')) {
    return res.status(403).json({ success: false, message: error.message });
  }

  console.error('Unhandled server error:', error);
  return res.status(500).json({ success: false, message: 'Internal server error.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${APP_NAME} backend running on port ${PORT}`);
    console.log(`Version: ${APP_VERSION}`);
    console.log(`Network: ${APP_NETWORK}`);
    console.log(`Currency: ${CURRENCY_LABEL}`);
    console.log(`Amount decimals: ${PI_DECIMALS}`);
    console.log(`Pi API Base URL: ${PI_API_BASE_URL}`);
  });
}

module.exports = app;