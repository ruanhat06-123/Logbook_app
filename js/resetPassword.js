import { supabase } from "./supabaseClient.js";

document.documentElement.dataset.theme = localStorage.getItem("theme") || "light";

const form = document.querySelector("#reset-form");
const button = document.querySelector("#reset-button");
const notice = document.querySelector("#reset-notice");
const newPassword = document.querySelector("#new-password");
const confirmPassword = document.querySelector("#confirm-password");

const showNotice = (message, isError = false) => {
  notice.hidden = false;
  notice.textContent = message;
  notice.style.background = isError ? "#fff0ec" : "";
  notice.style.color = isError ? "#ad4938" : "";
};

document.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.querySelector(`#${toggle.dataset.passwordToggle}`);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    toggle.textContent = visible ? "Show" : "Hide";
    toggle.setAttribute("aria-label", `${visible ? "Show" : "Hide"} ${input.id.replaceAll("-", " ")}`);
  });
});

const validPassword = (value) =>
  value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);

const recoverySession = new Promise((resolve) => {
  let settled = false;
  let subscription;
  const finish = (session) => {
    if (settled) return;
    settled = true;
    subscription?.unsubscribe();
    resolve(session);
  };
  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || session) finish(session);
  });
  subscription = listener.subscription;
  supabase.auth.getSession().then(async ({ data }) => {
    if (data.session) return finish(data.session);
    const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error && exchanged?.session) return finish(exchanged.session);
      }
    const tokenHash = params.get("token_hash");
    if (tokenHash) {
      const { data: verified } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });
      return finish(verified?.session || null);
    }
    setTimeout(() => finish(null), 2000);
  });
});

if (!(await recoverySession)) {
  showNotice("This reset link is invalid or has expired. Request a new one from the sign-in page.", true);
  form.hidden = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validPassword(newPassword.value)) {
    showNotice("Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.", true);
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    showNotice("Passwords do not match.", true);
    return;
  }
  button.disabled = true;
  const { error } = await supabase.auth.updateUser({ password: newPassword.value });
  if (error) {
    showNotice(error.message, true);
    button.disabled = false;
    return;
  }
  showNotice("Password updated. You can now sign in with your new password.");
  form.reset();
  setTimeout(() => { window.location.href = "index.html"; }, 1200);
});
