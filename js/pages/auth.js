import { supabase } from "../core/supabaseClient.js";

const isOffline = () => !navigator.onLine;

async function continueWithOfflineSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) return false;

  const email = data.session.user?.email;
  if (email) {
    document.cookie = `logmate_email=${encodeURIComponent(email)}; Max-Age=31536000; Path=/; SameSite=Lax`;
  }
  window.location.href = "dashboard.html";
  return true;
}

let deferredInstallPrompt = null;
const installButton = document.querySelector("#install-app");
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.hidden = true;
});
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("../sw.js", { scope: "/" }).catch((error) => {
    console.warn("LogMate service worker registration failed", error);
  });
}

document.documentElement.dataset.theme =
  localStorage.getItem("theme") || "light";
const form = document.querySelector("#auth-form");
let signup = false;
const showForgotPassword = true;
if (new URLSearchParams(window.location.search).get("mode") === "signup") signup = true;
const title = document.querySelector("#form-title"),
  description = document.querySelector("#form-description"),
  button = document.querySelector("#submit-button"),
  switchCopy = document.querySelector("#switch-copy"),
  switchMode = document.querySelector("#switch-mode"),
  notice = document.querySelector("#auth-notice"),
  password = document.querySelector("#password"),
  passwordHelp = document.querySelector("#password-help"),
  passwordToggle = document.querySelector("#password-toggle"),
  nameFields = document.querySelector("#name-fields"),
  firstName = document.querySelector("#first-name"),
  surname = document.querySelector("#surname"),
  forgotPassword = document.querySelector("#forgot-password");
const validSignupPassword = (value) =>
  value.length >= 8 &&
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /[0-9]/.test(value);
const themeToggle = document.createElement("button");
themeToggle.type = "button";
themeToggle.className = "theme-toggle auth-theme-toggle";
themeToggle.textContent =
  document.documentElement.dataset.theme === "dark"
    ? "☼ Light mode"
    : "☾ Dark mode";
document.querySelector(".auth-box").prepend(themeToggle);
themeToggle.addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  themeToggle.textContent = theme === "dark" ? "☼ Light mode" : "☾ Dark mode";
});
passwordToggle.addEventListener("click", () => {
  const visible = password.type === "text";
  password.type = visible ? "password" : "text";
  passwordToggle.textContent = visible ? "Show" : "Hide";
  passwordToggle.setAttribute(
    "aria-label",
    visible ? "Show password" : "Hide password",
  );
});
const applyAuthMode = (isSignup) => {
  signup = isSignup;
  nameFields.hidden = !signup;
  firstName.required = signup;
  surname.required = signup;
  password.autocomplete = signup ? "new-password" : "current-password";
  passwordHelp.hidden = !signup;
  password.minLength = signup ? 8 : 1;
  title.textContent = signup
    ? "Create your logbook"
    : "Sign in to your logbook";
  description.textContent = signup
    ? "Create your account to start tracking your vehicles and fill-ups."
    : "Enter your account details to continue.";
  button.textContent = signup ? "Create account →" : "Sign in →";
  switchCopy.textContent = signup ? "Already have an account?" : "New here?";
  switchMode.textContent = signup ? "Sign in instead" : "Create an account";
  forgotPassword.hidden = !showForgotPassword || signup;
};
const updateOfflineLoginState = () => {
  const offline = isOffline();
  if (!signup) {
    button.textContent = offline ? "Continue offline →" : "Sign in →";
    description.textContent = offline
      ? "Continue with your saved account session."
      : "Enter your account details to continue.";
  }
  if (offline && !signup) {
    notice.hidden = false;
    notice.textContent = "Offline mode: your account must have been signed in online on this device before.";
  } else if (!offline && notice.textContent.startsWith("Offline mode:")) {
    notice.hidden = true;
  }
};
switchMode.addEventListener("click", () => {
  applyAuthMode(!signup);
  updateOfflineLoginState();
});
applyAuthMode(signup);
updateOfflineLoginState();
window.addEventListener("online", updateOfflineLoginState);
window.addEventListener("offline", updateOfflineLoginState);
forgotPassword.hidden = !showForgotPassword;
forgotPassword.addEventListener("click", async () => {
  if (isOffline()) {
    notice.hidden = false;
    notice.textContent = "Password reset requires an internet connection.";
    return;
  }
  const email = document.querySelector("#email").value.trim();
  if (!email) {
    notice.hidden = false;
    notice.textContent = "Enter your email address first.";
    document.querySelector("#email").focus();
    return;
  }
  forgotPassword.disabled = true;
  const redirectTo = "https://logmate.co.za/reset-password.html";
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  notice.hidden = false;
  notice.textContent = error
    ? error.message
    : "Password reset instructions have been sent to your email.";
  forgotPassword.disabled = false;
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  const email = document.querySelector("#email").value.trim(),
    passwordValue = password.value;
  if (signup && !validSignupPassword(passwordValue)) {
    notice.hidden = false;
    notice.textContent =
      "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.";
    password.focus();
    button.disabled = false;
    return;
  }
  if (isOffline()) {
    if (signup) {
      notice.hidden = false;
      notice.textContent = "Account creation requires an internet connection.";
      button.disabled = false;
      return;
    }

    try {
      if (await continueWithOfflineSession()) return;
      notice.hidden = false;
      notice.textContent =
        "You need to sign in online once before you can use LogMate offline.";
    } catch (error) {
      console.warn("Offline session could not be restored", error);
      notice.hidden = false;
      notice.textContent =
        "Your saved session could not be restored. Connect to the internet and sign in again.";
    }
    button.disabled = false;
    return;
  }
  const result = signup
    ? await supabase.auth.signUp({
        email,
        password: passwordValue,
        options: {
          data: {
            first_name: firstName.value.trim(),
            surname: surname.value.trim(),
            full_name: `${firstName.value.trim()} ${surname.value.trim()}`,
          },
        },
      })
    : await supabase.auth.signInWithPassword({
        email,
        password: passwordValue,
      });
  if (result.error) {
    notice.hidden = false;
    notice.textContent = result.error.message;
    button.disabled = false;
    return;
  }
  notice.hidden = false;
  notice.textContent =
    signup && !result.data.session
      ? "Account created. You can now sign in."
      : "Welcome back. Opening your logbook...";
  if (result.data.session)
    document.cookie = `logmate_email=${encodeURIComponent(email)}; Max-Age=31536000; Path=/; SameSite=Lax`;
  if (result.data.session)
    setTimeout(() => (window.location.href = "dashboard.html"), 350);
});
