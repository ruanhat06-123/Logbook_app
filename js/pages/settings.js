import "../core/app.js";
import { setupTermsConsent } from "../core/consent.js";
import { getFleetContext, isFleetDriver } from "../core/fleetAccess.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");
const fleetContext = await getFleetContext(user);
const driverView = isFleetDriver(fleetContext);
const settingsVehicles = await vehicles();
const vehicleOptions = settingsVehicles.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.number_plate || "Vehicle")} · ${escapeHtml(`${item.make || ""} ${item.model || ""}`.trim())}</option>`).join("");

const subscriptionState = await syncSubscription(user.id);
const pricingCatalog = await fetch("../json/pricing.json").then((response) => response.json());
const freeFeatures = [
  `${FREE_TRIP_LIMIT} trip records per month`,
  "Fuel and fill-up logging",
  "Manual trip records and odometer history",
  "Offline logging on this device",
];
const PLANS = Object.entries(pricingCatalog.plans).map(([tier, plan]) =>
  ({
    tier,
    cycle: "monthly",
    label: plan.label,
    price: `${pricingCatalog.currency}${plan.monthly}/mo`,
    features: plan.features || [],
  }),
);
const planButtons = PLANS.map(
  (plan) =>
    `<article class="billing-plan${subscriptionState.tier === plan.tier ? " billing-plan-current" : ""}">
      <div class="billing-plan-heading"><h3>${escapeHtml(plan.label)}</h3><strong>${escapeHtml(plan.price)}</strong></div>
      <p class="billing-plan-caption">Includes:</p>
      <ul class="billing-plan-features">${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>
      <button class="btn btn-secondary" type="button" data-checkout-tier="${plan.tier}" data-checkout-cycle="${plan.cycle}">${subscriptionState.tier === plan.tier ? "Renew or manage" : `Choose ${escapeHtml(plan.label)}`}</button>
    </article>`,
).join("");

await shell("settings", `
  <style>
    .settings-category-nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .settings-category-nav button[aria-selected="true"] { background: var(--teal-deep); color: #fff; border-color: var(--teal-deep); }
    .settings-category-nav button { min-height: 40px; }
  </style>
  <header class="topbar">
    <div>
      <div class="eyebrow">Account preferences</div>
      <h1>Settings.</h1>
    </div>
    <div class="top-date"><strong>YOUR ACCOUNT</strong>Personal preferences</div>
  </header>
  <nav class="settings-category-nav" aria-label="Settings categories">
    <button class="btn btn-secondary" type="button" data-settings-category="account" aria-selected="true">Account</button>
    ${driverView ? "" : '<button class="btn btn-secondary" type="button" data-settings-category="billing" aria-selected="false">Billing</button>'}
    <button class="btn btn-secondary" type="button" data-settings-category="appearance" aria-selected="false">Appearance</button>
    <button class="btn btn-secondary" type="button" data-settings-category="activity" aria-selected="false">Trips &amp; analytics</button>
    <button class="btn btn-secondary" type="button" data-settings-category="security" aria-selected="false">Security</button>
    <button class="btn btn-secondary" type="button" data-settings-category="data" aria-selected="false">Data &amp; privacy</button>
  </nav>
  <div class="field settings-search-field">
    <label for="settings-search">Search settings</label>
    <input id="settings-search" type="search" placeholder="Search by setting or keyword" autocomplete="off">
  </div>
  <div class="grid two-col" id="settings-sections">
    <section class="card" data-settings-section="account">
      <div class="card-head"><h2>Account details</h2></div>
      <form id="email-form" class="form-grid">
        <div class="field full"><label for="email">Email address</label><input id="email" type="email" value="${escapeHtml(user.email || "")}" required autocomplete="email"></div>
        <div class="form-actions field full"><button class="btn btn-primary" type="submit">Update email →</button></div>
      </form>
      <div id="email-notice" class="notice" hidden></div>
    </section>
    <section class="card" data-settings-section="account">
      <div class="card-head"><h2>Change password</h2></div>
      <form id="password-form" class="form-grid">
        <div class="field full"><label for="current-password">Current password</label><div class="password-field"><input id="current-password" type="password" required autocomplete="current-password"><button class="password-toggle" type="button" data-password-toggle="current-password" aria-label="Show current password">Show</button></div></div>
        <div class="field full"><label for="new-password">New password</label><div class="password-field"><input id="new-password" type="password" minlength="8" required autocomplete="new-password"><button class="password-toggle" type="button" data-password-toggle="new-password" aria-label="Show new password">Show</button></div></div>
        <div class="field full"><label for="confirm-password">Confirm new password</label><div class="password-field"><input id="confirm-password" type="password" minlength="8" required autocomplete="new-password"><button class="password-toggle" type="button" data-password-toggle="confirm-password" aria-label="Show password confirmation">Show</button></div></div>
        <div class="form-actions field full"><button class="btn btn-primary" type="submit">Change password →</button></div>
      </form>
      <div id="password-notice" class="notice" hidden></div>
    </section>
    ${driverView ? "" : `<section class="card" id="billing" data-settings-section="billing">
      <div class="card-head"><h2>Subscription &amp; billing</h2></div>
      <p class="row-sub">Current plan: <strong>${escapeHtml(tierLabel(subscriptionState))}</strong> · Payment status: <strong>${escapeHtml(subscriptionState.paymentStatus)}</strong>${subscriptionState.expiryDate ? ` · Renews/expires ${escapeHtml(dateText(subscriptionState.expiryDate))}` : ""}</p>
      <div class="billing-current-summary">
        <strong>You are currently paying for:</strong>
        <ul class="billing-plan-features">${(subscriptionState.tier === "free" ? freeFeatures : pricingCatalog.plans[subscriptionState.tier]?.features || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>
      </div>
      <p class="row-sub">Choose a plan below to compare exactly what it includes. Premium and Fleet include SARS PDF exports; Free users can buy one for R${Number(pricingCatalog.sarsExport?.price || 99).toFixed(0)}.</p>
      <div class="billing-plan-grid">${planButtons}</div>
      <div id="billing-notice" class="notice" hidden></div>
    </section>`}
    <section class="card" data-settings-section="appearance">
      <div class="card-head"><h2>Appearance</h2></div>
      <p class="row-sub">Choose the color theme used across your logbook.</p>
      <button id="settings-theme-toggle" class="btn btn-secondary" type="button"></button>
    </section>
    <section class="card" data-settings-section="security">
      <div class="card-head"><h2>Biometric sign-in</h2></div>
      <p class="row-sub">Unlock your LogMate session on this device with your fingerprint or face instead of typing your password.</p>
      <div id="biometric-status" class="notice" hidden></div>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button id="biometric-enable" class="btn btn-primary" type="button" hidden>Enable biometrics →</button>
        <button id="biometric-disable" class="btn btn-secondary" type="button" hidden>Disable biometrics</button>
      </div>
    </section>
    <section class="card" data-settings-section="activity">
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
      <label class="setting-check"><input id="trip-notifications" type="checkbox"> Live trip tracking notifications <small class="row-sub" style="display:block;margin-top:4px">Shows your current trip distance while you drive, with an End trip action.</small></label>
      <label class="setting-check"><input id="smart-trips" type="checkbox"> Smart Trips <small class="row-sub" style="display:block;margin-top:4px">Automatically starts after sustained movement and prompts you to review details when you stop.</small></label>
    </section>
    ${isPremiumTier(subscriptionState) ? `<section class="card" id="analytics-feature-settings" data-settings-section="activity">
      <div class="card-head"><h2>Analytics sensitivity</h2></div>
      <p class="row-sub">Adjust how much variation LogMate allows before analytics flags an unusual trip or fill-up.</p>
      <div class="form-grid">
        <div class="field">
          <label for="analytics-anomaly-margin">Analytics anomaly margin (%)</label>
          <input id="analytics-anomaly-margin" type="number" min="5" max="100" step="1" inputmode="numeric">
          <small class="field-help">A larger margin produces fewer anomaly alerts.</small>
        </div>
        <div class="field">
          <label for="analytics-efficiency-margin">Fuel efficiency drop alert (%)</label>
          <input id="analytics-efficiency-margin" type="number" min="5" max="100" step="1" inputmode="numeric">
          <small class="field-help">Alert when efficiency drops by at least this percentage.</small>
        </div>
      </div>
      <div id="analytics-settings-notice" class="notice" hidden></div>
    </section>
    <section class="card" id="smart-feature-settings" data-settings-section="activity" hidden>
      <div class="card-head"><h2>Smart Trips sensitivity</h2></div>
      <p class="row-sub">Adjust how quickly Smart Trips starts or ends tracking.</p>
      <div class="form-grid">
        <div class="field">
          <label for="smart-start-speed">Smart Trips start speed (km/h)</label>
          <input id="smart-start-speed" type="number" min="5" max="80" step="0.5" inputmode="decimal">
        </div>
        <div class="field">
          <label for="smart-start-distance">Smart Trips movement margin (m)</label>
          <input id="smart-start-distance" type="number" min="5" max="200" step="1" inputmode="numeric">
        </div>
        <div class="field">
          <label for="smart-stop-minutes">Smart Trips stop margin (minutes)</label>
          <input id="smart-stop-minutes" type="number" min="1" max="30" step="1" inputmode="numeric">
        </div>
      </div>
      <div id="smart-settings-notice" class="notice" hidden></div>
    </section>` : ""}
    <section class="card" data-settings-section="appearance">
      <div class="card-head"><h2>Map preferences</h2></div>
      <div class="field">
        <label for="map-theme">Map theme</label>
        <select id="map-theme"><option value="">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select>
      </div>
    </section>
    <section class="card" data-settings-section="data">
      <div class="card-head"><h2>Offline data</h2></div>
      <p class="row-sub">LogMate stores trip coordinates and cached data on this device so you can work offline. Clear it if you're switching accounts or want to free up space.</p>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button id="clear-offline-data" class="btn btn-secondary" type="button">Clear offline data</button>
      </div>
      <div id="offline-data-notice" class="notice" hidden></div>
    </section>
    <section class="card terms-settings-card" data-settings-section="data">
      <div class="card-head"><h2>Terms and Conditions</h2></div>
      <p class="row-sub">Review the terms governing LogMate, your vehicle records, SARS-supporting reports, privacy and copyright.</p>
      <div class="consent-warning" data-terms-warning role="alert">
        <p>⚠️ Action Required: You have not accepted our updated Terms and Conditions. Please review and accept them now to continue using SARS-compliant logging.</p>
      </div>
      <div class="terms-review-actions">
        <button class="btn btn-primary" type="button" data-review-terms>Read Terms and Conditions</button>
      </div>
    </section>
  </div>
`);

setupTermsConsent();

const settingsCategoryButtons = [...document.querySelectorAll("[data-settings-category]")];
const settingsSections = [...document.querySelectorAll("[data-settings-section]")];
const settingsSearch = document.querySelector("#settings-search");
let activeSettingsCategory = !driverView && window.location.hash === "#billing"
  ? "billing"
  : localStorage.getItem("settingsCategory") || "account";

const showSettingsCategory = (category) => {
  activeSettingsCategory = settingsCategoryButtons.some((button) => button.dataset.settingsCategory === category)
    ? category
    : "account";
  settingsCategoryButtons.forEach((button) => {
    const selected = button.dataset.settingsCategory === activeSettingsCategory;
    button.setAttribute("aria-selected", String(selected));
  });
  settingsSections.forEach((section) => {
    section.hidden = section.dataset.settingsSection !== activeSettingsCategory;
  });
  localStorage.setItem("settingsCategory", activeSettingsCategory);
};

const applySettingsSearch = () => {
  const query = settingsSearch.value.trim().toLowerCase();
  if (!query) {
    showSettingsCategory(activeSettingsCategory);
    return;
  }

  settingsCategoryButtons.forEach((button) => button.setAttribute("aria-selected", "false"));
  settingsSections.forEach((section) => {
    const unavailableSmartSettings = section.id === "smart-feature-settings" && !smartTrips.checked;
    section.hidden = unavailableSmartSettings || !section.textContent.toLowerCase().includes(query);
  });
};

settingsSearch.addEventListener("input", applySettingsSearch);

settingsCategoryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showSettingsCategory(button.dataset.settingsCategory);
    if (smartFeatureSettings) {
      smartFeatureSettings.hidden = !smartTrips.checked || activeSettingsCategory !== "activity";
    }
  });
});
showSettingsCategory(activeSettingsCategory);

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

const tripNotifications = document.querySelector("#trip-notifications");
tripNotifications.checked = localStorage.getItem("tripNotifications") !== "off";
tripNotifications.addEventListener("change", async () => {
  localStorage.setItem("tripNotifications", tripNotifications.checked ? "on" : "off");
  if (tripNotifications.checked && "Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
});

const smartTrips = document.querySelector("#smart-trips");
smartTrips.checked = localStorage.getItem("smartTrips") === "on";
const smartFeatureSettings = document.querySelector("#smart-feature-settings");
const updateSmartFeatureSettingsVisibility = () => {
  if (smartFeatureSettings) {
    smartFeatureSettings.hidden = !smartTrips.checked || activeSettingsCategory !== "activity";
  }
  if (settingsSearch.value) applySettingsSearch();
};
updateSmartFeatureSettingsVisibility();
smartTrips.addEventListener("change", async () => {
  localStorage.setItem("smartTrips", smartTrips.checked ? "on" : "off");
  updateSmartFeatureSettingsVisibility();
  if (smartTrips.checked && "Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
});

const smartSettingFields = [
  ["#smart-start-speed", "smartTripStartSpeedKph", 10.8, 5, 80],
  ["#smart-start-distance", "smartTripStartDistanceMeters", 25, 5, 200],
  ["#smart-stop-minutes", "smartTripStopMinutes", 3, 1, 30],
];
smartSettingFields.forEach(([selector, key, fallback, min, max]) => {
  const input = document.querySelector(selector);
  const stored = Number(localStorage.getItem(key));
  input.value = Number.isFinite(stored) && stored >= min && stored <= max ? stored : fallback;
  input.addEventListener("change", () => {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < min || value > max) {
      input.value = localStorage.getItem(key) || fallback;
      showNotice("smart-settings-notice", `Enter a value between ${min} and ${max}.`, true);
      return;
    }
    localStorage.setItem(key, String(value));
    showNotice("smart-settings-notice", "Smart Trips settings saved.");
  });
});

const analyticsSettingFields = [
  ["#analytics-anomaly-margin", "analyticsAnomalyMarginPct", 20, 5, 100],
  ["#analytics-efficiency-margin", "analyticsEfficiencyDropPct", 15, 5, 100],
];
analyticsSettingFields.forEach(([selector, key, fallback, min, max]) => {
  const input = document.querySelector(selector);
  const stored = Number(localStorage.getItem(key));
  input.value = Number.isFinite(stored) && stored >= min && stored <= max ? stored : fallback;
  input.addEventListener("change", () => {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < min || value > max) {
      input.value = localStorage.getItem(key) || fallback;
      showNotice("analytics-settings-notice", `Enter a value between ${min} and ${max}.`, true);
      return;
    }
    localStorage.setItem(key, String(value));
    showNotice("analytics-settings-notice", "Analytics settings saved.");
  });
});

// ---------- Biometric sign-in management ----------
const BIOMETRIC_KEY = "logmateBiometricCredential";
const biometricStatus = document.querySelector("#biometric-status");
const biometricEnableBtn = document.querySelector("#biometric-enable");
const biometricDisableBtn = document.querySelector("#biometric-disable");

const getBiometricRegistration = () => {
  try {
    return JSON.parse(localStorage.getItem(BIOMETRIC_KEY) || "null");
  } catch {
    return null;
  }
};

const biometricsSupported = async () => {
  if (
    !("PublicKeyCredential" in window) ||
    typeof window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable !== "function"
  ) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

const showBiometricStatus = (message, isError = false) => {
  biometricStatus.hidden = !message;
  biometricStatus.textContent = message;
  biometricStatus.style.background = isError ? "#fff0ec" : "";
  biometricStatus.style.color = isError ? "#ad4938" : "";
};

const refreshBiometricUi = async () => {
  const registration = getBiometricRegistration();
  const supported = await biometricsSupported();

  if (!supported) {
    biometricEnableBtn.hidden = true;
    biometricDisableBtn.hidden = true;
    showBiometricStatus("This device or browser does not support biometric sign-in.", true);
    return;
  }

  if (registration) {
    biometricEnableBtn.hidden = true;
    biometricDisableBtn.hidden = false;
    showBiometricStatus(`Biometric sign-in is enabled for ${registration.email || "this account"} on this device.`);
  } else {
    biometricEnableBtn.hidden = false;
    biometricDisableBtn.hidden = true;
    showBiometricStatus("Biometric sign-in is not enabled on this device.");
  }
};

biometricEnableBtn?.addEventListener("click", async () => {
  biometricEnableBtn.disabled = true;
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
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "discouraged",
        },
        timeout: 60000,
      },
    });

    if (!credential) {
      showBiometricStatus("Biometric enrollment was cancelled.", true);
      return;
    }

    localStorage.setItem(
      BIOMETRIC_KEY,
      JSON.stringify({
        credentialId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
        email: user.email,
        userId: user.id,
      }),
    );
    showBiometricStatus("Biometric sign-in enabled. Next time you can unlock LogMate with your fingerprint or face.");
    await refreshBiometricUi();
  } catch (err) {
    console.warn("Biometric enrollment failed:", err);
    showBiometricStatus("Biometric enrollment failed or was cancelled.", true);
  } finally {
    biometricEnableBtn.disabled = false;
  }
});

biometricDisableBtn?.addEventListener("click", () => {
  localStorage.removeItem(BIOMETRIC_KEY);
  showBiometricStatus("Biometric sign-in has been disabled on this device.");
  refreshBiometricUi();
});

refreshBiometricUi();

// ---------- Map theme preference ----------
const mapThemeSelect = document.querySelector("#map-theme");
mapThemeSelect.value = localStorage.getItem("mapTheme") || "";
mapThemeSelect.addEventListener("change", () => {
  if (mapThemeSelect.value) localStorage.setItem("mapTheme", mapThemeSelect.value);
  else localStorage.removeItem("mapTheme");
});

// ---------- Clear offline data ----------
document.querySelector("#clear-offline-data")?.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Clear all offline data stored on this device?\n\nThis removes cached trip coordinates, pending trip data, geocoded address lookups, and report caches. Your account data in the cloud is not affected.",
  );
  if (!confirmed) return;

  try {
    // Clear IndexedDB-backed local stores
    const { setLocalStore } = await import("../core/localStore.js");
    await setLocalStore("tripCoordinates", []);
    await setLocalStore("cachedTripPayload", null);
    await setLocalStore("pendingTripData", null);
    await setLocalStore("activeTripSession", null);
    await setLocalStore("pendingTrips", []);
    await setLocalStore("syncedTrips", []);

    // Clear geocode cache entries from localStorage (they are prefixed)
    const geoKeys = Object.keys(localStorage).filter((key) =>
      key.startsWith("idb_geocache_"),
    );
    geoKeys.forEach((key) => localStorage.removeItem(key));

    // Clear report caches
    const reportKeys = Object.keys(localStorage).filter((key) =>
      key.startsWith("idb_report_"),
    );
    reportKeys.forEach((key) => localStorage.removeItem(key));

    showNotice("offline-data-notice", "Offline data cleared from this device.");
  } catch (err) {
    console.error("Failed to clear offline data:", err);
    showNotice("offline-data-notice", "Failed to clear offline data. See console for details.", true);
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

// ---------- Subscription & billing ----------
if (window.location.hash === "#billing") {
  document.querySelector("#billing")?.scrollIntoView({ block: "start" });
}

async function startCheckout({ tier, cycle, button }) {
  setButtonBusy(button, true, "Opening secure checkout…");
  showNotice("billing-notice", "Redirecting to secure checkout...");
  try {
    const apiBase = window.__ENV?.VITE_API_URL || "https://logmate.co.za";
    const requestCheckout = async (accessToken) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        return await fetch(`${apiBase}/api/billing/checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ tier, billingCycle: cycle }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) {
      const refreshed = await supabase.auth.refreshSession();
      sessionData = refreshed.data;
    }
    if (!sessionData.session?.access_token) {
      throw new Error("Your session has expired. Sign in again before choosing a plan.");
    }

    let response = await requestCheckout(sessionData.session.access_token);
    if (response.status === 401) {
      const refreshed = await supabase.auth.refreshSession();
      if (!refreshed.data.session?.access_token) {
        window.location.href = "login.html";
        return;
      }
      response = await requestCheckout(refreshed.data.session.access_token);
      if (response.status === 401) {
        await supabase.auth.signOut();
        window.location.href = "login.html?reason=session-expired";
        return;
      }
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.checkoutUrl) {
      throw new Error(result.error || "Checkout could not be started.");
    }
    window.location.href = result.checkoutUrl;
  } catch (err) {
    console.error("Checkout failed:", err);
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const message = err.name === "AbortError"
      ? "The billing service took too long to respond. Try again shortly."
      : err instanceof TypeError && isLocal
        ? "The local billing API is not running. Start it with `npm install` and `npm start`, then try again."
        : err instanceof TypeError
          ? "The production billing API could not be reached. Confirm that the API is deployed at https://logmate.co.za."
          : err.message;
    showNotice("billing-notice", `Could not start checkout: ${message}`, true);
  } finally {
    setButtonBusy(button, false);
  }
}

document.querySelectorAll("[data-checkout-tier]").forEach((btn) => {
  btn.addEventListener("click", () =>
    startCheckout({ tier: btn.dataset.checkoutTier, cycle: btn.dataset.checkoutCycle, button: btn }),
  );
});
