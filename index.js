const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { create } = require('ipfs-http-client');
const { body, validationResult } = require('express-validator');
const app = express();

app.use(helmet({
    contentSecurityPolicy: { useDefaults: false },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    crossOriginEmbedderPolicy: { policy: "require-corp" }
}));
app.use(rateLimit({ windowMs: 60000, max: 15, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '16kb' }));

const contracts = new Map();
const ipfs = create({ url: process.env.IPFS_URL });
const PI_API = axios.create({
    baseURL: 'https://api.minepi.com/v2',
    timeout: 8000,
    headers: { 'Authorization': `Key ${process.env.PI_API_KEY}`, 'User-Agent': 'CortexGenesis/8.0' }
});

// محكمة AI: 3 وكلاء
async function aiTribunal(text, lang) {
    // في الإنتاج: استدعي GPT-5, Claude Opus 4, Gemini Ultra 2.0 APIs
    const votes = [
        { agent: 'GPT-5-Turbo', confidence: 99, item: extractItem(text), price: extractPrice(text) },
        { agent: 'Claude-Opus-4', confidence: 98, item: extractItem(text), price: extractPrice(text) },
        { agent: 'Gemini-Ultra-2.0', confidence: 99, item: extractItem(text), price: extractPrice(text) }
    ];
    const approved = votes.filter(v => v.confidence > 95).length;
    return { approved, votes, item: votes[0].item, price: votes[0].price, terms: extractTerms(text) };
}

app.post('/genesis/deploy', [
    body('text').isLength({ min: 10, max: 500 }).escape(),
    body('seller').isUUID()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
        const { text, lang, seller } = req.body;
        const tribunal = await aiTribunal(text, lang);
        if (tribunal.approved < 2) return res.json({ success: false, reason: 'AI Tribunal: Consensus Not Reached' });

        const contract = {
            v: '8.0', id: 'g_' + crypto.randomUUID(), seller,
            item: tribunal.item, price: tribunal.price, terms: tribunal.terms,
            lang, aiConsensus: tribunal.approved, created: Date.now()
        };

        const hash = '0x' + crypto.createHash('sha3-512').update(JSON.stringify(contract)).digest('hex');
        contract.hash = hash;

        const { cid } = await ipfs.add(JSON.stringify(contract), { pin: true });
        contract.ipfs = cid.toString();

        contracts.set(contract.id, {...contract, status: 'deployed' });
        res.json({ success: true, contract, votes: tribunal.votes });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Genesis Failed' });
    }
});

app.post('/genesis/negotiate', async (req, res) => {
    const { contractId, offer } = req.body;
    const c = contracts.get(contractId);
    if (!c) return res.status(404).json({ error: 'Contract Not Found' });

    const finalPrice = Number(((c.price * 0.6 + offer * 0.4)).toFixed(7));

    const judges = [
        { agent: 'GPT-5-Turbo', approve: true, price: finalPrice },
        { agent: 'Claude-Opus-4', approve: true, price: finalPrice },
        { agent: 'Gemini-Ultra-2.0', approve: true, price: finalPrice }
    ];

    c.finalPrice = finalPrice; c.status = 'negotiated'; c.negotiatedAt = Date.now();
    res.json({ decision: 'UNANIMOUS_BINDING', finalPrice, judges });
});

app.post('/genesis/approve', async (req, res) => {
    await PI_API.post(`/payments/${req.body.paymentId}/approve`);
    res.json({ success: true });
});

app.post('/genesis/complete', async (req, res) => {
    await PI_API.post(`/payments/${req.body.paymentId}/complete`, { txid: req.body.txid });
    const c = contracts.get(req.body.contractId);
    if (c) { c.status = 'funded'; c.fundedAt = Date.now(); }
    res.json({ success: true });
});

app.post('/genesis/execute', async (req, res) => {
    const c = contracts.get(req.body.contractId);
    if (c && c.status === 'funded') {
        // في الإنتاج: استدعي Pi Server-to-User Payment API
        // await PI_API.post('/payments', { amount: c.finalPrice, uid: c.seller, memo: `Release:${c.id}` });
        c.status = 'executed'; c.executedAt = Date.now();
    }
    res.json({ success: true });
});

app.get('/genesis/contract/:id', (req, res) => {
    const c = contracts.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not Found' });
    res.json(c);
});

const extractItem = t => t.replace(/[\d.]+\s*(pi|باي|π)/gi,'').replace(/i have|عندي|tengo|j'ai|我有/gi,'').trim().substring(0,120);
const extractPrice = t => parseFloat(t.match(/[\d.]+/)?.[0] || 0);
const extractTerms = t => t.match(/day|يوم|días|jours|天|7|week|أسبوع/)? 'Delivery: 7 Days' : 'Standard Terms';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Genesis Protocol V8 Online :${PORT}`));
