import "../core/app.js";
import { supabase } from "../core/supabaseClient.js";
import { getSubscriptionState, tierLabel } from "../core/subscription.js";
import { clearPendingPayment, readPendingPayment } from "../core/billing.js";

const status = new URLSearchParams(window.location.search).get("status");
const title = document.querySelector("#checkout-title");
const message = document.querySelector("#checkout-message");

function showOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "payment-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(11,61,82,.92);color:#fff;text-align:center;padding:24px";
  overlay.innerHTML = '<div style="width:44px;height:44px;border:4px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:payment-spin 1s linear infinite"></div><strong style="font-size:1.25rem">Processing payment</strong><span data-overlay-text>Waiting for Paystack to confirm your payment…</span><style>@keyframes payment-spin{to{transform:rotate(360deg)}}</style>';
  document.body.append(overlay);
  return overlay;
}

// Paystack confirms via webhook, so watch the user's row until it reflects the paid tier.
async function waitForFulfilment(pending, overlay) {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return;
  let finished = false;
  let timer;
  const channel = supabase
    .channel(`billing-${userId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "users", filter: `id=eq.${userId}` }, () => check())
    .subscribe();
  async function check() {
    const state = await getSubscriptionState(userId);
    if (finished || state.tier !== pending.tier || state.paymentStatus !== "active") return;
    finished = true;
    clearInterval(timer);
    channel.unsubscribe();
    clearPendingPayment();
    overlay.remove();
    title.textContent = "Payment confirmed";
    message.textContent = `Your ${tierLabel(state)} plan is now active.`;
  }
  timer = setInterval(check, 4000);
  window.addEventListener("online", check);
  check();
  setTimeout(() => {
    if (finished) return;
    overlay.remove();
    title.textContent = "Still confirming your payment";
    message.textContent = "This is taking longer than usual. Your plan will activate automatically once Paystack confirms; you can safely leave this page.";
  }, 90000);
}

if (status === "success") {
  const pending = readPendingPayment();
  title.textContent = "Processing payment";
  if (pending) {
    message.textContent = "Waiting for Paystack to confirm your payment.";
    waitForFulfilment(pending, showOverlay());
  } else {
    message.textContent = "Your payment was submitted. Your plan will update as soon as Paystack confirms it.";
  }
} else if (status === "cancelled") {
  clearPendingPayment();
  title.textContent = "Checkout cancelled";
  message.textContent = "No payment was completed. You can return to Settings and try again whenever you are ready.";
} else {
  title.textContent = "Secure checkout";
  message.textContent = "Payments are handled securely by Paystack. Return to Settings to choose a plan.";
}
