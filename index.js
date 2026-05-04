const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// أهم سطر: يسمح لـ Pi Browser يكلم الباكند
app.use(cors());
app.use(express.json());

const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_URL = 'https://api.minepi.com/v2';

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Backend is running' });
});

app.post('/approve', async (req, res) => {
  const { paymentId } = req.body;
  console.log('Got approve request for:', paymentId);
  
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId is required' });
  }

  try {
    const response = await axios.post(
      `${PI_API_URL}/payments/${paymentId}/approve`,
      {},
      { headers: { 'Authorization': `Key ${PI_API_KEY}` } }
    );
    console.log('Approve sent to Pi API');
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Approve ERROR:', error.response?.data || error.message);
    res.status(500).json({ error: 'Approve failed' });
  }
});

app.post('/complete', async (req, res) => {
  const { paymentId, txid } = req.body;
  console.log('Got complete request for:', paymentId);
  
  if (!paymentId || !txid) {
    return res.status(400).json({ error: 'paymentId and txid are required' });
  }

  try {
    const response = await axios.post(
      `${PI_API_URL}/payments/${paymentId}/complete`,
      { txid: txid },
      { headers: { 'Authorization': `Key ${PI_API_KEY}` } }
    );
    console.log('Complete sent to Pi API');
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Complete ERROR:', error.response?.data || error.message);
    res.status(500).json({ error: 'Complete failed' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
