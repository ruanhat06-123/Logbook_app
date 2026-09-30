import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function encodePayfast(value: unknown) {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

function signFields(fields: Record<string, string>, passphrase: string) {
  const query = Object.keys(fields)
    .sort()
    .filter((key) => fields[key] !== "")
    .map((key) => `${key}=${encodePayfast(fields[key])}`)
    .join("&");
  return createHash("md5")
    .update(`${query}&passphrase=${encodePayfast(passphrase)}`)
    .digest("hex");
}

function requireEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function validateOrigin(value: unknown) {
  const origin = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  const isAllowed = /^https:\/\/(www\.)?logmate\.co\.za$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!isAllowed) throw new Error("Checkout origin is not allowed");
  return origin;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const requestBody = await request.json().catch(() => ({}));
    const origin = validateOrigin(requestBody.originUrl);
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Missing Authorization bearer token" }, 401);

    const supabase = createClient(
      requireEnvironment("SUPABASE_URL"),
      requireEnvironment("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Invalid or expired session" }, 401);

    const merchantId = requireEnvironment("PAYFAST_MERCHANT_ID");
    const merchantKey = requireEnvironment("PAYFAST_MERCHANT_KEY");
    const passphrase = requireEnvironment("PAYFAST_PASSPHRASE");
    const userId = userData.user.id;
    const paymentData = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      email_address: userData.user.email || "",
      amount: "99.00",
      recurring_amount: "99.00",
      billing_date: new Date().toISOString().slice(0, 10),
      item_name: "Monthly Premium Logbook Plan",
      m_payment_id: userId,
      subscription_type: "1",
      frequency: "3",
      cycles: "0",
      return_url: `${origin}/html/app.html?page=checkout&status=success`,
      cancel_url: `${origin}/html/app.html?page=checkout&status=cancelled`,
    };

    return json({ paymentData, signature: signFields(paymentData, passphrase) });
  } catch (error) {
    console.error("PayFast signature generation failed", error);
    return json({ error: error instanceof Error ? error.message : "Unable to create checkout" }, 500);
  }
});
