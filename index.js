// تحديث: /complete مع دعم الصفقات
app.post('/complete', async (req, res) => {
  const { paymentId, txid, dealId } = req.body; 

  console.log('Got complete request for:', paymentId, 'Deal:', dealId);

  try {
    // 1. نكمل الدفعة مع Pi
    await axios.post(`${PI_API_URL}/payments/${paymentId}/complete`, { txid }, { headers: HEADERS });
    console.log('Complete sent to Pi API');

    // 2. لو فيه dealId نحدث الصفقة لـ paid
    if (dealId) {
      db.run(
        `UPDATE deals SET status = 'paid', txid = ? WHERE id = ?`,
        [txid, dealId],
        function(err) {
          if (err) console.error('DB update error:', err);
          else console.log('Deal updated to paid:', dealId);
        }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Complete ERROR:', error.response?.data);
    res.status(500).json({ error: 'Complete failed' });
  }
});
