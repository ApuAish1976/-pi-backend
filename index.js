// ====== CORTEX ESCROW GENESIS v10.1 TESTNET SERVER ======
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { keccak256, toUtf8Bytes, encodeBytes32String } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// ====== إعدادات Testnet ======
const PORT = process.env.PORT || 3000;
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || 'pi_test_1_platform_wallet_here';
const TRIBUNAL_WALLETS = [
    process.env.AI_WALLET_1 || 'pi_test_1_ai_oracle_alpha',
    process.env.AI_WALLET_2 || 'pi_test_1_ai_oracle_beta', 
    process.env.AI_WALLET_3 || 'pi_test_1_ai_oracle_gamma'
];

// ====== محكمة الذكاء الاصطناعي التجريبية ======
function runAITribunal(text, price, dealType) {
    const forbidden = ['سلاح', 'مخدرات', 'إرهاب', 'غسيل أموال', 'تزوير', 'احتيال'];
    const textLower = text.toLowerCase();
    
    for (const word of forbidden) {
        if (textLower.includes(word)) {
            return {
                approved: false,
                reason: `المحكمة رفضت: محتوى محظور "${word}"`,
                severity: 'HIGH'
            };
        }
    }

    if (price < 0.0000001 || price > 100000) {
        return {
            approved: false,
            reason: 'السعر خارج النطاق المسموح: 0.0000001 - 100000 Test-π',
            severity: 'MEDIUM'
        };
    }

    // فحص نوع الصفقة
    const validTypes = ['digital', 'service', 'physical', 'other'];
    if (!validTypes.includes(dealType)) {
        return {
            approved: false,
            reason: 'نوع الصفقة غير صحيح',
            severity: 'LOW'
        };
    }

    return {
        approved: true,
        reason: 'تمت الموافقة من محكمة AI التجريبية',
        severity: 'NONE'
    };
}

// ====== توليد Hash للعقد ======
function generateContractHash(text, price, seller, timestamp) {
    const data = `${text}|${price}|${seller}|${timestamp}`;
    return keccak256(toUtf8Bytes(data));
}

// ====== API: إنشاء عقد جديد ======
app.post('/genesis/deploy', async (req, res) => {
    try {
        const { text, price, dealType, seller, sellerWallet, testnet } = req.body;

        // 1. التحقق من البيانات الأساسية
        if (!text || !price || !dealType || !seller) {
            return res.status(400).json({
                success: false,
                reason: 'بيانات ناقصة: text, price, dealType, seller مطلوبة'
            });
        }

        // 2. التحقق من السعر
        const priceNum = parseFloat(price);
        if (isNaN(priceNum) || priceNum < 0.0000001 || priceNum > 100000) {
            return res.status(400).json({
                success: false,
                reason: 'السعر غير صحيح. النطاق: 0.0000001 - 100000'
            });
        }

        // 3. محكمة الذكاء الاصطناعي
        const tribunal = runAITribunal(text, priceNum, dealType);
        if (!tribunal.approved) {
            return res.status(403).json({
                success: false,
                reason: tribunal.reason,
                severity: tribunal.severity
            });
        }

        // 4. توليد معرف العقد والـ Hash
        const timestamp = Date.now();
        const contractId = `TEST_GEN_${timestamp}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const hash = generateContractHash(text, priceNum, seller, timestamp);

        // 5. اختيار محافظ AI حسب testnet أو mainnet
        const wallets = testnet ? TRIBUNAL_WALLETS : [
            process.env.AI_WALLET_1_MAINNET,
            process.env.AI_WALLET_2_MAINNET,
            process.env.AI_WALLET_3_MAINNET
        ];

        // 6. الرد للفرونت
        res.json({
            success: true,
            contractId: contractId,
            hash: hash,
            tribunalWallets: wallets,
            platformWallet: PLATFORM_WALLET,
            timestamp: timestamp,
            network: testnet ? 'TESTNET' : 'MAINNET'
        });

        console.log(`[TESTNET] Contract created: ${contractId} | Seller: ${seller} | Price: ${price}`);

    } catch (error) {
        console.error('Deploy Error:', error);
        res.status(500).json({
            success: false,
            reason: 'خطأ في الخادم: ' + error.message
        });
    }
});

// ====== API: فحص حالة السيرفر ======
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        version: '10.1-TESTNET',
        timestamp: Date.now(),
        network: 'PI_TESTNET'
    });
});

// ====== API: جلب تفاصيل عقد للقراءة فقط ======
app.get('/genesis/contract/:id', (req, res) => {
    const contractId = req.params.id;
    // في النسخة الحقيقية: تجيب البيانات من قاعدة البيانات
    // هنا بس مثال للتجربة
    res.json({
        success: true,
        contractId: contractId,
        status: 'ACTIVE_TESTNET',
        message: 'هذه بيانات تجريبية. العقد الحقيقي على بلوكتشين Pi'
    });
});

// ====== تشغيل السيرفر ======
app.listen(PORT, () => {
    console.log(`🧬 CORTEX GENESIS TESTNET SERVER running on port ${PORT}`);
    console.log(`🔗 Platform Wallet: ${PLATFORM_WALLET}`);
    console.log(`🤖 AI Tribunal Wallets: ${TRIBUNAL_WALLETS.join(', ')}`);
});

module.exports = app;
