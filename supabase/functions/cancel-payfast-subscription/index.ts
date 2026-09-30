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

function required(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function encodePayfast(value: string) {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function administrativeSignature(fields: Record<string, string>, passphrase: string) {
  const query = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${encodePayfast(fields[key])}`)
    .join("&");
  return createHash("md5")
    .update(`${query}&passphrase=${encodePayfast(passphrase)}`)
    .digest("hex");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Missing Authorization bearer token" }, 401);

    const supabaseUrl = required("SUPABASE_URL");
    const anonClient = createClient(supabaseUrl, required("SUPABASE_ANON_KEY"));
    const { data: userData, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !userData.user) return json({ error: "Invalid or expired session" }, 401);

    const admin = createClient(supabaseUrl, required("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: account, error: accountError } = await admin
      .from("users")
      .select("payfast_token, subscription_tier")
      .eq("id", userData.user.id)
      .single();
    if (accountError) throw accountError;
    if (account.subscription_tier !== "premium") return json({ error: "No Premium subscription is active" }, 409);
    if (!account.payfast_token) return json({ error: "No PayFast subscription token is stored" }, 409);

    const merchantId = required("PAYFAST_MERCHANT_ID");
    const version = "v1";
    const timestamp = new Date().toISOString();
    const signatureFields = { "merchant-id": merchantId, timestamp, version };
    const signature = administrativeSignature(signatureFields, required("PAYFAST_PASSPHRASE"));
    const apiBase = (Deno.env.get("PAYFAST_API_URL") || "https://api.payfast.co.za").replace(/\/$/, "");
    const payfastResponse = await fetch(`${apiBase}/subscriptions/${encodeURIComponent(account.payfast_token)}/cancel`, {
      method: "PUT",
      headers: {
        "merchant-id": merchantId,
        version,
        timestamp,
        signature,
        Accept: "application/json",
      },
    });
    if (!payfastResponse.ok) {
      const details = await payfastResponse.text();
      console.error("PayFast cancellation rejected", payfastResponse.status, details);
      return json({ error: "PayFast did not accept the cancellation request" }, 502);
    }

    const { error: updateError } = await admin
      .from("users")
      .update({ subscription_tier: "free", payment_status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", userData.user.id);
    if (updateError) throw updateError;

    return json({ success: true });
  } catch (error) {
    console.error("PayFast cancellation failed", error);
    return json({ error: error instanceof Error ? error.message : "Unable to cancel subscription" }, 500);
  }
});
