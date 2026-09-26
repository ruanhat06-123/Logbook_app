const routes = {
  login: { title: "Log in · LogMate", module: "auth.js", template: "login-view" },
  dashboard: { title: "Dashboard · LogMate", module: "dashboard.js" },
  vehicles: { title: "Your vehicles · LogMate", module: "vehicleList.js" },
  "add-vehicle": { title: "Add vehicle · LogMate", module: "addVehicle.js" },
  trip: { title: "New trip · LogMate", module: "trip.js" },
  logbook: { title: "New fill-up · LogMate", module: "logbook.js" },
  "trip-report": { title: "Trip reports · LogMate", module: "tripReport.js" },
  report: { title: "Fuel reports · LogMate", module: "report.js" },
  settings: { title: "Settings · LogMate", module: "settings.js" },
  checkout: { title: "Checkout · LogMate", module: "checkout.js", template: "checkout-view" },
  help: { title: "Help · LogMate", module: "help.js" },
  "reset-password": { title: "Reset password · LogMate", module: "resetPassword.js", template: "reset-password-view" },
  analytics: { title: "Analytics · LogMate", module: "analytics.js" },
  fleet: { title: "Fleet management · LogMate", module: "fleet.js" },
  drivers: { title: "Drivers · LogMate", module: "drivers.js" },
  offline: { title: "Offline · LogMate", template: "offline-view" },
  "not-found": { title: "Page not found · LogMate", template: "not-found-view" },
};

const appRoot = document.querySelector("#app-root");
const params = new URLSearchParams(window.location.search);
const isLandingFallback = ["/", "/index.html"].includes(window.location.pathname);
const requestedPage = params.get("page") || (isLandingFallback ? "offline" : "login");
const page = routes[requestedPage] ? requestedPage : "not-found";
const route = routes[page];

document.title = route.title;
document.body.dataset.page = page;

if (route.template) {
  const template = document.getElementById(route.template);
  appRoot.replaceChildren(template.content.cloneNode(true));
  if (route.module) {
    import(`../pages/${route.module}`)
      .then(() => globalThis.LogMateUI?.finishLoading())
      .catch((error) => {
        if (document.body.classList.contains("is-leaving")) return;
        console.error(`Unable to load the ${page} page`, error);
        appRoot.insertAdjacentHTML(
          "beforeend",
          '<p class="app-status app-status-error" role="alert">This page could not be loaded. Reload LogMate and try again.</p>',
        );
        globalThis.LogMateUI?.finishLoading();
      });
  } else {
    globalThis.LogMateUI?.finishLoading();
  }
} else {
  import(`../pages/${route.module}`)
    .then(() => globalThis.LogMateUI?.finishLoading())
    .catch((error) => {
      if (document.body.classList.contains("is-leaving")) return;
      console.error(`Unable to load the ${page} page`, error);
      appRoot.innerHTML = '<main class="error-page"><h1>Page unavailable</h1><p class="error-page-copy">This page could not be loaded. Check your connection and try again.</p><button class="btn btn-primary" type="button" data-reload>Reload</button></main>';
      appRoot.querySelector("[data-reload]")?.addEventListener("click", () => window.location.reload());
      globalThis.LogMateUI?.finishLoading();
    });
}

document.querySelector("[data-offline-back]")?.addEventListener("click", () => window.history.back());
document.querySelector("[data-history-back]")?.addEventListener("click", () => window.history.back());
document.querySelector("[data-online-status]") && window.addEventListener("online", () => {
  globalThis.LogMateUI?.navigateTo("/html/app.html?page=dashboard", { replace: true });
}, { once: true });
