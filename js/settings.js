import "./app.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");
const settingsVehicles = await vehicles();
const vehicleOptions = settingsVehicles.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.number_plate || "Vehicle")} · ${escapeHtml(`${item.make || ""} ${item.model || ""}`.trim())}</option>`).join("");

await shell("settings", `
  <header class="topbar">
    <div>
      <div class="eyebrow">Account preferences</div>
      <h1>Settings.</h1>
    </div>
    <div class="top-date"><strong>YOUR ACCOUNT</strong>Personal preferences</div>
  </header>
  <div class="grid two-col">
    <section class="card">
      <div class="card-head"><h2>Account details</h2></div>
      <form id="email-form" class="form-grid">
        <div class="field full"><label for="email">Email address</label><input id="email" type="email" value="${escapeHtml(user.email || "")}" required autocomplete="email"></div>
        <div class="form-actions field full"><button class="btn btn-primary" type="submit">Update email →</button></div>
      </form>
      <div id="email-notice" class="notice" hidden></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Change password</h2></div>
      <form id="password-form" class="form-grid">
        <div class="field full"><label for="current-password">Current password</label><div class="password-field"><input id="current-password" type="password" required autocomplete="current-password"><button class="password-toggle" type="button" data-password-toggle="current-password" aria-label="Show current password">Show</button></div></div>
        <div class="field full"><label for="new-password">New password</label><div class="password-field"><input id="new-password" type="password" minlength="8" required autocomplete="new-password"><button class="password-toggle" type="button" data-password-toggle="new-password" aria-label="Show new password">Show</button></div></div>
        <div class="field full"><label for="confirm-password">Confirm new password</label><div class="password-field"><input id="confirm-password" type="password" minlength="8" required autocomplete="new-password"><button class="password-toggle" type="button" data-password-toggle="confirm-password" aria-label="Show password confirmation">Show</button></div></div>
        <div class="form-actions field full"><button class="btn btn-primary" type="submit">Change password →</button></div>
      </form>
      <div id="password-notice" class="notice" hidden></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Appearance</h2></div>
      <p class="row-sub">Choose the color theme used across your logbook.</p>
      <button id="settings-theme-toggle" class="btn btn-secondary" type="button"></button>
    </section>
    <section class="card">
      <div class="card-head"><h2>Popular settings</h2></div>
      <div class="field">
        <label for="default-trip-type">Default trip type</label>
        <select id="default-trip-type"><option value="personal">Personal</option><option value="business">Business</option></select>
      </div>
      <div class="field" style="margin-top:16px">
        <label for="default-vehicle">Default vehicle</label>
        <select id="default-vehicle"><option value="">Choose when entering a trip or fill-up</option>${vehicleOptions}</select>
      </div>
      <label class="setting-check"><input id="service-notifications" type="checkbox"> Service reminder notifications</label>
    </section>
  </div>
`);

const settingsThemeToggle = document.querySelector("#settings-theme-toggle");
const updateThemeLabel = () => {
  settingsThemeToggle.textContent = document.documentElement.dataset.theme === "dark" ? "☼ Use light mode" : "☾ Use dark mode";
};
updateThemeLabel();
settingsThemeToggle.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  updateThemeLabel();
});

const defaultTripType = document.querySelector("#default-trip-type");
defaultTripType.value = localStorage.getItem("defaultTripType") || "personal";
defaultTripType.addEventListener("change", () => localStorage.setItem("defaultTripType", defaultTripType.value));

const defaultVehicle = document.querySelector("#default-vehicle");
defaultVehicle.value = localStorage.getItem("defaultVehicle") || "";
defaultVehicle.addEventListener("change", () => localStorage.setItem("defaultVehicle", defaultVehicle.value));

const serviceNotifications = document.querySelector("#service-notifications");
serviceNotifications.checked = localStorage.getItem("serviceNotifications") !== "off";
serviceNotifications.addEventListener("change", async () => {
  localStorage.setItem("serviceNotifications", serviceNotifications.checked ? "on" : "off");
  if (serviceNotifications.checked && "Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
});

document.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.querySelector(`#${toggle.dataset.passwordToggle}`);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    toggle.textContent = visible ? "Show" : "Hide";
    toggle.setAttribute("aria-label", `${visible ? "Show" : "Hide"} ${input.id.replaceAll("-", " ")}`);
  });
});

function showNotice(id, message, isError = false) {
  const notice = document.querySelector(`#${id}`);
  notice.hidden = false;
  notice.textContent = message;
  notice.style.background = isError ? "#fff0ec" : "";
  notice.style.color = isError ? "#ad4938" : "";
}

document.querySelector("#email-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#email").value.trim();
  const { error } = await supabase.auth.updateUser({ email });
  if (error) return showNotice("email-notice", error.message, true);
  showNotice("email-notice", "Email updated. Check your inbox if confirmation is required.");
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = document.querySelector("#current-password").value;
  const password = document.querySelector("#new-password").value;
  const confirmation = document.querySelector("#confirm-password").value;
  const { error: verificationError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verificationError) return showNotice("password-notice", "Current password is incorrect.", true);
  if (password !== confirmation) return showNotice("password-notice", "Passwords do not match.", true);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return showNotice("password-notice", error.message, true);
  event.target.reset();
  showNotice("password-notice", "Password changed successfully.");
});
