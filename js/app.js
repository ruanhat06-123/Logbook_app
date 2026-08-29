// app.js
import { supabase } from "./supabaseClient.js";
import "./serviceReminder.js";

document.documentElement.dataset.theme =
  localStorage.getItem("theme") || "light";

/**
 * Fetch vehicles and attach the latest logbook mileage (from car_logbook refuel entries)
 * Returns an array of vehicle rows where each row may include:
 *   latest_logbook_mileage: number | null
 */
const vehicles = async () => {
  const { data: vehicleRows = [], error: vErr } = await supabase
    .from("vehicles")
    .select("*")
    .order("number_plate");

  if (vErr) {
    console.error("vehicles fetch error:", vErr);
    return [];
  }

  // Build a map of latest refuel mileage per vehicle
  const vehicleIds = (vehicleRows || []).map((v) => v.id).filter(Boolean);
  if (!vehicleIds.length) return vehicleRows;

  try {
    const { data: refuels = [], error: refuelErr } = await supabase
      .from("car_logbook")
      .select("vehicle_id, current_mileage, created_at")
      .in("vehicle_id", vehicleIds)
      .eq("entry_type", "refuel")
      .order("created_at", { ascending: false });

    if (refuelErr) {
      console.error("refuels fetch error:", refuelErr);
      // return vehicles without attached mileage
      return vehicleRows.map((v) => ({ ...v, latest_logbook_mileage: null }));
    }

    const latestMap = {};
    (refuels || []).forEach((r) => {
      const key = String(r.vehicle_id);
      if (latestMap[key] === undefined && Number.isFinite(Number(r.current_mileage))) {
        latestMap[key] = Number(r.current_mileage);
      }
    });

    return (vehicleRows || []).map((v) => ({
      ...v,
      latest_logbook_mileage: latestMap[String(v.id)] ?? null,
    }));
  } catch (err) {
    console.error("Error attaching latest logbook mileage:", err);
    return vehicleRows.map((v) => ({ ...v, latest_logbook_mileage: null }));
  }
};

/**
 * Fetch raw car_logbook entries (unchanged)
 */
const logs = async () =>
  (
    await supabase
      .from("car_logbook")
      .select("*")
      .order("created_at", { ascending: false })
  ).data || [];

/**
 * Money formatter used across the app
 */
const money = (value) =>
  `ZAR ${Number(value).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;

/**
 * Date formatter used across the app
 */
const dateText = (value) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/**
 * Find a vehicle in a list by id (loose equality to handle string/number ids)
 */
const vehicle = (list = [], id) =>
  (list || []).find((item) => String(item.id) === String(id));

/**
 * Safe HTML escape helper
 */
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ],
  );

/**
 * Render the left navigation and user info
 */
function renderNav(active, user) {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;
  const metadata = user?.user_metadata || {},
    displayName =
      metadata.full_name ||
      metadata.name ||
      user?.email?.split("@")[0] ||
      "Account",
    initials =
      displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("") || "U";

  nav.innerHTML = `<div class="brand"><span class="brand-mark">↗</span> DriveLedger</div><div class="nav-label">Workspace</div><nav class="nav"><a class="${active === "home" ? "active" : ""}" href="vehicles.html"><span class="nav-icon">⌂</span>Overview</a><a class="${active === "vehicles" ? "active" : ""}" href="vehicles.html#vehicles"><span class="nav-icon">▣</span>My vehicles</a><a class="${active === "logbook" ? "active" : ""}" href="logbook.html"><span class="nav-icon">＋</span>New fill-up</a><a class="${active === "trip" ? "active" : ""}" href="trip.html"><span class="nav-icon">↗</span>New trip</a><a class="${active === "report" ? "active" : ""}" href="report.html"><span class="nav-icon">▤</span>Fuel reports</a><a class="${active === "trip-report" ? "active" : ""}" href="trip-report.html"><span class="nav-icon">◫</span>Trip reports</a></nav><div class="sidebar-footer"><div class="user-chip"><span class="avatar">${escapeHtml(initials)}</span><div><div class="user-name">${escapeHtml(displayName)}</div><div class="user-role">Personal account</div></div></div><button class="signout" data-signout>Sign out →</button></div>`;
}

/**
 * Ensure the user is authenticated; otherwise redirect to index
 */
async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "index.html";
    return null;
  }
  return data.session.user;
}

/**
 * Shell: render the app UI and wire common behaviors
 */
async function shell(active, content) {
  const user = await requireAuth();
  if (!user) return null;

  document.body.innerHTML = `<div class="app-shell"><aside class="sidebar"><div data-nav></div></aside><main class="main">${content}</main></div>`;
  renderNav(active, user);

  const themeToggle = document.createElement("button");
  themeToggle.className = "theme-toggle";
  themeToggle.type = "button";
  themeToggle.textContent =
    document.documentElement.dataset.theme === "dark"
      ? "☼ Light mode"
      : "☾ Dark mode";
  themeToggle.setAttribute("aria-label", "Toggle color theme");
  themeToggle.addEventListener("click", () => {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
    themeToggle.textContent = theme === "dark" ? "☼ Light mode" : "☾ Dark mode";
  });

  document.querySelector(".sidebar-footer")?.prepend(themeToggle);

  document
    .querySelector("[data-signout]")
    ?.addEventListener("click", async () => {
      await supabase.auth.signOut();
      window.location.href = "index.html";
    });

  // reload when a service is confirmed elsewhere in the app
  document.addEventListener("vehicle:serviceConfirmed", () => {
    window.location.reload();
  });

  return user;
}

/**
 * Expose utilities globally for other modules (keeps compatibility with existing code)
 */
Object.assign(globalThis, {
  supabase,
  vehicles,
  logs,
  money,
  dateText,
  vehicle,
  shell,
  requireAuth,
  escapeHtml,
});
