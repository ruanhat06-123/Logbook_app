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

const recovery = new Promise((resolve) => {
  let settled = false;
  let subscription;
  const finish = (session, error = null) => {
    if (settled) return;
    settled = true;
    subscription?.unsubscribe();
    resolve({ session, error });
  };
  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    if (["SIGNED_IN", "INITIAL_SESSION"].includes(event) && session) finish(session);
  });
  subscription = listener.subscription;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const tokenHash = params.get("token_hash") || params.get("token");
  const tokenType = ["signup", "email", "invite"].includes(params.get("type"))
    ? params.get("type")
    : "signup";
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  (async () => {
    if (code) {
      const authCode = new URL(window.location.href).searchParams.get("code");
      const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);
      return finish(data?.session || null, error);
    }
    if (tokenHash) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: tokenType,
      });
      return finish(data?.session || null, error);
    }
    if (accessToken && refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      return finish(data?.session || null, error);
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) return finish(data.session);
    setTimeout(() => finish(null), 3000);
  })();
});

const { session, error: verificationError } = await recovery;
const verificationComplete = Boolean(session);

if (verificationError) {
  showFailure(verificationError.message);
} else if (verificationComplete) {
  showSuccess();
} else {
  showFailure("Request a new confirmation email by creating your account again or contact support.");
}
