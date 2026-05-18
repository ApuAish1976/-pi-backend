require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const crypto = require("crypto");
const { keccak256, toUtf8Bytes } = require("ethers");

const app = express();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "production";

const PI_API_KEY = process.env.PI_API_KEY || "";
const PI_API_BASE_URL = process.env.PI_API_BASE_URL || "https://api.minepi.com/v2";

const PLATFORM_WALLET =
  process.env.PLATFORM_WALLET || "pi_test_platform_wallet_required";

const AI_WALLET_1 =
  process.env.AI_WALLET_1 || "pi_test_ai_oracle_alpha_required";
const AI_WALLET_2 =
  process.env.AI_WALLET_2 || "pi_test_ai_oracle_beta_required";
const AI_WALLET_3 =
  process.env.AI_WALLET_3 || "pi_test_ai_oracle_gamma_required";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS origin not allowed"));
    }
  })
);

app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  })
);

const contracts = new Map();

const piClient = axios.create({
  baseURL: PI_API_BASE_URL,
  timeout: 20000,
  headers: {
    Authorization: `Key ${PI_API_KEY}`,
    "Content-Type": "application/json"
  }
});

function cleanString(value, maxLength = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function isValidAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0.0000001 && amount <= 100000;
}

function isValidDealType(value) {
  return ["digital", "service", "physical", "other"].includes(value);
}

function generateContractHash(payload) {
  const data = JSON.stringify(payload);
  return keccak256(toUtf8Bytes(data));
}

function runAITribunal({ text, price, dealType }) {
  const forbiddenWords = [
    "سلاح",
    "مخدرات",
    "إرهاب",
    "غسيل أموال",
    "تزوير",
    "احتيال"
  ];

  const textLower = text.toLowerCase();

  for (const word of forbiddenWords) {
    if (textLower.includes(word)) {
      return {
        approved: false,
        reason: `المحكمة رفضت الصفقة بسبب محتوى محظور: ${word}`,
        severity: "HIGH"
      };
    }
  }

  if (!isValidAmount(price)) {
    return {
      approved: false,
      reason: "السعر خارج النطاق المسموح",
      severity: "MEDIUM"
    };
  }

  if (!isValidDealType(dealType)) {
    return {
      approved: false,
      reason: "نوع الصفقة غير صحيح",
      severity: "LOW"
    };
  }

  return {
    approved: true,
    reason: "تمت الموافقة التجريبية على الصفقة",
    severity: "NONE"
  };
}

function requirePiApiKey(req, res, next) {
  if (!PI_API_KEY) {
    return res.status(500).json({
      success: false,
      error: "PI_API_KEY is missing on the server"
    });
  }

  return next();
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "Cortex Escrow",
    version: "12.2.1",
    network: "PI_TESTNET",
    status: "running"
  });
});

app.get(["/health", "/api/health"], (req, res) => {
  res.json({
    success: true,
    status: "OK",
    app: "Cortex Escrow Backend",
    version: "12.2.1",
    network: "PI_TESTNET",
    environment: NODE_ENV,
    hasPiApiKey: Boolean(PI_API_KEY),
    timestamp: Date.now()
  });
});

app.post("/genesis/deploy", (req, res) => {
  try {
    const text = cleanString(req.body.text, 1000);
    const seller = cleanString(req.body.seller, 100);
    const sellerWallet = cleanString(req.body.sellerWallet, 200);
    const dealType = cleanString(req.body.dealType, 50);
    const price = Number(req.body.price);

    if (!text || !seller || !dealType) {
      return res.status(400).json({
        success: false,
        reason: "بيانات ناقصة: text و seller و dealType مطلوبة"
      });
    }

    if (!isValidAmount(price)) {
      return res.status(400).json({
        success: false,
        reason: "السعر غير صحيح. النطاق المسموح من 0.0000001 إلى 100000 Test-π"
      });
    }

    if (!isValidDealType(dealType)) {
      return res.status(400).json({
        success: false,
        reason: "نوع الصفقة يجب أن يكون digital أو service أو physical أو other"
      });
    }

    const tribunal = runAITribunal({ text, price, dealType });

    if (!tribunal.approved) {
      return res.status(403).json({
        success: false,
        reason: tribunal.reason,
        severity: tribunal.severity
      });
    }

    const timestamp = Date.now();
    const contractId = `TEST_GEN_${timestamp}_${crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()}`;

    const contractPayload = {
      contractId,
      text,
      price,
      dealType,
      seller,
      sellerWallet,
      platformWallet: PLATFORM_WALLET,
      tribunalWallets: [AI_WALLET_1, AI_WALLET_2, AI_WALLET_3],
      network: "PI_TESTNET",
      timestamp
    };

    const hash = generateContractHash(contractPayload);

    const contract = {
      ...contractPayload,
      hash,
      tribunal,
      status: "CREATED_TESTNET",
      payment: null
    };

    contracts.set(contractId, contract);

    return res.json({
      success: true,
      contractId,
      hash,
      status: contract.status,
      price,
      dealType,
      platformWallet: PLATFORM_WALLET,
      tribunalWallets: [AI_WALLET_1, AI_WALLET_2, AI_WALLET_3],
      network: "PI_TESTNET",
      timestamp
    });
  } catch (error) {
    console.error("Deploy error:", error);

    return res.status(500).json({
      success: false,
      reason: "خطأ داخلي في الخادم"
    });
  }
});

app.get("/genesis/contract/:id", (req, res) => {
  const contract = contracts.get(req.params.id);

  if (!contract) {
    return res.status(404).json({
      success: false,
      reason: "العقد غير موجود أو أن السيرفر أعيد تشغيله"
    });
  }

  return res.json({
    success: true,
    contract
  });
});

app.post("/payments/approve", requirePiApiKey, async (req, res) => {
  try {
    const paymentId = cleanString(req.body.paymentId || req.body.payment_id, 200);
    const contractId = cleanString(req.body.contractId || req.body.contract_id, 200);

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        reason: "paymentId مطلوب"
      });
    }

    const response = await piClient.post(`/payments/${paymentId}/approve`, null);

    if (contractId && contracts.has(contractId)) {
      const contract = contracts.get(contractId);
      contract.payment = {
        paymentId,
        approvedAt: Date.now(),
        completedAt: null,
        txid: null,
        status: "APPROVED"
      };
      contract.status = "PAYMENT_APPROVED_TESTNET";
      contracts.set(contractId, contract);
    }

    return res.json({
      success: true,
      message: "Payment approved successfully",
      paymentId,
      piPayment: response.data
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data;

    console.error("Payment approve error:", data || error.message);

    return res.status(status).json({
      success: false,
      reason: "فشل اعتماد الدفع من خادم Pi",
      details: data || error.message
    });
  }
});

app.post("/payments/complete", requirePiApiKey, async (req, res) => {
  try {
    const paymentId = cleanString(req.body.paymentId || req.body.payment_id, 200);
    const txid = cleanString(req.body.txid || req.body.txId || req.body.transactionId, 300);
    const contractId = cleanString(req.body.contractId || req.body.contract_id, 200);

    if (!paymentId || !txid) {
      return res.status(400).json({
        success: false,
        reason: "paymentId و txid مطلوبان"
      });
    }

    const response = await piClient.post(`/payments/${paymentId}/complete`, {
      txid
    });

    if (contractId && contracts.has(contractId)) {
      const contract = contracts.get(contractId);

      contract.payment = {
        ...(contract.payment || {}),
        paymentId,
        txid,
        completedAt: Date.now(),
        status: "COMPLETED"
      };

      contract.status = "PAYMENT_COMPLETED_TESTNET";
      contracts.set(contractId, contract);
    }

    return res.json({
      success: true,
      message: "Payment completed successfully",
      paymentId,
      txid,
      piPayment: response.data
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data;

    console.error("Payment complete error:", data || error.message);

    return res.status(status).json({
      success: false,
      reason: "فشل إكمال الدفع من خادم Pi",
      details: data || error.message
    });
  }
});

app.post("/payments/cancel", requirePiApiKey, async (req, res) => {
  try {
    const paymentId = cleanString(req.body.paymentId || req.body.payment_id, 200);

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        reason: "paymentId مطلوب"
      });
    }

    const response = await piClient.post(`/payments/${paymentId}/cancel`, null);

    return res.json({
      success: true,
      message: "Payment cancelled successfully",
      paymentId,
      piPayment: response.data
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data;

    console.error("Payment cancel error:", data || error.message);

    return res.status(status).json({
      success: false,
      reason: "فشل إلغاء الدفع من خادم Pi",
      details: data || error.message
    });
  }
});

app.get("/payments/:paymentId", requirePiApiKey, async (req, res) => {
  try {
    const paymentId = cleanString(req.params.paymentId, 200);

    const response = await piClient.get(`/payments/${paymentId}`);

    return res.json({
      success: true,
      paymentId,
      piPayment: response.data
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data;

    console.error("Payment get error:", data || error.message);

    return res.status(status).json({
      success: false,
      reason: "فشل جلب بيانات الدفع من خادم Pi",
      details: data || error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    reason: "Endpoint not found"
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);

  res.status(500).json({
    success: false,
    reason: "Internal server error"
  });
});

app.listen(PORT, () => {
  console.log(`Cortex Escrow Backend v12.2.1 running on port ${PORT}`);
  console.log(`Network: PI_TESTNET`);
  console.log(`Pi API configured: ${Boolean(PI_API_KEY)}`);
});

module.exports = app;