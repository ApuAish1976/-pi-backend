import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

// ======== الإعدادات ========
const CONFIG = {
    PORT: process.env.PORT || 10000,
    PI_API_KEY: process.env.PI_API_KEY,
    PI_API_URL: 'https://api.minepi.com/v2',
    ALLOWED_ORIGINS: ['https://apuaish1976.github.io', 'https://minepi.com'],
    RATE_LIMIT: { windowMs: 15 * 60 * 1000, max: 500 },
    NODE_ENV: process.env.NODE_ENV || 'production'
};

// ======== التحقق من البيانات ========
const Schemas = {
    paymentId: z.object({ paymentId: z.string().min(10) }),
    complete: z.object({ paymentId: z.string().min(10), txid: z.string().min(10) }),
    create: z.object({
        amount: z.number().positive(),
        memo: z.string().min(1).max(250),
        metadata: z.record(z.any()).optional(),
        uid: z.string().optional()
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
                'User-Agent': 'Cortex-Escrow/3.0'
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

// ======== ROUTES ========
app.get('/', (req, res) => res.json({
    name: 'Cortex Escrow Backend',
    version: '3.0.0',
    status: 'online',
    timestamp: new Date().toISOString()
}));

app.get('/health', (req, res) => res.json({ 
    status: 'healthy', 
    uptime: Math.floor(process.uptime()),
    memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
}));

app.get('/api/me', route(null, () => PiSDK.me()));
app.get('/api/payments/incomplete', route(null, () => PiSDK.incomplete()));
app.get('/api/payments/:paymentId', route(null, ({ paymentId }) => PiSDK.get(paymentId)));
app.post('/api/payments/approve', route(Schemas.paymentId, ({ paymentId }) => PiSDK.approve(paymentId)));
app.post('/api/payments/complete', route(Schemas.complete, ({ paymentId, txid }) => PiSDK.complete(paymentId, txid)));
app.post('/api/payments/cancel', route(Schemas.paymentId, ({ paymentId }) => PiSDK.cancel(paymentId)));
app.post('/api/payments/create', route(Schemas.create, (body) => PiSDK.create(body)));

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
    console.log(`✅ Cortex v3.0 | Port: ${CONFIG.PORT} | API Key: ${CONFIG.PI_API_KEY ? 'OK' : 'MISSING'}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
