// api-server.js
// Minimal Express proxy for OpenRouteService directions, plus LogMate
// subscription billing: PayFast checkout redirect and ITN webhook
// (npm i @supabase/supabase-js).
require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch"); // npm i node-fetch@2
const { createClient } = require("@supabase/supabase-js"); // npm i @supabase/supabase-js
const app = express();
app.use((req, res, next) => {
  const allowedOrigins = new Set([
    "http://127.0.0.1:5500",
    "http://localhost:5500",
  ]);
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

// ---------------------------------------------------------------------------
// Supabase admin client (service role key — bypasses RLS, server-side only).
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ---------------------------------------------------------------------------
const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const PLAN_PRICING = {
  premium: { monthly: 99, annual: 990 },
  fleet_starter: { monthly: 299, annual: 2990 },
  fleet_pro: { monthly: 799, annual: 7990 },
};

async function getUserFromRequest(req) {
  if (!supabaseAdmin) throw new Error("Supabase admin client not configured");
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing Authorization bearer token");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid or expired session");
  return data.user;
}

/** Apply a successful payment to a user's subscription row. */
async function applySuccessfulPayment({ userId, tier, billingCycle, amount }) {
  if (!supabaseAdmin) return;
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + (billingCycle === "annual" ? 14 : 1)); // annual = 12 + 2 free months

  await supabaseAdmin
    .from("users")
    .update({
      subscription_tier: tier,
      subscription_expiry_date: expiry.toISOString().slice(0, 10),
      payment_status: "active",
      billing_cycle: billingCycle,
    })
    .eq("id", userId);

  await supabaseAdmin.from("subscription_events").insert({
    user_id: userId,
    provider: "payfast",
    event_type: "payment_succeeded",
    amount,
  });

  // Email receipt is sent by whichever transactional-email provider LogMate
  // uses (e.g. Supabase Edge Function + Resend/SendGrid) — hook it in here.
}

/** Mark a user's subscription as failed and log the event (retry + email are handled downstream). */
async function applyFailedPayment({ userId, amount }) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("users").update({ payment_status: "failed" }).eq("id", userId);
  await supabaseAdmin.from("subscription_events").insert({
    user_id: userId,
    provider: "payfast",
    event_type: "payment_failed",
    amount,
  });
  // TODO: trigger a retry (dunning) and a "payment failed" email notification here.
}

const ORS_KEY = process.env.ORS_API_KEY;
if (!ORS_KEY) {
  console.error("ORS_API_KEY missing in .env");
  process.exit(1);
}

app.post("/api/ors/directions", async (req, res) => {
  try {
    const { coordinates } = req.body; // expect [[lon,lat],[lon,lat]]
    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }

    const body = {
      coordinates,
      format: "json",
      units: "m",
    };

    const resp = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Authorization: ORS_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const data = await resp.json();
    return res.status(resp.status).json(data);
  } catch (err) {
    console.error("ORS proxy error", err);
    return res.status(500).json({ error: "Proxy error" });
  }
});

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Checkout — builds a signed PayFast redirect URL for the chosen plan.
// ---------------------------------------------------------------------------
app.post("/api/billing/checkout", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const { tier, billingCycle } = req.body || {};
    const amount = PLAN_PRICING[tier]?.[billingCycle];
    if (!amount) return res.status(400).json({ error: "Unknown plan or billing cycle" });

    const baseUrl = process.env.APP_BASE_URL || "https://logmate.co.za";
    const metadata = { tier, billingCycle };

    // PayFast uses a signed redirect form rather than a hosted session API,
    // with recurring billing fields since every plan here is a subscription.
    const fields = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      return_url: `${baseUrl}/html/settings.html?billing=success`,
      cancel_url: `${baseUrl}/html/settings.html?billing=cancelled`,
      notify_url: `${baseUrl}/api/webhooks/payfast`,
      email_address: user.email,
      amount: amount.toFixed(2),
      item_name: `LogMate ${tier}`,
      m_payment_id: user.id,
      custom_str1: metadata.tier,
      custom_str2: metadata.billingCycle,
      subscription_type: "1",
      billing_date: new Date().toISOString().slice(0, 10),
      recurring_amount: amount.toFixed(2),
      frequency: billingCycle === "annual" ? "6" : "3", // PayFast: 3 = monthly, 6 = annual
      cycles: "0", // 0 = bill until the subscription is cancelled
    };
    const signatureString = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%20/g, "+")}`)
      .join("&");
    const signature = crypto
      .createHash("md5")
      .update(`${signatureString}&passphrase=${encodeURIComponent(process.env.PAYFAST_PASSPHRASE || "")}`)
      .digest("hex");
    const query = new URLSearchParams({ ...fields, signature }).toString();
    const host = process.env.PAYFAST_SANDBOX === "false" ? "www.payfast.co.za" : "sandbox.payfast.co.za";
    return res.json({ checkoutUrl: `https://${host}/eng/process?${query}` });
  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(401).json({ error: err.message || "Checkout failed" });
  }
});

// ---------------------------------------------------------------------------
// PayFast ITN (Instant Transaction Notification) webhook.
// ---------------------------------------------------------------------------
app.post("/api/webhooks/payfast", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const body = req.body || {};
    const { signature, ...fields } = body;
    const signatureString = Object.entries(fields)
      .map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%20/g, "+")}`)
      .join("&");
    const expectedSignature = crypto
      .createHash("md5")
      .update(`${signatureString}&passphrase=${encodeURIComponent(process.env.PAYFAST_PASSPHRASE || "")}`)
      .digest("hex");
    if (expectedSignature !== signature) {
      return res.status(400).send("Invalid signature");
    }

    const userId = body.m_payment_id;
    const tier = body.custom_str1 || "premium";
    const billingCycle = body.custom_str2 || "monthly";
    const amount = Number(body.amount_gross || 0);

    if (body.payment_status === "COMPLETE") {
      await applySuccessfulPayment({ userId, tier, billingCycle, amount });
    } else {
      await applyFailedPayment({ userId, amount });
    }

    res.send("OK");
  } catch (err) {
    console.error("PayFast webhook error:", err);
    res.status(500).send("Webhook processing error");
  }
});

app.listen(PORT, () =>
  console.log(`API proxy listening on http://localhost:${PORT}`),
);
