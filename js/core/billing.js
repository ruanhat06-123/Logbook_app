import { supabase } from "./supabaseClient.js";

// Public Paystack payment-page links, one per subscription tier.
export const PAYSTACK_LINKS = {
  premium: "https://paystack.shop/pay/4yh4ylotka",
  fleet_starter: "https://paystack.shop/pay/eb43j1fldr",
  fleet_pro: "https://paystack.shop/pay/dujdt5hi8k",
};

const API_URL = (globalThis.__ENV?.VITE_API_URL || "https://logmate.co.za").replace(/\/$/, "");
export const PENDING_KEY = "logmatePendingPayment";
export const PENDING_TTL_MS = 30 * 60 * 1000;

export function readPendingPayment() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    if (!pending || Date.now() - pending.startedAt > PENDING_TTL_MS) return null;
    return pending;
  } catch {
    return null;
  }
}

export const clearPendingPayment = () => localStorage.removeItem(PENDING_KEY);

function setNotice(element, message, isError = false) {
  if (!element) return;
  element.hidden = false;
  element.className = `notice${isError ? " notice-error" : ""}`;
  element.textContent = message;
}

async function getAccessToken() {
  let { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) data = (await supabase.auth.refreshSession()).data;
  if (!data.session?.access_token) throw new Error("Your session has expired. Sign in again.");
  return data.session.access_token;
}

/** Redirect to the tier's Paystack payment page, tagged with the user so the webhook can match the payment. */
export function startCheckout(tier, user, previousTier = "free") {
  const link = PAYSTACK_LINKS[tier];
  if (!link) throw new Error("Unknown plan.");
  const url = new URL(link);
  if (user.email) url.searchParams.set("email", user.email);
  url.searchParams.set("user_id", user.id);
  url.searchParams.set(
    "custom_fields",
    JSON.stringify([{ display_name: "User ID", variable_name: "user_id", value: user.id }]),
  );
  localStorage.setItem(PENDING_KEY, JSON.stringify({ tier, previousTier, startedAt: Date.now() }));
  if (globalThis.LogMateUI?.navigateTo) globalThis.LogMateUI.navigateTo(url.toString());
  else window.location.assign(url.toString());
}

async function cancelSubscription(button, notice) {
  if (!window.confirm("Cancel your subscription? This stops future recurring charges.")) return;
  button.disabled = true;
  button.textContent = "Cancelling...";
  try {
    const response = await fetch(`${API_URL}/api/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Cancellation request failed.");
    setNotice(notice, "Your subscription was cancelled. Refreshing your account...");
    window.setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    console.error("Subscription cancellation failed:", error);
    setNotice(notice, error.message || "Could not cancel your subscription. Please try again.", true);
    button.disabled = false;
    button.textContent = "Cancel subscription";
  }
}

export async function initBilling(target, pricingCatalog) {
  if (!target) return;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) throw new Error("Your session has expired. Sign in again.");
    const { data, error } = await supabase.from("users").select("subscription_tier, payment_status").eq("id", user.id).single();
    if (error) throw error;
    const current = data.subscription_tier || "free";
    const plans = pricingCatalog?.plans || {};
    const buttons = Object.keys(PAYSTACK_LINKS)
      .filter((tier) => tier !== current)
      .map((tier) => `<button class="btn btn-primary" type="button" data-checkout-tier="${tier}">${plans[tier]?.label || tier} (${pricingCatalog?.currency || "R"}${plans[tier]?.monthly}/mo)</button>`)
      .join(" ");
    target.innerHTML = `
      <p class="row-sub">Payments are processed securely by Paystack. Use the same email as your LogMate account at checkout; your plan activates within a minute of payment.</p>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">${buttons}</div>
      ${current !== "free" && data.payment_status === "active" ? '<button class="btn btn-secondary" type="button" data-cancel-subscription style="margin-top:12px">Cancel subscription</button>' : ""}
      <div class="notice" data-billing-notice hidden></div>`;
    const notice = target.querySelector("[data-billing-notice]");
    target.querySelectorAll("[data-checkout-tier]").forEach((button) =>
      button.addEventListener("click", () => {
        try {
          startCheckout(button.dataset.checkoutTier, user, current);
        } catch (err) {
          setNotice(notice, err.message, true);
        }
      }),
    );
    target.querySelector("[data-cancel-subscription]")?.addEventListener("click", (event) =>
      cancelSubscription(event.currentTarget, notice),
    );
  } catch (error) {
    console.error("Billing UI failed:", error);
    setNotice(target, "Subscription details could not be loaded.", true);
  }
}
