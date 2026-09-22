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
const { getDmprFuelPrices } = require("./dmprFuelPrices");
const pricingCatalog = require("../json/pricing.json");
const app = express();
app.disable("x-powered-by");
const PRODUCTION_BASE_URL = "https://logmate.co.za";
const isLocalRequest = (req) => /^(localhost|127\.0\.0\.1)$/.test(new URL(req.headers.origin || "http://localhost").hostname);
const getAppBaseUrl = (req) => {
  if (isLocalRequest(req)) return "http://localhost:5500";
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
  if (allowedOrigins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()" );
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' https://esm.sh; connect-src 'self' https://*.supabase.co https://*.openrouteservice.org https://*.payfast.co.za; font-src 'self' data:; upgrade-insecure-requests; trusted-types default;");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

// ---------------------------------------------------------------------------
// Supabase admin client (service role key — bypasses RLS, server-side only).
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ---------------------------------------------------------------------------
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const serviceRolePlaceholder = "replace-with-your-service-role-key";
const hasUsableServiceRoleKey = Boolean(
  process.env.SUPABASE_URL &&
    serviceRoleKey &&
    serviceRoleKey !== serviceRolePlaceholder,
);
const supabaseAdmin = hasUsableServiceRoleKey
  ? createClient(process.env.SUPABASE_URL, serviceRoleKey)
  : null;

const PLAN_PRICING = pricingCatalog.plans;
const SARS_EXPORT_PRICE = Number(pricingCatalog.sarsExport?.price || 0);
const PAYFAST_VALIDATE_URL = process.env.PAYFAST_SANDBOX === "false"
  ? "https://www.payfast.co.za/eng/query/validate"
  : "https://sandbox.payfast.co.za/eng/query/validate";

async function getUserFromRequest(req) {
  if (!supabaseAdmin) {
    const error = new Error("Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY in the server .env file.");
    error.statusCode = 503;
    throw error;
  }
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    const error = new Error("Missing Authorization bearer token");
    error.statusCode = 401;
    throw error;
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    console.error("Bearer validation failed:", error?.message || "Supabase returned no user");
    const authError = new Error("Invalid or expired session");
    authError.statusCode = 401;
    throw authError;
  }
  return data.user;
}

async function getActiveFleetForOwner(ownerId) {
  const { data: account, error: accountError } = await supabaseAdmin
    .from("users")
    .select("subscription_tier, subscription_expiry_date, payment_status")
    .eq("id", ownerId)
    .single();
  if (accountError) throw accountError;
  const fleetPlan = ["fleet_starter", "fleet_pro"].includes(account.subscription_tier);
  const expired = account.subscription_expiry_date && new Date(`${account.subscription_expiry_date}T23:59:59Z`) < new Date();
  if (!fleetPlan || (account.payment_status !== "active" && expired)) return null;
  const { data: fleet, error: fleetError } = await supabaseAdmin
    .from("fleets")
    .select("id, vehicle_limit")
    .eq("owner_id", ownerId)
    .single();
  if (fleetError) throw fleetError;
  return fleet;
}

app.post("/api/recaptcha/verify", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return res.status(503).json({ success: false, error: "reCAPTCHA is not configured on the server" });
  if (!token) return res.status(400).json({ success: false, error: "Missing reCAPTCHA token" });

  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: req.ip }).toString(),
    });
    const result = await response.json();
    if (!response.ok || !result.success) return res.status(400).json({ success: false, error: "Human verification failed" });
    return res.json({ success: true });
  } catch (error) {
    console.error("reCAPTCHA verification failed:", error);
    return res.status(502).json({ success: false, error: "Human verification service is unavailable" });
  }
});

app.post("/api/fleet/drivers", async (req, res) => {
  try {
    const owner = await getUserFromRequest(req);
    const { firstName, lastName, email, password, status = "active" } = req.body || {};
    if (!firstName || !lastName || !email || !password) return res.status(400).json({ error: "First name, last name, email, and password are required" });
    if (!["active", "suspended"].includes(status)) return res.status(400).json({ error: "Invalid driver status" });

    const fleet = await getActiveFleetForOwner(owner.id);
    if (!fleet) return res.status(403).json({ error: "An active fleet subscription is required to add drivers" });
    const { count, error: countError } = await supabaseAdmin.from("fleet_drivers").select("id", { count: "exact", head: true }).eq("fleet_id", fleet.id);
    if (countError) throw countError;
    const driverLimit = Number(fleet.vehicle_limit || 0) * 2;
    if ((count || 0) >= driverLimit) return res.status(409).json({ error: `This fleet has reached its ${driverLimit}-driver limit` });

    const normalizedEmail = email.trim().toLowerCase();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName.trim(), surname: lastName.trim(), full_name: `${firstName.trim()} ${lastName.trim()}` },
    });
    if (authError) return res.status(400).json({ error: authError.message });
    const { data: driver, error: driverError } = await supabaseAdmin.from("fleet_drivers").insert({ fleet_id: fleet.id, user_id: authData.user.id, first_name: firstName.trim(), last_name: lastName.trim(), email: normalizedEmail, status }).select().single();
    if (driverError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw driverError;
    }
    return res.status(201).json({ driver });
  } catch (error) {
    console.error("Create fleet driver failed:", error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Unable to create fleet driver" });
  }
});

app.patch("/api/fleet/drivers/:driverId", async (req, res) => {
  try {
    const owner = await getUserFromRequest(req);
    const { firstName, lastName, email, password, status } = req.body || {};
    if (!firstName || !lastName || !email || !["active", "suspended"].includes(status)) {
      return res.status(400).json({ error: "First name, last name, email, and status are required" });
    }
    const fleet = await getActiveFleetForOwner(owner.id);
    if (!fleet) return res.status(403).json({ error: "An active fleet subscription is required to edit drivers" });

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("fleet_drivers")
      .select("id, user_id")
      .eq("id", req.params.driverId)
      .eq("fleet_id", fleet.id)
      .single();
    if (driverError || !driver) return res.status(404).json({ error: "Driver was not found in your fleet" });

    const authUpdate = { email: email.trim().toLowerCase(), user_metadata: { first_name: firstName.trim(), surname: lastName.trim(), full_name: `${firstName.trim()} ${lastName.trim()}` } };
    if (password?.trim()) authUpdate.password = password.trim();
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(driver.user_id, authUpdate);
    if (authError) return res.status(400).json({ error: authError.message });

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("fleet_drivers")
      .update({ first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim().toLowerCase(), status })
      .eq("id", driver.id)
      .eq("fleet_id", fleet.id)
      .select("id, first_name, last_name, email, status, created_at")
      .single();
    if (updateError) return res.status(400).json({ error: updateError.message });
    return res.json({ driver: updated });
  } catch (error) {
    console.error("Update fleet driver failed:", error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Unable to update fleet driver" });
  }
});

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

app.get("/api/fuel-prices", async (req, res) => {
  try {
    const catalog = await getDmprFuelPrices();
    const fuelType = String(req.query.fuelType || "petrol_95").toLowerCase();
    const key = ["petrol_93", "petrol_95", "diesel_005", "diesel_05"].includes(fuelType) ? fuelType : "petrol_95";
    const prices = catalog.prices
      .map((row) => ({ region: row.region, price: row[key] }))
      .filter((row) => Number.isFinite(row.price));
    return res.json({ ...catalog, fuelType: key, prices });
  } catch (err) {
    console.error("DMPR fuel price scrape error", err);
    return res.status(502).json({ error: "DMPR fuel prices are temporarily unavailable" });
  }
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
      return_url: process.env.PAYFAST_RETURN_URL || `${baseUrl}/html/checkout.html?status=success&product=${encodeURIComponent(product)}${isExport ? "" : `&plan=${encodeURIComponent(tier)}`}`,
      cancel_url: process.env.PAYFAST_CANCEL_URL || `${baseUrl}/html/checkout.html?status=cancelled&product=${encodeURIComponent(product)}${isExport ? "" : `&plan=${encodeURIComponent(tier)}`}`,
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
    const host = process.env.PAYFAST_SANDBOX === "false" && !isLocalRequest(req)
      ? "www.payfast.co.za"
      : "sandbox.payfast.co.za";
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
    if (!body.signature || !process.env.PAYFAST_PASSPHRASE) {
      return res.status(400).send("Invalid notification");
    }
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

    // Confirm the complete notification with PayFast before changing billing state.
    const validationBody = Object.entries(body)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, "+")}`)
      .join("&");
    const validationResponse = await fetch(PAYFAST_VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: validationBody,
    });
    const validationText = (await validationResponse.text()).trim();
    if (!validationResponse.ok || validationText !== "VALID") {
      return res.status(400).send("Notification validation failed");
    }

    const userId = String(body.m_payment_id || "").split(":")[0];
    const tier = body.custom_str1 || "premium";
    const billingCycle = body.custom_str2 || "monthly";
    const amount = Number(body.amount_gross || 0);
    const expectedAmount = tier === "sars_export"
      ? SARS_EXPORT_PRICE
      : Number(PLAN_PRICING[tier]?.[billingCycle] || 0);

    if (!userId || !Number.isFinite(amount) || amount !== expectedAmount || (tier === "sars_export" ? billingCycle !== "one_off" : !PLAN_PRICING[tier]?.[billingCycle] || billingCycle !== "monthly")) {
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

if (require.main === module) {
  if (!hasUsableServiceRoleKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is missing or still uses the placeholder value.");
  }
  app.listen(PORT, () =>
    console.log(`API proxy listening on http://localhost:${PORT}`),
  );
}

module.exports = app;
