// api-server.js
// Minimal Express proxy for OpenRouteService directions, plus LogMate
// subscription billing: PayFast checkout redirect and ITN webhook
// (npm i @supabase/supabase-js).
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const express = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch"); // npm i node-fetch@2
const { createClient } = require("@supabase/supabase-js"); // npm i @supabase/supabase-js
const pricingCatalog = require("../pricing.json");
const app = express();
app.disable("x-powered-by");
const PRODUCTION_BASE_URL = "https://logmate.co.za";
const getAppBaseUrl = (req) => {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  return PRODUCTION_BASE_URL;
};

app.use((req, res, next) => {
  const allowedOrigins = new Set([
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://logmate.co.za"
  ]);
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()" );
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.supabase.co https://*.openrouteservice.org https://*.payfast.co.za; font-src 'self' data:; upgrade-insecure-requests; trusted-types default;");
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

const PLAN_PRICING = pricingCatalog.plans;
const SARS_EXPORT_PRICE = Number(pricingCatalog.sarsExport?.price || 0);

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
  expiry.setMonth(expiry.getMonth() + 1);

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

async function applySuccessfulExportPayment({ userId, amount }) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.rpc("grant_sars_export_credit", {
    target_user_id: userId,
  });
  if (error) throw error;
  await supabaseAdmin.from("subscription_events").insert({
    user_id: userId,
    provider: "payfast",
    event_type: "sars_export_succeeded",
    amount,
  });
}

async function applyFailedExportPayment({ userId, amount }) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("subscription_events").insert({
    user_id: userId,
    provider: "payfast",
    event_type: "sars_export_failed",
    amount,
  });
}

const ORS_KEY = process.env.ORS_API_KEY;

app.post("/api/ors/directions", async (req, res) => {
  try {
    if (!ORS_KEY) {
      return res.status(503).json({ error: "OpenRouteService is not configured" });
    }
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

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "logmate-api", port: Number(PORT) });
});

// ---------------------------------------------------------------------------
// Checkout — builds a signed PayFast redirect URL for the chosen plan.
// ---------------------------------------------------------------------------
app.post("/api/billing/checkout", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const { product = "subscription", plan, tier = plan, billingCycle = "monthly" } = req.body || {};
    const isExport = product === "sars_export";
    if (isExport) {
      if (!SARS_EXPORT_PRICE) return res.status(503).json({ error: "Export pricing is not configured" });
    } else if (!PLAN_PRICING[tier]?.[billingCycle] || billingCycle !== "monthly" || !["premium", "fleet_starter", "fleet_pro"].includes(tier)) {
      return res.status(400).json({ error: "Unknown plan or billing cycle" });
    }
    const amount = isExport ? SARS_EXPORT_PRICE : PLAN_PRICING[tier][billingCycle];
    if (!process.env.PAYFAST_MERCHANT_ID || !process.env.PAYFAST_MERCHANT_KEY || !process.env.PAYFAST_PASSPHRASE) {
      return res.status(503).json({ error: "PayFast is not configured" });
    }

    const baseUrl = getAppBaseUrl(req);
    const metadata = isExport
      ? { product: "sars_export", billingCycle: "one_off" }
      : { product: "subscription", tier, billingCycle };

    // PayFast uses a signed redirect form rather than a hosted session API,
    // with recurring billing fields since every plan here is a subscription.
    const fields = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      return_url: process.env.PAYFAST_RETURN_URL || `${baseUrl}/${isExport ? "html/trip-report.html?billing=export-success" : "html/settings.html?billing=success"}`,
      cancel_url: process.env.PAYFAST_CANCEL_URL || `${baseUrl}/${isExport ? "html/trip-report.html?billing=export-cancelled" : "html/settings.html?billing=cancelled"}`,
      notify_url: process.env.PAYFAST_NOTIFY_URL || `${baseUrl}/api/webhooks/payfast`,
      email_address: user.email,
      amount: amount.toFixed(2),
      item_name: isExport ? "LogMate SARS PDF export" : `LogMate ${tier}`,
      m_payment_id: isExport ? `${user.id}:export:${Date.now()}` : user.id,
      custom_str1: isExport ? metadata.product : metadata.tier,
      custom_str2: metadata.billingCycle,
      ...(isExport ? {} : {
        subscription_type: "1",
        billing_date: new Date().toISOString().slice(0, 10),
        recurring_amount: amount.toFixed(2),
        frequency: "3",
        cycles: "0",
      }),
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
    const payload = {
      checkoutUrl: `https://${host}/eng/process?${query}`,
      product,
      plan: isExport ? null : tier,
      billingCycle: metadata.billingCycle,
      returnUrl: fields.return_url,
      cancelUrl: fields.cancel_url,
      notifyUrl: fields.notify_url,
    };
    return res.status(200).json(payload);
  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(err.message?.includes("session") || err.message?.includes("Authorization") ? 401 : 500).json({
      error: err.message || "Checkout failed",
    });
  }
});

app.post("/api/billing/consume-export", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!supabaseAdmin) return res.status(503).json({ error: "Billing is not configured" });
    const { data, error } = await supabaseAdmin.rpc("consume_sars_export_credit", {
      target_user_id: user.id,
    });
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "No paid SARS export is available" });
    return res.json({ consumed: true });
  } catch (err) {
    console.error("Export credit error:", err);
    return res.status(500).json({ error: "Could not authorize SARS export" });
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

    const userId = String(body.m_payment_id || "").split(":")[0];
    const tier = body.custom_str1 || "premium";
    const billingCycle = body.custom_str2 || "monthly";
    const amount = Number(body.amount_gross || 0);

    if (!userId || (tier === "sars_export" ? billingCycle !== "one_off" || amount !== SARS_EXPORT_PRICE : !PLAN_PRICING[tier]?.[billingCycle] || billingCycle !== "monthly")) {
      return res.status(400).send("Invalid payment metadata");
    }

    if (body.payment_status === "COMPLETE") {
      if (tier === "sars_export") {
        await applySuccessfulExportPayment({ userId, amount });
      } else {
        await applySuccessfulPayment({ userId, tier, billingCycle, amount });
      }
    } else if (body.payment_status === "FAILED") {
      if (tier === "sars_export") {
        await applyFailedExportPayment({ userId, amount });
      } else {
        await applyFailedPayment({ userId, amount });
      }
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
