const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_URL = 'https://api.testnet.minepi.com';
const HEADERS = { 'Authorization': `Key ${PI_API_KEY}` };

// قاعدة البيانات مع حقل type
const db = new sqlite3.Database('./escrow.db');
db.run(`
  CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    seller_uid TEXT NOT NULL,
    buyer_uid TEXT,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    seller_confirmed INTEGER DEFAULT 0,
    buyer_confirmed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// الصفحة الرئيسية للتأكد إن السيرفر شغال
app.get('/', (req, res) => {
  res.send('Pi Backend is running ✅');
});

// إنشاء صفقة جديدة
app.post('/deals/create', (req, res) => {
  const { seller_uid, amount } = req.body;
  const id = 'deal_' + Date.now();
  db.run(
    'INSERT INTO deals (id, seller_uid, amount, status) VALUES (?, ?, ?, ?)',
    [id, seller_uid, amount, 'open'],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ dealId: id });
    }
  );
});

// جلب تفاصيل صفقة
app.get('/deals/:id', (req, res) => {
  db.get('SELECT * FROM deals WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Deal not found' });
    res.json(row);
  });
});

// ===== Pi Payments Endpoints =====
// 1. الموافقة على الدفع
app.post('/payments/approve', async (req, res) => {
  const { paymentId } = req.body;
  console.log('Approving payment:', paymentId);
  try {
    await axios.post(`${PI_API_URL}/v2/payments/${paymentId}/approve`, {}, { headers: HEADERS });
    res.status(200).json({ message: 'Approved' });
  } catch (err) {
    console.log('Approve error:', err.response?.data);
    res.status(500).json({ error: 'Approval failed' });
  }
});

// 2. إكمال الدفع
app.post('/payments/complete', async (req, res) => {
  const { paymentId, txid } = req.body;
  console.log('Completing payment:', paymentId, txid);
  try {
    await axios.post(`${PI_API_URL}/v2/payments/${paymentId}/complete`, { txid }, { headers: HEADERS });
    res.status(200).json({ message: 'Completed' });
  } catch (err) {
    console.log('Complete error:', err.response?.data);
    res.status(500).json({ error: 'Completion failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
