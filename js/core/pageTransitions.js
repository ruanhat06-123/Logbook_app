const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const transitionDuration = reducedMotion ? 0 : 620;
const historyKey = "logmatePageHistory";
const historyIndexKey = "logmatePageHistoryIndex";
const pendingTransitionKey = "logmatePendingPageTransition";
const legacyPageRoutes = {
  "login.html": "login",
  "dashboard.html": "dashboard",
  "vehicles.html": "vehicles",
  "add-vehicle.html": "add-vehicle",
  "trip.html": "trip",
  "logbook.html": "logbook",
  "trip-report.html": "trip-report",
  "report.html": "report",
  "settings.html": "settings",
  "checkout.html": "checkout",
  "help.html": "help",
  "reset-password.html": "reset-password",
  "analytics.html": "analytics",
  "fleet.html": "fleet",
  "drivers.html": "drivers",
};
const routeOrder = {
  landing: 0,
  offline: 0,
  "not-found": 0,
  terms: 1,
  privacy: 1,
  "refund-policy": 1,
  login: 1,
  "reset-password": 1,
  dashboard: 2,
  vehicles: 3,
  "add-vehicle": 4,
  logbook: 5,
  trip: 6,
  report: 7,
  "trip-report": 8,
  analytics: 9,
  fleet: 10,
  drivers: 11,
  help: 12,
  settings: 13,
  checkout: 14,
};

const pageForUrl = (url) => {
  const legacyPage = Object.keys(legacyPageRoutes).find((filename) =>
    url.pathname.endsWith(`/${filename}`),
  );
  if (legacyPage) return legacyPageRoutes[legacyPage];
  if (url.pathname === "/" || url.pathname.endsWith("/index.html")) return "landing";
  if (url.pathname.endsWith("/terms.html")) return "terms";
  if (url.pathname.endsWith("/privacy.html")) return "privacy";
  if (url.pathname.endsWith("/refund-policy.html")) return "refund-policy";
  if (url.pathname.endsWith("/app.html")) return url.searchParams.get("page") || "login";
  return null;
};

const readHistory = () => {
  try {
    const routes = JSON.parse(sessionStorage.getItem(historyKey) || "[]");
    const index = Number.parseInt(sessionStorage.getItem(historyIndexKey) || "-1", 10);
    return { routes: Array.isArray(routes) ? routes : [], index: Number.isInteger(index) ? index : -1 };
  } catch {
    return { routes: [], index: -1 };
  }
};

const saveHistory = (routes, index) => {
  try {
    sessionStorage.setItem(historyKey, JSON.stringify(routes));
    sessionStorage.setItem(historyIndexKey, String(index));
  } catch {
    // Navigation still works if browser storage is unavailable.
  }
};

const currentPage = pageForUrl(new URL(window.location.href));
const navigationType = performance.getEntriesByType("navigation")[0]?.type;
const historyState = readHistory();
let entryDirection = "forward";

try {
  const pending = JSON.parse(sessionStorage.getItem(pendingTransitionKey) || "null");
  if (pending?.target === currentPage) {
    entryDirection = pending.direction;
    saveHistory(pending.routes, pending.index);
    sessionStorage.removeItem(pendingTransitionKey);
  } else if (navigationType === "back_forward" && currentPage) {
    const previousIndex = historyState.routes.lastIndexOf(currentPage);
    if (previousIndex >= 0) {
      entryDirection = previousIndex < historyState.index ? "backward" : "forward";
      saveHistory(historyState.routes, previousIndex);
    }
  } else if (currentPage) {
    saveHistory([currentPage], 0);
  }
} catch {
  if (currentPage) saveHistory([currentPage], 0);
}
document.documentElement.dataset.pageDirection = entryDirection;

const loaderMarkup = `
  <div class="page-loader" data-page-loader role="status" aria-live="polite" aria-label="Loading LogMate">
    <span class="page-loader-mark" aria-hidden="true"></span>
    <span class="page-loader-label">Loading</span>
  </div>`;

let loadFinishStarted = false;
let navigationStarted = false;
const finishLoading = () => {
  if (loadFinishStarted) return;
  loadFinishStarted = true;
  const loader = document.querySelector("[data-page-loader]");
  if (loader) {
    loader.classList.add("is-complete");
    window.setTimeout(() => loader.remove(), 260);
  }
  document.documentElement.removeAttribute("aria-busy");

  const clearEntranceState = () => {
    document.body.classList.remove(
      "is-entering",
      "is-entering-forward",
      "is-entering-backward",
      "is-ready",
    );
  };
  if (reducedMotion || !document.body.classList.contains("is-entering")) {
    clearEntranceState();
    return;
  }

  const onEntranceEnd = (event) => {
    if (event.target !== document.body || event.propertyName !== "transform") return;
    document.body.removeEventListener("transitionend", onEntranceEnd);
    clearTimeout(entranceTimeout);
    clearEntranceState();
  };
  const entranceTimeout = window.setTimeout(() => {
    document.body.removeEventListener("transitionend", onEntranceEnd);
    clearEntranceState();
  }, transitionDuration + 80);
  document.body.addEventListener("transitionend", onEntranceEnd);
};

const normalizeDestination = (destination) => {
  const legacyPage = Object.keys(legacyPageRoutes).find((filename) => destination.pathname.endsWith(`/${filename}`));
  if (legacyPage) {
    const appUrl = new URL("/html/app.html", window.location.href);
    appUrl.searchParams.set("page", legacyPageRoutes[legacyPage]);
    destination.searchParams.forEach((value, key) => {
      if (key !== "page") appUrl.searchParams.set(key, value);
    });
    appUrl.hash = destination.hash;
    return appUrl;
  }
  return destination;
};

const navigateTo = (href, { replace = false } = {}) => {
  const destination = normalizeDestination(new URL(href, window.location.href));
  if (destination.origin !== window.location.origin) {
    window.location.assign(destination.href);
    return;
  }
  if (destination.pathname === window.location.pathname && destination.search === window.location.search) {
    if (destination.hash && destination.hash !== window.location.hash) window.location.hash = destination.hash;
    return;
  }
  if (navigationStarted) return;

  const sourcePage = pageForUrl(new URL(window.location.href));
  const targetPage = pageForUrl(destination);
  let direction = "forward";
  if (sourcePage && targetPage) {
    direction = (routeOrder[targetPage] ?? 0) < (routeOrder[sourcePage] ?? 0)
      ? "backward"
      : "forward";
    const state = readHistory();
    const routes = state.routes.slice(0, Math.max(state.index + 1, 0));
    if (replace && routes.length) routes[routes.length - 1] = targetPage;
    else routes.push(targetPage);
    try {
      sessionStorage.setItem(pendingTransitionKey, JSON.stringify({
        target: targetPage,
        direction,
        routes,
        index: routes.length - 1,
      }));
    } catch {
      // The page can still transition without storing direction history.
    }
  }

  navigationStarted = true;
  document.documentElement.dataset.pageDirection = direction;
  document.documentElement.setAttribute("aria-busy", "true");
  document.body.classList.add("is-leaving", `is-leaving-${direction}`);
  window.setTimeout(() => {
    if (replace) window.location.replace(destination.href);
    else window.location.assign(destination.href);
  }, transitionDuration);
};

const startNavigation = (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0) return;
  if (link.target === "_blank" || link.hasAttribute("download")) return;
  const rawDestination = new URL(link.href);
  if (rawDestination.origin !== window.location.origin) return;
  const destination = normalizeDestination(rawDestination);
  if (destination.pathname === window.location.pathname && destination.search === window.location.search) {
    event.preventDefault();
    if (destination.hash && destination.hash !== window.location.hash) window.location.hash = destination.hash;
    return;
  }
  event.preventDefault();
  navigateTo(destination.href);
};

document.documentElement.setAttribute("aria-busy", "true");
document.body.insertAdjacentHTML("afterbegin", loaderMarkup);
document.body.classList.add("is-entering", `is-entering-${entryDirection}`);
window.requestAnimationFrame(() => document.body.classList.add("is-ready"));
document.addEventListener("click", startNavigation);
if (!window.location.pathname.endsWith("/app.html")) {
  window.addEventListener("load", () => window.setTimeout(finishLoading, 120), { once: true });
}
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  const state = readHistory();
  const restoredIndex = state.routes.lastIndexOf(currentPage);
  if (restoredIndex < 0) return;
  const direction = restoredIndex < state.index ? "backward" : "forward";
  saveHistory(state.routes, restoredIndex);
  document.documentElement.dataset.pageDirection = direction;
  loadFinishStarted = false;
  document.body.classList.remove("is-leaving", "is-leaving-forward", "is-leaving-backward");
  document.body.classList.remove("is-ready", "is-entering-forward", "is-entering-backward");
  document.body.classList.add("is-entering", `is-entering-${direction}`);
  window.requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
    window.setTimeout(() => {
      document.body.classList.remove("is-entering", "is-entering-forward", "is-entering-backward", "is-ready");
    }, transitionDuration + 80);
  });
});

window.LogMateUI = { finishLoading, navigateTo };