const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.post('/payments/approve', (req, res) => {
  res.status(200).json({ approved: true });
});

app.post('/payments/complete', (req, res) => {
  res.status(200).json({ success: true });
});

app.get('/', (req, res) => {
  res.send('Pi Backend ✅');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Running on ${port}`));
