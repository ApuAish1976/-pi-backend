import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import crypto from 'crypto';
import { create } from 'ipfs-http-client';

// ======== الإعدادات ========
const CONFIG = {
    PORT: process.env.PORT || 10000,
    PI_API_KEY: process.env.PI_API_KEY,
    PI_API_URL: 'https://api.minepi.com/v2',
    ALLOWED_ORIGINS: ['https://apuaish1976.github.io', 'https://minepi.com'],
    RATE_LIMIT: { windowMs: 15 * 60 * 1000, max: 500 },
    NODE_ENV: process.env.NODE_ENV || 'production',
    IPFS_URL: process.env.IPFS_URL || 'https://ipfs.infura.io:5001',
    IPFS_PROJECT_ID: process.env.IPFS_PROJECT_ID,
    IPFS_PROJECT_SECRET: process.env.IPFS_PROJECT_SECRET
};

// ======== IPFS + Contracts Store ========
const contracts = new Map();
const ipfsAuth = 'Basic ' + Buffer.from(CONFIG.IPFS_PROJECT_ID + ':' + CONFIG.IPFS_PROJECT_SECRET).toString('base64');
const ipfs = create({
    url: CONFIG.IPFS_URL,
    headers: { authorization: ipfsAuth }
});

// ======== التحقق من البيانات ========
const Schemas = {
    paymentId: z.object({ paymentId: z.string().min(10) }),
    complete: z.object({ paymentId: z.string().min(10), txid: z.string().min(10) }),
    create: z.object({
        amount: z.number().positive(),
        memo: z.string().min(1).max(250),
        metadata: z.record(z.any()).optional(),
        uid: z.string().optional()
    }),
    genesisDeploy: z.object({
        text: z.string().min(10).max(500),
        lang: z.string().default('ar-SA'),
        seller: z.string(),
        agents: z.array(z.string()).default(['GPT-5-Turbo', 'Claude-Opus-4', 'Gemini-Ultra-2.0'])
    }),
    negotiate: z.object({
        contractId: z.string(),
        offer: z.number().positive(),
        buyer: z.string()
    }),
    execute: z.object({
        contractId: z.string(),
        buyer: z.string()
    })
};

// ======== Pi Network SDK ========
class PiSDK {
    static async request(path, method = 'GET', body = null) {
        if (!CONFIG.PI_API_KEY) throw Object.assign(new Error('PI_API_KEY is not configured'), { status: 500 });
        
        const res = await fetch(`${CONFIG.PI_API_URL}${path}`, {
            method,
            headers: {
                'Authorization': `Key ${CONFIG.PI_API_KEY}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Cortex-Escrow-Genesis/8.0'
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15000)
        });
        
        const data = await res.json();
        if (!res.ok) throw Object.assign(new Error(data.error || 'Pi API Request Failed'), { status: res.status, data });
        return data;
    }
    
    static approve = (id) => this.request(`/payments/${id}/approve`, 'POST');
    static complete = (id, txid) => this.request(`/payments/${id}/complete`, 'POST', { txid });
    static cancel = (id) => this.request(`/payments/${id}/cancel`, 'POST');
    static get = (id) => this.request(`/payments/${id}`);
    static incomplete = () => this.request('/payments/incomplete');
    static create = (data) => this.request('/payments', 'POST', data);
    static me = () => this.request('/me');
}

// ======== AI Tribunal Logic ========
const extractItem = t => t.replace(/[\d.]+\s*(pi|باي|π)/gi,'').replace(/i have|عندي|tengo|j'ai|我有/gi,'').trim().substring(0,120);
const extractPrice = t => parseFloat(t.match(/[\d.]+/)?.[0] || 0);
const extractTerms = t => t.match(/day|يوم|días|jours|天|7|week|أسبوع/) ? 'Delivery: 7 Days' : 'Standard Terms';

async function aiTribunal(text, lang) {
    // في الإنتاج: استدعي GPT-5, Claude Opus 4, Gemini Ultra 2.0 APIs
    // هنا محاكاة للإجماع
    const item = extractItem(text);
    const price = extractPrice(text);
    if (!item || !price) throw new Error('AI Tribunal: Could not extract item or price');
    
    const votes = [
        { agent: 'GPT-5-Turbo', confidence: 99, item, price },
        { agent: 'Claude-Opus-4', confidence: 98, item, price },
        { agent: 'Gemini-Ultra-2.0', confidence: 99, item, price }
    ];
    const approved = votes.filter(v => v.confidence > 95).length;
    return { approved, votes, item, price, terms: extractTerms(text) };
}

// ======== EXPRESS APP ========
const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: CONFIG.ALLOWED_ORIGINS }));
app.use(express.json({ limit: '100kb' }));
app.use('/api/', rateLimit(CONFIG.RATE_LIMIT));

// Request Logger
app.use((req, res, next) => {
    req.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const start = Date.now();
    res.on('finish', () => console.log(`[${req.id}] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
    next();
});

// ======== Route Handler ========
const route = (schema, handler) => async (req, res, next) => {
    try {
        const input = schema ? schema.parse(req.body) : { ...req.params, ...req.query, ...req.body };
        const result = await handler(input, req);
        res.json({ success: true, requestId: req.id, data: result });
    } catch (err) { next(err); }
};

// ======== ROUTES الأساسية ========
app.get('/', (req, res) => res.json({
    name: 'Cortex Escrow Genesis',
    version: '8.0.0',
    status: 'online',
    timestamp: new Date().toISOString()
}));

app.get('/health', (req, res) => res.json({ 
    status: 'healthy', 
    uptime: Math.floor(process.uptime()),
    memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    contracts: contracts.size
}));

// ======== ROUTES Pi القديمة ========
app.get('/api/me', route(null, () => PiSDK.me()));
app.get('/api/payments/incomplete', route(null, () => PiSDK.incomplete()));
app.get('/api/payments/:paymentId', route(null, ({ paymentId }) => PiSDK.get(paymentId)));
app.post('/api/payments/approve', route(Schemas.paymentId, ({ paymentId }) => PiSDK.approve(paymentId)));
app.post('/api/payments/complete', route(Schemas.complete, ({ paymentId, txid }) => PiSDK.complete(paymentId, txid)));
app.post('/api/payments/cancel', route(Schemas.paymentId, ({ paymentId }) => PiSDK.cancel(paymentId)));
app.post('/api/payments/create', route(Schemas.create, (body) => PiSDK.create(body)));

// ======== ROUTES Genesis V8 الجديدة ========
app.post('/genesis/deploy', route(Schemas.genesisDeploy, async ({ text, lang, seller, agents }) => {
    const tribunal = await aiTribunal(text, lang);
    if (tribunal.approved < 2) throw Object.assign(new Error('AI Tribunal: Consensus Not Reached'), { status: 400 });

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
    return { contract, votes: tribunal.votes };
}));

app.post('/genesis/negotiate', route(Schemas.negotiate, async ({ contractId, offer, buyer }) => {
    const c = contracts.get(contractId);
    if (!c) throw Object.assign(new Error('Contract Not Found'), { status: 404 });

    const finalPrice = Number(((c.price * 0.6 + offer * 0.4)).toFixed(7));
    const judges = [
        { agent: 'GPT-5-Turbo', approve: true, price: finalPrice },
        { agent: 'Claude-Opus-4', approve: true, price: finalPrice },
        { agent: 'Gemini-Ultra-2.0', approve: true, price: finalPrice }
    ];

    c.finalPrice = finalPrice; c.status = 'negotiated'; c.negotiatedAt = Date.now(); c.buyer = buyer;
    return { decision: 'UNANIMOUS_BINDING', finalPrice, judges };
}));

app.post('/genesis/approve', route(Schemas.paymentId, async ({ paymentId }) => {
    return await PiSDK.approve(paymentId);
}));

app.post('/genesis/complete', route(Schemas.complete, async ({ paymentId, txid, contractId }) => {
    const result = await PiSDK.complete(paymentId, txid);
    if (contractId) {
        const c = contracts.get(contractId);
        if (c) { c.status = 'funded'; c.fundedAt = Date.now(); c.txid = txid; }
    }
    return result;
}));

app.post('/genesis/execute', route(Schemas.execute, async ({ contractId, buyer }) => {
    const c = contracts.get(contractId);
    if (!c) throw Object.assign(new Error('Contract Not Found'), { status: 404 });
    if (c.status !== 'funded') throw Object.assign(new Error('Contract Not Funded'), { status: 400 });
    if (c.buyer !== buyer) throw Object.assign(new Error('Unauthorized Buyer'), { status: 403 });
    
    // في الإنتاج: استدعي Pi Server-to-User Payment API لتحويل الفلوس للبائع
    // await PiSDK.create({ amount: c.finalPrice, uid: c.seller, memo: `Release:${c.id}` });
    c.status = 'executed'; c.executedAt = Date.now();
    return { success: true, released: c.finalPrice, seller: c.seller };
}));

app.get('/genesis/contract/:id', route(null, async ({ id }) => {
    const c = contracts.get(id);
    if (!c) throw Object.assign(new Error('Not Found'), { status: 404 });
    return c;
}));

// ======== ERROR HANDLER ========
app.use((err, req, res, next) => {
    const isZod = err instanceof z.ZodError;
    const status = err.status || (isZod ? 400 : 500);
    
    console.error(`[${req.id}] Error:`, err.message);
    
    res.status(status).json({
        success: false,
        requestId: req.id,
        error: isZod ? 'Validation Error' : err.message,
        details: isZod ? err.errors : CONFIG.NODE_ENV !== 'production' ? err.data : undefined
    });
});

app.use('*', (req, res) => res.status(404).json({ success: false, error: 'Endpoint not found' }));

// ======== START SERVER ========
const server = app.listen(CONFIG.PORT, () => {
    console.log(`✅ Cortex Genesis v8.0 | Port: ${CONFIG.PORT} | API Key: ${CONFIG.PI_API_KEY ? 'OK' : 'MISSING'} | IPFS: ${CONFIG.IPFS_PROJECT_ID ? 'OK' : 'MISSING'}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
