// api-server.js
// Minimal Express proxy for OpenRouteService directions, plus LogMate
// subscription billing: Paystack webhook and cancellation (see paystack.js)
// (npm i @supabase/supabase-js).
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const express = require("express");
const fetch = require("node-fetch"); // npm i node-fetch@2
const { createClient } = require("@supabase/supabase-js"); // npm i @supabase/supabase-js
const { getDmprFuelPrices } = require("./dmprFuelPrices");
const { getFuelPriceCatalog } = require("./fuelPriceApi");
const { registerPaystackRoutes } = require("./paystack");
const pricingCatalog = require("../json/pricing.json");
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  const allowedOrigins = new Set([
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://logmate.co.za"
  ]);
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin) || /^(https?|capacitor|ionic):\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()" );
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' https://esm.sh; connect-src 'self' https://*.supabase.co https://*.openrouteservice.org; font-src 'self' data:; upgrade-insecure-requests; trusted-types default;");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
// The raw body is kept so webhook HMAC signatures can be verified byte-for-byte.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

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
    const { firstName, lastName, email, password, status = "active", demeritPoints = 0, prdpNumber = null, prdpExpiryDate = null } = req.body || {};
    if (!firstName || !lastName || !email || !password) return res.status(400).json({ error: "First name, last name, email, and password are required" });
    if (!["active", "suspended"].includes(status)) return res.status(400).json({ error: "Invalid driver status" });

    const fleet = await getActiveFleetForOwner(owner.id);
    if (!fleet) return res.status(403).json({ error: "An active fleet subscription is required to add drivers" });
    const { count, error: countError } = await supabaseAdmin.from("fleet_drivers").select("id", { count: "exact", head: true }).eq("fleet_id", fleet.id);
    if (countError) throw countError;
    const driverLimit = Number(fleet.vehicle_limit || 0) * 2;
    if ((count || 0) >= driverLimit) return res.status(409).json({ error: `This fleet has reached its ${driverLimit}-driver limit` });

    const points = Number(demeritPoints);
    if (!Number.isInteger(points) || points < 0 || points > 15) return res.status(400).json({ error: "Demerit points must be a whole number from 0 to 15" });
    const normalizedEmail = email.trim().toLowerCase();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName.trim(), surname: lastName.trim(), full_name: `${firstName.trim()} ${lastName.trim()}` },
    });
    if (authError) return res.status(400).json({ error: authError.message });
    const { data: driver, error: driverError } = await supabaseAdmin.from("fleet_drivers").insert({ fleet_id: fleet.id, user_id: authData.user.id, first_name: firstName.trim(), last_name: lastName.trim(), email: normalizedEmail, status, demerit_points: points, prdp_number: prdpNumber?.trim() || null, prdp_expiry_date: prdpExpiryDate || null }).select().single();
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
    const { firstName, lastName, email, password, status, demeritPoints = 0, prdpNumber = null, prdpExpiryDate = null } = req.body || {};
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

    const points = Number(demeritPoints);
    if (!Number.isInteger(points) || points < 0 || points > 15) return res.status(400).json({ error: "Demerit points must be a whole number from 0 to 15" });
    const authUpdate = { email: email.trim().toLowerCase(), user_metadata: { first_name: firstName.trim(), surname: lastName.trim(), full_name: `${firstName.trim()} ${lastName.trim()}` } };
    if (password?.trim()) authUpdate.password = password.trim();
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(driver.user_id, authUpdate);
    if (authError) return res.status(400).json({ error: authError.message });

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("fleet_drivers")
      .update({ first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim().toLowerCase(), status, demerit_points: points, demerit_points_checked_at: new Date().toISOString(), prdp_number: prdpNumber?.trim() || null, prdp_expiry_date: prdpExpiryDate || null })
      .eq("id", driver.id)
      .eq("fleet_id", fleet.id)
      .select("id, first_name, last_name, email, status, demerit_points, demerit_points_checked_at, prdp_number, prdp_expiry_date, created_at")
      .single();
    if (updateError) return res.status(400).json({ error: updateError.message });
    return res.json({ driver: updated });
  } catch (error) {
    console.error("Update fleet driver failed:", error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Unable to update fleet driver" });
  }
});

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
  const fuelType = String(req.query.fuelType || "petrol_95").toLowerCase();
  const key = ["petrol_93", "petrol_95", "diesel_005", "diesel_05"].includes(fuelType) ? fuelType : "petrol_95";

  if (process.env.FUELPRICE_API_KEY) {
    try {
      const catalog = await getFuelPriceCatalog(key);
      return res.json(catalog);
    } catch (err) {
      console.warn("FuelPrice API unavailable; falling back to DMPR fuel prices:", err.message);
    }
  }

  try {
    const catalog = await getDmprFuelPrices();
    const prices = catalog.prices
      .map((row) => ({ region: row.region, price: row[key] }))
      .filter((row) => Number.isFinite(row.price));
    return res.json({ ...catalog, source: "DMPR", fuelType: key, prices });
  } catch (err) {
    console.error("DMPR fuel price scrape error", err);
    return res.status(502).json({ error: "DMPR fuel prices are temporarily unavailable" });
  }
});

registerPaystackRoutes(app, { supabaseAdmin, getUserFromRequest, fetch, pricing: PLAN_PRICING });

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

if (require.main === module) {
  if (!hasUsableServiceRoleKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is missing or still uses the placeholder value.");
  }
  app.listen(PORT, () =>
    console.log(`API proxy listening on http://localhost:${PORT}`),
  );
}

module.exports = app;
