import { supabase } from "./supabaseClient.js";

document.documentElement.dataset.theme = localStorage.getItem("theme") || "light";

const title = document.querySelector("#verification-title");
const message = document.querySelector("#verification-message");
const notice = document.querySelector("#verification-notice");
const action = document.querySelector("#verification-action");

const showFailure = (text) => {
  title.textContent = "Verification link unavailable";
  message.textContent = "This link may have expired or already been used.";
  notice.hidden = false;
  notice.textContent = text;
  notice.style.background = "#fff0ec";
  notice.style.color = "#ad4938";
  action.hidden = false;
};

const showSuccess = () => {
  title.textContent = "Email verified.";
  message.textContent = "Your LogMate account is ready. You can now sign in.";
  action.hidden = false;
  setTimeout(() => {
    window.location.href = "dashboard.html";
  }, 1800);
};

let verificationComplete = false;
const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session) {
    verificationComplete = true;
    showSuccess();
  }
});

const params = new URLSearchParams(window.location.search);
const code = params.get("code");
const tokenHash = params.get("token_hash");
let verificationError = null;

if (code) {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  verificationError = error;
  verificationComplete = Boolean(data?.session);
} else if (tokenHash) {
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "signup",
  });
  verificationError = error;
  verificationComplete = Boolean(data?.session);
} else {
  const { data } = await supabase.auth.getSession();
  verificationComplete = Boolean(data.session);
}

if (verificationError) {
  listener.subscription.unsubscribe();
  showFailure(verificationError.message);
} else if (verificationComplete) {
  listener.subscription.unsubscribe();
  showSuccess();
} else {
  listener.subscription.unsubscribe();
  showFailure("Request a new confirmation email by creating your account again or contact support.");
}
