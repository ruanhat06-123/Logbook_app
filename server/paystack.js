// Paystack billing: webhook fulfilment and subscription cancellation.
// Required env: PAYSTACK_SECRET_KEY. Run server/sql/paystack.sql once in Supabase.
const crypto = require("crypto");

const PAYSTACK_API = "https://api.paystack.co";
// Payment-page slugs, used to identify the purchased tier when a payload carries the page URL.
const PLAN_SLUGS = { premium: "4yh4ylotka", fleet_starter: "eb43j1fldr", fleet_pro: "dujdt5hi8k" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function verifySignature(rawBody, header, secret) {
  if (!secret || !header || !rawBody) return false;
  const expected = Buffer.from(crypto.createHmac("sha512", secret).update(rawBody).digest("hex"));
  const received = Buffer.from(String(header));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

const toRand = (cents) => Number(cents || 0) / 100;
const dateOnly = (date) => date.toISOString().slice(0, 10);
const addMonth = (date) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
};

function extractUserId(data) {
  const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const field = (Array.isArray(metadata.custom_fields) ? metadata.custom_fields : []).find(
    (item) => item?.variable_name === "user_id" || item?.display_name === "User ID",
  );
  const candidate = String(metadata.user_id || metadata.userId || field?.value || "").trim();
  return UUID.test(candidate) ? candidate : null;
}

function tierFromPayload(data, pricing, amountCents) {
  const referrer = String(data?.metadata?.referrer || "");
  const bySlug = Object.entries(PLAN_SLUGS).find(([, slug]) => referrer.includes(slug))?.[0];
  const currency = data?.currency || data?.plan?.currency;
  if (currency && currency !== "ZAR") return null;
  const amount = toRand(amountCents);
  const byAmount = Object.keys(pricing).find((tier) => pricing[tier].monthly === amount);
  const tier = bySlug || byAmount || null;
  // The paid amount must equal the catalog price for the tier we are about to grant.
  return tier && pricing[tier]?.monthly === amount ? tier : null;
}

function registerPaystackRoutes(app, { supabaseAdmin, getUserFromRequest, fetch, pricing }) {
  const secret = () => String(process.env.PAYSTACK_SECRET_KEY || "").trim();

  async function findUserId(data) {
    const direct = extractUserId(data);
    if (direct) return direct;

    const code = data?.subscription_code || data?.subscription?.subscription_code;
    if (code) {
      const { data: row, error } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("paystack_subscription_code", code)
        .maybeSingle();
      if (!error && row?.id) return row.id;
    }

    const email = String(data?.customer?.email || "").trim().toLowerCase();
    if (!email) return null;
    const { data: rows, error } = await supabaseAdmin.from("users").select("id").eq("email", email).limit(2);
    if (!error && rows?.length === 1) return rows[0].id;
    // The users table may not mirror email; scan Supabase Auth as a fallback.
    for (let page = 1; page <= 5; page += 1) {
      const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (listError) break;
      const match = list.users.find((user) => String(user.email || "").toLowerCase() === email);
      if (match) return match.id;
      if (list.users.length < 1000) break;
    }
    return null;
  }

  async function claimEvent(key, eventType) {
    const { error } = await supabaseAdmin.from("paystack_events").insert({ event_key: key, event_type: eventType });
    if (!error) return true;
    if (error.code === "23505") return false;
    console.warn("paystack_events unavailable; continuing without database idempotency:", error.message);
    return true;
  }

  const releaseEvent = (key) => supabaseAdmin.from("paystack_events").delete().eq("event_key", key);

  async function grantTier({ userId, tier, expiry, amountCents, eventType }) {
    const { error } = await supabaseAdmin
      .from("users")
      .update({
        subscription_tier: tier,
        subscription_expiry_date: dateOnly(expiry),
        payment_status: "active",
        billing_cycle: "monthly",
      })
      .eq("id", userId);
    if (error) throw error;
    await supabaseAdmin
      .from("subscription_events")
      .insert({ user_id: userId, provider: "paystack", event_type: eventType, amount: toRand(amountCents) });
  }

  async function storeSubscriptionCode(userId, data) {
    const code = data?.subscription_code || data?.subscription?.subscription_code;
    if (!code) return;
    const { error } = await supabaseAdmin
      .from("users")
      .update({ paystack_subscription_code: code })
      .eq("id", userId);
    if (error) console.warn("Could not store paystack_subscription_code:", error.message);
  }

  async function handleEvent(event, data) {
    if (event === "charge.success") {
      if (data.status !== "success") return;
      const tier = tierFromPayload(data, pricing, data.amount);
      const userId = tier ? await findUserId(data) : null;
      if (!tier || !userId) return console.warn("Paystack charge ignored: tier or user could not be resolved", data.reference);
      const base = new Date(data.paid_at || Date.now());
      await grantTier({ userId, tier, expiry: addMonth(base), amountCents: data.amount, eventType: "payment_succeeded" });
      await storeSubscriptionCode(userId, data);
      return;
    }

    if (event === "subscription.create") {
      const tier = tierFromPayload(data, pricing, data.amount ?? data.plan?.amount);
      const userId = tier ? await findUserId(data) : null;
      if (!tier || !userId) return console.warn("Paystack subscription ignored: tier or user could not be resolved", data.subscription_code);
      const next = data.next_payment_date ? new Date(data.next_payment_date) : addMonth(new Date());
      await grantTier({ userId, tier, expiry: next, amountCents: data.amount ?? data.plan?.amount, eventType: "subscription_created" });
      await storeSubscriptionCode(userId, data);
      return;
    }

    if (event === "invoice.update") {
      const userId = await findUserId(data);
      if (!userId) return console.warn("Paystack invoice ignored: user could not be resolved", data.invoice_code);
      const amountCents = data.amount ?? data.subscription?.amount;
      if (data.paid === true || data.status === "success") {
        const tier = tierFromPayload(data, pricing, amountCents);
        if (!tier) return console.warn("Paystack invoice ignored: amount does not match a plan", data.invoice_code);
        const period = data.period_end || data.subscription?.next_payment_date;
        const expiry = period ? new Date(period) : addMonth(new Date(data.paid_at || Date.now()));
        await grantTier({ userId, tier, expiry, amountCents, eventType: "invoice_paid" });
      } else if (data.status === "failed") {
        const { error } = await supabaseAdmin.from("users").update({ payment_status: "failed" }).eq("id", userId);
        if (error) throw error;
        await supabaseAdmin
          .from("subscription_events")
          .insert({ user_id: userId, provider: "paystack", event_type: "payment_failed", amount: toRand(amountCents) });
      }
      return;
    }

    if (event === "subscription.disable" || event === "subscription.not_renew") {
      const userId = await findUserId(data);
      if (!userId) return;
      const { error } = await supabaseAdmin.from("users").update({ payment_status: "cancelled" }).eq("id", userId);
      if (error) throw error;
      await supabaseAdmin
        .from("subscription_events")
        .insert({ user_id: userId, provider: "paystack", event_type: "subscription_cancelled", amount: 0 });
    }
  }

  app.post("/api/webhooks/paystack", async (req, res) => {
    const rawBody = req.rawBody || (req.body ? Buffer.from(JSON.stringify(req.body)) : null);
    if (!verifySignature(rawBody, req.headers["x-paystack-signature"], secret())) {
      return res.status(401).send("Invalid signature");
    }
    if (!supabaseAdmin) return res.status(503).send("Billing is not configured");

    const { event, data } = req.body || {};
    if (!event || !data) return res.status(400).send("Invalid payload");
    // Test-mode events are ignored when running with a live key.
    if (secret().startsWith("sk_live_") && data.domain === "test") return res.status(200).send("Ignored");

    const key = `${event}:${data.id ?? data.reference ?? data.subscription_code ?? data.invoice_code}:${data.status ?? data.paid ?? ""}`;
    try {
      if (!(await claimEvent(key, event))) return res.status(200).send("Duplicate");
      try {
        await handleEvent(event, data);
      } catch (error) {
        await releaseEvent(key);
        throw error;
      }
      return res.status(200).send("OK");
    } catch (error) {
      console.error("Paystack webhook error:", error);
      return res.status(500).send("Webhook processing error");
    }
  });

  app.post("/api/cancel", async (req, res) => {
    try {
      const user = await getUserFromRequest(req);
      const { data: account, error } = await supabaseAdmin
        .from("users")
        .select("paystack_subscription_code")
        .eq("id", user.id)
        .single();
      const code = account?.paystack_subscription_code;
      if (error || !code) {
        return res.status(409).json({ error: "No Paystack subscription was found. Use the manage link in your Paystack receipt email." });
      }
      const headers = { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" };
      const details = await fetch(`${PAYSTACK_API}/subscription/${encodeURIComponent(code)}`, { headers });
      const detailsBody = await details.json().catch(() => ({}));
      const token = detailsBody?.data?.email_token;
      if (!details.ok || !token) return res.status(502).json({ error: "Could not load the subscription from Paystack" });
      const disabled = await fetch(`${PAYSTACK_API}/subscription/disable`, {
        method: "POST",
        headers,
        body: JSON.stringify({ code, token }),
      });
      if (!disabled.ok) return res.status(502).json({ error: "Paystack rejected the cancellation request" });
      const { error: updateError } = await supabaseAdmin
        .from("users")
        .update({ payment_status: "cancelled" })
        .eq("id", user.id);
      if (updateError) throw updateError;
      return res.json({ success: true });
    } catch (error) {
      console.error("Paystack cancellation failed", error);
      return res.status(error.statusCode || 500).json({ error: error.message || "Cancellation failed" });
    }
  });
}

module.exports = { registerPaystackRoutes, verifySignature };
