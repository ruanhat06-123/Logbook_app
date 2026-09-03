import { supabase } from "./supabaseClient.js";
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
switchMode.addEventListener("click", () => applyAuthMode(!signup));
applyAuthMode(signup);
forgotPassword.hidden = !showForgotPassword;
forgotPassword.addEventListener("click", async () => {
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
  const result = signup
    ? await supabase.auth.signUp({
        email,
        password: passwordValue,
        options: {
          emailRedirectTo: "https://logmate.co.za/html/email-verification.html",
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
      ? "Account created. Check your email to confirm your account."
      : "Welcome back. Opening your logbook...";
  if (result.data.session)
    document.cookie = `logmate_email=${encodeURIComponent(email)}; Max-Age=31536000; Path=/; SameSite=Lax`;
  if (result.data.session)
    setTimeout(() => (window.location.href = "dashboard.html"), 350);
});
