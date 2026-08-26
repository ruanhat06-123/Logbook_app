// app.js
import { supabase } from "./supabaseClient.js";
import "./serviceReminder.js";

document.documentElement.dataset.theme =
  localStorage.getItem("theme") || "light";

const vehicles = async () =>
  (
    await supabase
      .from("vehicles")
      .select("*")
      .order("created_at", { ascending: false })
  ).data || [];

const logs = async () =>
  (
    await supabase
      .from("car_logbook")
      .select("*")
      .order("created_at", { ascending: false })
  ).data || [];

const money = (value) =>
  `ZAR ${Number(value).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;

const dateText = (value) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const vehicle = (list, id) => list.find((item) => item.id === id);

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ],
  );

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

async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "index.html";
    return null;
  }
  return data.session.user;
}

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

Object.assign(globalThis, {
  supabase,
  vehicles,
  logs,
  money,
  dateText,
  vehicle,
  shell,
  requireAuth,
});
