const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_URL = 'https://api.minepi.com/v2';
const HEADERS = { 'Authorization': `Key ${PI_API_KEY}` };

// قاعدة البيانات
const db = new sqlite3.Database('./escrow.db');
db.run(`
  CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    seller_uid TEXT NOT NULL,
    buyer_uid TEXT,
    title TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting_payment',
    txid TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// إنشاء صفقة جديدة
app.post('/create-deal', async (req, res) => {
  const { seller_uid, title, amount } = req.body;
  if (!seller_uid ||!title ||!amount) {
    return res.status(400).json({ error: 'Missing data' });
  }
  const dealId = 'deal_' + Math.random().toString(36).substr(2, 9);
  db.run(
    `INSERT INTO deals (id, seller_uid, title, amount) VALUES (?,?,?,?)`,
    [dealId, seller_uid, title, amount],
    function(err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({
        success: true,
        dealId: dealId,
        dealLink: `https://apuaish1976.github.io/deal/${dealId}`
      });
    }
  );
});

// جلب بيانات صفقة
app.get('/deal/:id', (req, res) => {
  const dealId = req.params.id;
  db.get(`SELECT * FROM deals WHERE id =?`, [dealId], (err, row) => {
    if (err ||!row) return res.status(404).json({ error: 'Deal not found' });
    res.json(row);
  });
});

// Approve
app.post('/approve', async (req, res) => {
  const { paymentId } = req.body;
  try {
    await axios.post(`${PI_API_URL}/payments/${paymentId}/approve`, {}, { headers: HEADERS });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Approve failed' });
  }
});

// Complete مع تحديث الصفقة
app.post('/complete', async (req, res) => {
  const { paymentId, txid, dealId } = req.body;
  try {
    await axios.post(`${PI_API_URL}/payments/${paymentId}/complete`, { txid }, { headers: HEADERS });
    if (dealId) {
      db.run(`UPDATE deals SET status = 'paid', txid =? WHERE id =?`, [txid, dealId]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Complete failed' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
