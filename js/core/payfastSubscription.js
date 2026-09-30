import { supabase } from "./supabaseClient.js";

const PAYFAST_CHECKOUT_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "https://sandbox.payfast.co.za/eng/process"
  : "https://www.payfast.co.za/eng/process";
const PAYFAST_API_URL = (globalThis.__ENV?.VITE_PAYFAST_API_URL || globalThis.__ENV?.VITE_API_URL || "https://[YOUR_NODE_API_URL]").replace(/\/$/, "");

function setNotice(element, message, isError = false) {
  if (!element) return;
  element.hidden = false;
  element.className = `notice${isError ? " notice-error" : ""}`;
  element.textContent = message;
}

async function getAccessToken() {
  let { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) {
    const refreshed = await supabase.auth.refreshSession();
    data = refreshed.data;
  }
  if (!data.session?.access_token) throw new Error("Your session has expired. Sign in again.");
  return data.session.access_token;
}

function renderUpgrade(target) {
  target.innerHTML = `
    <div class="billing-plan-heading"><h3>Premium monthly</h3><strong>R99/mo</strong></div>
    <p class="row-sub">Unlimited trip records, SARS-ready exports, smart analytics, and secure sync.</p>
    <form data-payfast-upgrade-form method="post" action="${PAYFAST_CHECKOUT_URL}" accept-charset="UTF-8">
      <button class="btn btn-primary" type="submit">Upgrade to Premium (R99/mo)</button>
    </form>
    <div class="notice" data-payfast-notice hidden></div>`;
}

function renderCancellation(target) {
  target.innerHTML = `
    <div class="billing-plan-heading"><h3>Premium monthly</h3><strong>R99/mo</strong></div>
    <p class="row-sub">Your Premium subscription is active. Cancel future monthly charges below.</p>
    <button class="btn btn-secondary" type="button" data-payfast-cancel>Cancel Monthly Subscription</button>
    <div class="notice" data-payfast-notice hidden></div>`;
}

export async function handleCheckout(userId, email) {
  const form = document.querySelector("[data-payfast-upgrade-form]");
  const notice = document.querySelector("[data-payfast-notice]");
  if (!form) throw new Error("Checkout form is not available.");
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Preparing secure checkout...";
  try {
    const accessToken = await getAccessToken();
    const response = await fetch(`${PAYFAST_API_URL}/api/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId, email, originUrl: window.location.origin }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Checkout signature request failed.");
    if (!data?.signature || !data?.paymentData) throw new Error("Checkout parameters were not returned.");

    form.action = data.checkoutUrl || PAYFAST_CHECKOUT_URL;
    Object.entries({ ...data.paymentData, signature: data.signature }).forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = String(value);
      form.append(input);
    });
    form.submit();
  } catch (error) {
    console.error("PayFast checkout setup failed:", error);
    setNotice(notice, error.message || "Could not start checkout. Please try again.", true);
    button.disabled = false;
    button.textContent = "Upgrade to Premium (R99/mo)";
  }
}

async function cancelSubscription(button, notice) {
  if (!window.confirm("Cancel your monthly Premium subscription? This stops future recurring charges.")) return;
  button.disabled = true;
  button.textContent = "Cancelling...";
  try {
    const accessToken = await getAccessToken();
    const response = await fetch(`${PAYFAST_API_URL}/api/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Cancellation request failed.");
    setNotice(notice, "Your subscription was cancelled. Refreshing your account...");
    window.setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    console.error("PayFast cancellation failed:", error);
    setNotice(notice, error.message || "Could not cancel your subscription. Please try again.", true);
    button.disabled = false;
    button.textContent = "Cancel Monthly Subscription";
  }
}

export async function initPayfastSubscription(target) {
  if (!target) return;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user?.id) throw new Error("Your session has expired. Sign in again.");
    const { data, error } = await supabase
      .from("users")
      .select("subscription_tier")
      .eq("id", sessionData.session.user.id)
      .single();
    if (error) throw error;

    if (data.subscription_tier === "premium") {
      renderCancellation(target);
      target.querySelector("[data-payfast-cancel]").addEventListener("click", (event) =>
        cancelSubscription(event.currentTarget, target.querySelector("[data-payfast-notice]")),
      );
      return;
    }

    renderUpgrade(target);
    target.querySelector("[data-payfast-upgrade-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      handleCheckout(sessionData.session.user.id, sessionData.session.user.email);
    });
  } catch (error) {
    console.error("PayFast subscription UI failed:", error);
    setNotice(target, "Subscription details could not be loaded.", true);
  }
}
