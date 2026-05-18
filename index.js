// CORTEX ESCROW - Pi Testnet Backend
// Version: 12.2-testnet

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const { keccak256, toUtf8Bytes } = require("ethers");

const app = express();

const PORT = process.env.PORT || 3000;
const PI_API_BASE = process.env.PI_API_BASE || "https://api.minepi.com/v2";
const PI_API_KEY = process.env.PI_API_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || "*";

if (!PI_API_KEY) {
  console.warn("WARNING: PI_API_KEY is missing. Pi payment endpoints will fail.");
}

app.use(cors({
  origin: APP_ORIGIN === "*" ? "*" : APP_ORIGIN,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "100kb" }));

// In-memory storage for Testnet only.
// استخدم قاعدة بيانات حقيقية لاحقًا مثل PostgreSQL / MongoDB.
const deals = new Map();
const payments = new Map();

function piHeaders() {
  return {
    headers: {
      Authorization: `Key ${PI_API_KEY}`
    }
  };
}

function generateContractHash({ text, price, seller, sellerWallet, timestamp }) {
  const data = `${text}|${price}|${seller}|${sellerWallet || ""}|${timestamp}`;
  return keccak256(toUtf8Bytes(data));
}

function normalizeDealType(type) {
  return String(type || "").trim().toLowerCase();
}

function validateDealPayload(body) {
  const text = String(body.text || "").trim();
  const seller = String(body.seller || "").trim();
  const sellerWallet = String(body.sellerWallet || "").trim();
  const dealType = normalizeDealType(body.dealType);
  const price = Number(body.price);

  const validTypes = ["digital", "service", "physical", "other"];

  if (!text || text.length < 5) {
    return { ok: false, reason: "وصف الصفقة قصير أو مفقود." };
  }

  if (!seller) {
    return { ok: false, reason: "اسم البائع مطلوب." };
  }

  if (!Number.isFinite(price) || price <= 0 || price > 100000) {
    return { ok: false, reason: "السعر غير صحيح. النطاق المسموح: أكبر من 0 وحتى 100000 Test-π." };
  }

  if (!validTypes.includes(dealType)) {
    return { ok: false, reason: "نوع الصفقة غير صحيح." };
  }

  return {
    ok: true,
    data: {
      text,
      seller,
      sellerWallet,
      dealType,
      price
    }
  };
}

function runBasicSafetyReview(text) {
  const blockedWords = [
    "مخدرات",
    "إرهاب",
    "غسيل أموال",
    "تزوير",
    "احتيال"
  ];

  const lowered = text.toLowerCase();

  for (const word of blockedWords) {
    if (lowered.includes(word)) {
      return {
        approved: false,
        reason: `تم رفض الصفقة لأنها تحتوي على محتوى محظور: ${word}`
      };
    }
  }

  return {
    approved: true,
    reason: "تم قبول الصفقة مبدئيًا للتجربة على Pi Testnet."
  };
}

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "OK",
    app: "Cortex Escrow",
    version: "12.2-testnet",
    network: "PI_TESTNET",
    timestamp: Date.now()
  });
});

// Compatibility endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "OK",
    app: "Cortex Escrow",
    version: "12.2-testnet",
    network: "PI_TESTNET",
    timestamp: Date.now()
  });
});

// Step 1: Create local escrow/deal record before Pi payment
app.post("/genesis/deploy", async (req, res) => {
  try {
    const validation = validateDealPayload(req.body);

    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        reason: validation.reason
      });
    }

    const review = runBasicSafetyReview(validation.data.text);

    if (!review.approved) {
      return res.status(403).json({
        success: false,
        reason: review.reason
      });
    }

    const timestamp = Date.now();
    const dealId = `CTX_TEST_${timestamp}_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const hash = generateContractHash({
      ...validation.data,
      timestamp
    });

    const deal = {
      dealId,
      hash,
      ...validation.data,
      status: "WAITING_FOR_PI_PAYMENT",
      network: "PI_TESTNET",
      createdAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString()
    };

    deals.set(dealId, deal);

    res.json({
      success: true,
      dealId,
      contractId: dealId,
      hash,
      amount: deal.price,
      memo: `Cortex Escrow deal ${dealId}`,
      metadata: {
        dealId,
        hash,
        app: "Cortex Escrow",
        network: "PI_TESTNET"
      },
      status: deal.status,
      review: review.reason
    });

  } catch (error) {
    console.error("Deploy error:", error);

    res.status(500).json({
      success: false,
      reason: "خطأ داخلي في الخادم."
    });
  }
});

// Step 2: Frontend calls this from onReadyForServerApproval(paymentId)
app.post("/payments/approve", async (req, res) => {
  try {
    const { paymentId, dealId } = req.body;

    if (!paymentId || !dealId) {
      return res.status(400).json({
        success: false,
        reason: "paymentId و dealId مطلوبان."
      });
    }

    const deal = deals.get(dealId);

    if (!deal) {
      return res.status(404).json({
        success: false,
        reason: "لم يتم العثور على الصفقة."
      });
    }

    // Optional: read payment before approval
    const paymentInfo = await axios.get(
      `${PI_API_BASE}/payments/${paymentId}`,
      piHeaders()
    );

    const payment = paymentInfo.data;

    if (Number(payment.amount) !== Number(deal.price)) {
      return res.status(400).json({
        success: false,
        reason: "مبلغ الدفع لا يطابق مبلغ الصفقة."
      });
    }

    if (payment.metadata && payment.metadata.dealId && payment.metadata.dealId !== dealId) {
      return res.status(400).json({
        success: false,
        reason: "بيانات الدفع لا تطابق الصفقة."
      });
    }

    const approval = await axios.post(
      `${PI_API_BASE}/payments/${paymentId}/approve`,
      null,
      piHeaders()
    );

    const now = new Date().toISOString();

    deal.status = "PI_PAYMENT_APPROVED_WAITING_USER_SIGNATURE";
    deal.paymentId = paymentId;
    deal.updatedAt = now;

    payments.set(paymentId, {
      paymentId,
      dealId,
      status: "APPROVED",
      createdAt: now,
      piPayment: approval.data
    });

    res.json({
      success: true,
      message: "تمت الموافقة على الدفع من السيرفر.",
      dealId,
      paymentId,
      payment: approval.data
    });

  } catch (error) {
    console.error("Payment approval error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      reason: "فشل اعتماد الدفع من Pi API.",
      details: error.response?.data || error.message
    });
  }
});

// Step 3: Frontend calls this from onReadyForServerCompletion(paymentId, txid)
app.post("/payments/complete", async (req, res) => {
  try {
    const { paymentId, txid, dealId } = req.body;

    if (!paymentId || !txid) {
      return res.status(400).json({
        success: false,
        reason: "paymentId و txid مطلوبان."
      });
    }

    const localPayment = payments.get(paymentId);
    const finalDealId = dealId || localPayment?.dealId;
    const deal = finalDealId ? deals.get(finalDealId) : null;

    if (!deal) {
      return res.status(404).json({
        success: false,
        reason: "لم يتم العثور على الصفقة المرتبطة بالدفع."
      });
    }

    const completion = await axios.post(
      `${PI_API_BASE}/payments/${paymentId}/complete`,
      { txid },
      piHeaders()
    );

    const now = new Date().toISOString();

    deal.status = "PAID_ON_PI_TESTNET";
    deal.paymentId = paymentId;
    deal.txid = txid;
    deal.updatedAt = now;

    payments.set(paymentId, {
      ...(localPayment || {}),
      paymentId,
      dealId: deal.dealId,
      txid,
      status: "COMPLETED",
      completedAt: now,
      piPayment: completion.data
    });

    res.json({
      success: true,
      message: "تم إكمال الدفع وتأكيد الصفقة.",
      dealId: deal.dealId,
      paymentId,
      txid,
      payment: completion.data
    });

  } catch (error) {
    console.error("Payment completion error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      reason: "فشل إكمال الدفع من Pi API.",
      details: error.response?.data || error.message
    });
  }
});

// Handle incomplete payment found by Pi.authenticate callback
app.post("/payments/incomplete", async (req, res) => {
  try {
    const { paymentId, txid, dealId } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        reason: "paymentId مطلوب."
      });
    }

    if (txid) {
      req.body = { paymentId, txid, dealId };
      return app._router.handle(req, res);
    }

    res.json({
      success: true,
      message: "تم استقبال دفعة غير مكتملة بدون txid. يمكن فحصها أو إكمالها لاحقًا.",
      paymentId
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      reason: "فشل التعامل مع الدفع غير المكتمل."
    });
  }
});

// Read deal status
app.get("/genesis/contract/:id", (req, res) => {
  const deal = deals.get(req.params.id);

  if (!deal) {
    return res.status(404).json({
      success: false,
      reason: "الصفقة غير موجودة."
    });
  }

  res.json({
    success: true,
    deal
  });
});

app.listen(PORT, () => {
  console.log(`Cortex Escrow Pi Testnet backend running on port ${PORT}`);
});

module.exports = app;