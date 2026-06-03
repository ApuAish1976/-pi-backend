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