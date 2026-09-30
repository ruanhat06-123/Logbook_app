const path = require("node:path");
const crypto = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const port = Number(process.env.PORT || 3000);
const payfastSandbox = process.env.PAYFAST_SANDBOX !== "false";
const payfastProcessUrl = payfastSandbox
  ? "https://sandbox.payfast.co.za/eng/process"
  : "https://www.payfast.co.za/eng/process";
const payfastValidateUrl = payfastSandbox
  ? "https://sandbox.payfast.co.za/eng/query/validate"
  : "https://www.payfast.co.za/eng/query/validate";
const payfastApiUrl = requiredEnvironment("PAYFAST_API_URL").replace(/\/$/, "");
const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://logmate.co.za",
]);

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

const supabaseAdmin = createClient(
  requiredEnvironment("SUPABASE_URL"),
  requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
);

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed"));
  },
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
}));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false }));

function encodePayfast(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

function signFields(fields) {
  const query = Object.keys(fields)
    .sort()
    .filter((key) => fields[key] !== undefined && fields[key] !== "")
    .map((key) => `${key}=${encodePayfast(fields[key])}`)
    .join("&");
  return crypto
    .createHash("md5")
    .update(`${query}&passphrase=${encodePayfast(requiredEnvironment("PAYFAST_PASSPHRASE"))}`)
    .digest("hex");
}

function signAdminRequest(timestamp, version = "v1") {
  return crypto
    .createHash("md5")
    .update([
      `merchant-id=${encodePayfast(requiredEnvironment("PAYFAST_MERCHANT_ID"))}`,
      `timestamp=${encodePayfast(timestamp)}`,
      `version=${encodePayfast(version)}`,
      `passphrase=${encodePayfast(requiredEnvironment("PAYFAST_PASSPHRASE"))}`,
    ].join("&"))
    .digest("hex");
}

function safeOrigin(originUrl) {
  if (typeof originUrl !== "string" || !allowedOrigins.has(originUrl.replace(/\/$/, ""))) {
    const error = new Error("Checkout origin is not allowed");
    error.statusCode = 400;
    throw error;
  }
  return originUrl.replace(/\/$/, "");
}

async function getAuthenticatedUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    const error = new Error("Missing Authorization bearer token");
    error.statusCode = 401;
    throw error;
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    const authError = new Error("Invalid or expired session");
    authError.statusCode = 401;
    throw authError;
  }
  return data.user;
}

app.post("/api/checkout", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const userId = String(req.body?.userId || "").trim();
    const email = String(req.body?.email || user.email || "").trim();
    const origin = safeOrigin(req.body?.originUrl);
    if (!userId || userId !== user.id) return res.status(403).json({ error: "User identity mismatch" });
    if (!email || email !== user.email) return res.status(403).json({ error: "Email identity mismatch" });

    const paymentData = {
      merchant_id: requiredEnvironment("PAYFAST_MERCHANT_ID"),
      merchant_key: requiredEnvironment("PAYFAST_MERCHANT_KEY"),
      email_address: user.email,
      amount: "99.00",
      recurring_amount: "99.00",
      billing_date: new Date().toISOString().split("T")[0],
      item_name: "Monthly Premium Logbook Plan",
      m_payment_id: user.id,
      subscription_type: "1",
      frequency: "3",
      cycles: "0",
      return_url: `${origin}/html/app.html?page=checkout&status=success`,
      cancel_url: `${origin}/html/app.html?page=checkout&status=cancelled`,
      notify_url: `${requiredEnvironment("PUBLIC_API_URL")}/api/webhook/payfast`,
    };
    return res.json({ paymentData, signature: signFields(paymentData), checkoutUrl: payfastProcessUrl });
  } catch (error) {
    console.error("PayFast checkout failed", error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Checkout failed" });
  }
});

app.post("/api/webhook/payfast", async (req, res) => {
  try {
    const body = req.body || {};
    const receivedSignature = String(body.signature || "");
    const { signature, ...signedFields } = body;
    const expectedSignature = signFields(signedFields);
    if (!receivedSignature || receivedSignature !== expectedSignature) {
      console.error("PayFast webhook signature mismatch");
      return res.sendStatus(200);
    }

    const validationPayload = new URLSearchParams(
      Object.entries(body).map(([key, value]) => [key, String(value)]),
    ).toString();
    const validationResponse = await fetch(payfastValidateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: validationPayload,
    });
    if (!validationResponse.ok || (await validationResponse.text()).trim() !== "VALID") {
      console.error("PayFast webhook validation failed");
      return res.sendStatus(200);
    }

    const userId = String(body.m_payment_id || "").trim();
    if (!userId) return res.sendStatus(200);
    const update = body.payment_status === "COMPLETE"
      ? { subscription_tier: "premium", payment_status: "active", billing_cycle: "monthly", payfast_token: body.token || null, updated_at: new Date().toISOString() }
      : body.payment_status === "CANCELLED"
        ? { subscription_tier: "free", payment_status: "cancelled", billing_cycle: null, updated_at: new Date().toISOString() }
        : body.payment_status === "FAILED"
          ? { subscription_tier: "free", payment_status: "failed", billing_cycle: null, updated_at: new Date().toISOString() }
        : null;
    if (update) {
      const { error } = await supabaseAdmin.from("users").update(update).eq("id", userId);
      if (error) console.error("Supabase subscription update failed", error);
    }
  } catch (error) {
    console.error("PayFast webhook processing failed", error);
  }
  return res.sendStatus(200);
});

app.post("/api/cancel", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const { data: account, error: accountError } = await supabaseAdmin
      .from("users")
      .select("payfast_token, subscription_tier")
      .eq("id", user.id)
      .single();
    if (accountError) throw accountError;
    if (account.subscription_tier !== "premium" || !account.payfast_token) {
      return res.status(409).json({ error: "No active PayFast Premium subscription was found" });
    }

    const timestamp = new Date().toISOString();
    const version = "v1";
    const response = await fetch(`${payfastApiUrl}/subscriptions/${encodeURIComponent(account.payfast_token)}/cancel`, {
      method: "PUT",
      headers: {
        "merchant-id": requiredEnvironment("PAYFAST_MERCHANT_ID"),
        version,
        timestamp,
        signature: signAdminRequest(timestamp, version),
        Accept: "application/json",
      },
    });
    if (!response.ok) return res.status(502).json({ error: "PayFast rejected the cancellation request" });

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ subscription_tier: "free", payment_status: "cancelled", billing_cycle: null, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (updateError) throw updateError;
    return res.json({ success: true });
  } catch (error) {
    console.error("PayFast cancellation failed", error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Cancellation failed" });
  }
});

app.listen(port, () => console.log(`PayFast service listening on port ${port}`));
