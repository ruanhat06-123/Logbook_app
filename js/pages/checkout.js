import "../core/app.js";

const params = new URLSearchParams(window.location.search);
const status = params.get("status");
const product = params.get("product");
const plan = params.get("plan");
const title = document.querySelector("#checkout-title");
const message = document.querySelector("#checkout-message");

if (status === "success") {
  title.textContent = "Payment submitted";
  message.textContent = product === "sars_export"
    ? "Your SARS PDF export payment was submitted to PayFast. Return to the report page after the payment notification is processed."
    : `Your ${plan || "LogMate"} payment was submitted to PayFast. Your subscription will update as soon as PayFast confirms the payment.`;
} else if (status === "cancelled") {
  title.textContent = "Checkout cancelled";
  message.textContent = "No payment was completed. You can return to Settings and try again whenever you are ready.";
} else {
  title.textContent = "Secure checkout";
  message.textContent = "Payments are handled securely by PayFast. Return to Settings to choose a plan.";
}
