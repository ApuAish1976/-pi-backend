const express = require('express');
const cors = require('cors');
const { Pi } = require('pi-backend');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// تهيئة Pi SDK - وضع Production
Pi.init({
    apiKey: process.env.PI_API_KEY,
    sandbox: false
});

// صفحة فحص السيرفر
app.get('/', (req, res) => {
    res.json({ 
        status: 'Cortex Escrow Backend Running',
        mode: 'Production',
        timestamp: new Date().toISOString()
    });
});

// 1. الموافقة على الدفع
app.post('/api/payments/approve', async (req, res) => {
    try {
        const { paymentId } = req.body;
        
        if (!paymentId) {
            return res.status(400).json({ error: 'paymentId مطلوب' });
        }

        console.log('Approving payment:', paymentId);
        
        const approvedPayment = await Pi.approvePayment(paymentId);
        
        console.log('Payment approved:', paymentId);
        res.json({ success: true, payment: approvedPayment });
        
    } catch (error) {
        console.error('Approve error:', error);
        res.status(500).json({ 
            error: 'فشل الموافقة على الدفع', 
            details: error.message 
        });
    }
});

// 2. إكمال الدفع
app.post('/api/payments/complete', async (req, res) => {
    try {
        const { paymentId, txid } = req.body;
        
        if (!paymentId || !txid) {
            return res.status(400).json({ error: 'paymentId و txid مطلوبين' });
        }

        console.log('Completing payment:', paymentId, 'TXID:', txid);
        
        const completedPayment = await Pi.completePayment(paymentId, txid);
        
        console.log('Payment completed:', paymentId);
        res.json({ success: true, payment: completedPayment });
        
    } catch (error) {
        console.error('Complete error:', error);
        res.status(500).json({ 
            error: 'فشل إكمال الدفع', 
            details: error.message 
        });
    }
});

// 3. إلغاء الدفع
app.post('/api/payments/cancel', async (req, res) => {
    try {
        const { paymentId } = req.body;
        
        if (!paymentId) {
            return res.status(400).json({ error: 'paymentId مطلوب' });
        }

        const cancelledPayment = await Pi.cancelPayment(paymentId);
        res.json({ success: true, payment: cancelledPayment });
        
    } catch (error) {
        console.error('Cancel error:', error);
        res.status(500).json({ 
            error: 'فشل إلغاء الدفع', 
            details: error.message 
        });
    }
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`Cortex Escrow Backend running on port ${PORT}`);
    console.log(`Mode: Production - sandbox: false`);
});
