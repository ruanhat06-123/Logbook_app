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

// ---------- Biometric (WebAuthn) login ----------
const BIOMETRIC_KEY = "logmateBiometricCredential";
const biometricButton = document.querySelector("#biometric-login");

const biometricsSupported = () =>
  typeof window !== "undefined" &&
  "PublicKeyCredential" in window &&
  typeof window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable === "function";

const getBiometricRegistration = () => {
  try {
    return JSON.parse(localStorage.getItem(BIOMETRIC_KEY) || "null");
  } catch {
    return null;
  }
};

const base64ToBytes = (value) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const bytesToBase64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function platformAuthenticatorReady() {
  if (!biometricsSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function updateBiometricButtonVisibility() {
  if (!biometricButton) return;
  const registration = getBiometricRegistration();
  biometricButton.hidden = !(registration && (await platformAuthenticatorReady()));
}

/**
 * Register this device's platform authenticator (fingerprint / face) for the
 * given account. Called once after a successful online sign-in.
 */
async function enrollBiometricForUser(user) {
  if (!user?.id || !user?.email) return;
  if (getBiometricRegistration()) return; // already enrolled on this device
  if (!(await platformAuthenticatorReady())) return;

  const wantsBiometrics = window.confirm(
    "Enable biometric sign-in on this device?\n\nNext time you can unlock your LogMate session with your fingerprint or face instead of typing your password.",
  );
  if (!wantsBiometrics) return;

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "LogMate" },
        user: {
          id: new TextEncoder().encode(user.id),
          name: user.email,
          displayName: user.email,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "discouraged",
        },
        timeout: 60000,
      },
    });

    if (!credential) return;

    localStorage.setItem(
      BIOMETRIC_KEY,
      JSON.stringify({
        credentialId: bytesToBase64(credential.rawId),
        email: user.email,
        userId: user.id,
      }),
    );
  } catch (err) {
    console.warn("Biometric enrollment failed or was cancelled:", err);
  }
}

/**
 * Verify the user with the platform authenticator, then continue with the
 * saved session on this device.
 * Returns true when the session was continued, false when biometrics failed
 * or were cancelled (in which case the caller reveals the password form).
 */
async function signInWithBiometrics({ silent = false } = {}) {
  const registration = getBiometricRegistration();
  if (!registration) return false;

  if (biometricButton) biometricButton.disabled = true;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            type: "public-key",
            id: base64ToBytes(registration.credentialId),
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    });

    if (!assertion) return false;

    // Biometric check passed — continue with the saved session.
    const continued = await continueWithOfflineSession();
    if (!continued) {
      notice.hidden = false;
      notice.textContent =
        "No saved session on this device. Sign in with your password once to use biometrics.";
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Biometric sign-in failed or was cancelled:", err);
    if (!silent) {
      notice.hidden = false;
      notice.textContent =
        "Biometric sign-in was cancelled or failed. Sign in with your password instead.";
    }
    return false;
  } finally {
    if (biometricButton) biometricButton.disabled = false;
  }
}

/**
 * Biometrics-first flow: when a credential exists on this device, hide the
 * password form and prompt for biometrics immediately. The password form is
 * only revealed when biometrics fail or are cancelled.
 */
async function startBiometricsFirstFlow() {
  if (signup) return; // account creation always shows the full form
  if (!getBiometricRegistration() || !(await platformAuthenticatorReady())) return;

  biometricMode = true;
  const formEl = document.querySelector("#auth-form");
  if (formEl) formEl.hidden = true;
  if (biometricButton) biometricButton.hidden = false;

  title.textContent = "Unlock your logbook";
  description.textContent =
    "Verify with your fingerprint or face to continue.";
  switchCopy.textContent = "Not you?";
  switchMode.textContent = "Use a different account";

  // Auto-prompt biometrics; on failure fall back to the password form.
  const succeeded = await signInWithBiometrics({ silent: true });
  if (!succeeded) exitBiometricMode(true);
}

/**
 * Leave biometrics-first mode and show the normal password form.
 */
function exitBiometricMode(showNotice) {
  if (!biometricMode) return;
  biometricMode = false;
  const formEl = document.querySelector("#auth-form");
  if (formEl) formEl.hidden = false;
  applyAuthMode(false);
  updateOfflineLoginState();
  if (showNotice) {
    notice.hidden = false;
    notice.textContent =
      "Biometric sign-in was cancelled or failed. Sign in with your password instead.";
  }
}

biometricButton?.addEventListener("click", async () => {
  const succeeded = await signInWithBiometrics();
  if (!succeeded) exitBiometricMode(false);
});
updateBiometricButtonVisibility();

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
  navigator.serviceWorker.register("../sw.js", { scope: "/" }).then((registration) => {
    // Check for an updated service worker on every load so stale cached
    // modules don't keep serving old code.
    registration.update().catch(() => {});
  }).catch((error) => {
    console.warn("LogMate service worker registration failed", error);
  });
}

document.documentElement.dataset.theme =
  localStorage.getItem("theme") || "light";
const form = document.querySelector("#auth-form");
let signup = false;
// When true, biometrics are the primary sign-in path and the password form
// stays hidden until biometrics fail or are cancelled.
let biometricMode = false;
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
  if (biometricMode) {
    // From biometrics-first mode, "Use a different account" reveals the
    // normal password form (and allows switching to sign-up).
    exitBiometricMode(false);
    return;
  }
  applyAuthMode(!signup);
  updateOfflineLoginState();
});
applyAuthMode(signup);
updateOfflineLoginState();
window.addEventListener("online", updateOfflineLoginState);
window.addEventListener("offline", updateOfflineLoginState);
// If this device has a biometric credential, make biometrics the primary
// sign-in path and only fall back to the password form on failure.
startBiometricsFirstFlow();
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
  if (result.data.session) {
    document.cookie = `logmate_email=${encodeURIComponent(email)}; Max-Age=31536000; Path=/; SameSite=Lax`;
    // Offer to enable biometric unlock for future visits (fire and forget).
    enrollBiometricForUser(result.data.session.user).then(updateBiometricButtonVisibility);
  }
  if (result.data.session)
    setTimeout(() => (window.location.href = "dashboard.html"), 350);
});
