const CACHE_NAME = "logmate-shell-v6";
const OFFLINE_PAGE = "/html/offline.html";

const APP_SHELL = [
  "/",
  "/index.html",
  "/css/style.css",
  "/assets/logo.svg",
  "/manifest.json",
  "/html/offline.html",
  // Core app modules
  "/js/landing.js",
  "/js/core/app.js",
  "/js/core/env.js",
  "/js/core/supabaseClient.js",
  "/js/core/serviceReminder.js",
  "/js/core/gpsTracking.js",
  "/js/core/localStore.js",
  "/js/core/distanceCalculator.js",
  "/js/core/offlineSync.js",
  "/js/core/offlineIndicator.js",
  "/js/core/tripUIIntegration.js",
  "/js/core/reportCache.js",
  // Page modules
  "/js/pages/auth.js",
  "/js/pages/dashboard.js",
  "/js/pages/trip.js",
  "/js/pages/logbook.js",
  "/js/pages/vehicles.js",
  "/js/pages/addVehicle.js",
  "/js/pages/tripReport.js",
  "/js/pages/report.js",
  "/js/pages/settings.js",
  "/js/pages/help.js",
  "/js/pages/resetPassword.js",
  "/js/pages/vehicleList.js",
  // HTML pages for offline access
  "/html/login.html",
  "/html/dashboard.html",
  "/html/trip.html",
  "/html/logbook.html",
  "/html/vehicles.html",
  "/html/add-vehicle.html",
  "/html/trip-report.html",
  "/html/report.html",
  "/html/settings.html",
  "/html/help.html",
  "/html/reset-password.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn("[SW] Some assets failed to cache during install:", err);
        // Continue even if some assets fail to cache
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isApiCall = url.pathname.includes("/api/") || url.hostname.includes("openrouteservice") || url.hostname.includes("supabase");
  const isLandingPage = url.pathname === "/" || url.pathname === "/index.html";

  // Network-first strategy for API calls (ORS, Supabase, custom API)
  if (isApiCall) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const clonedResponse = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clonedResponse).catch(() => {
                // Ignore cache write failures
              });
            });
          }
          return response;
        })
        .catch(() => {
          // Fall back to cache on network error
          return caches.match(event.request).then((cached) => {
            if (cached) {
              return cached;
            }
            // Return offline error response
            return new Response(JSON.stringify({ error: "offline", message: "No internet connection" }), {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "application/json" },
            });
          });
        })
    );
    return;
  }

  // Landing page: Network-first (require internet)
  if (isLandingPage) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // Return offline page
          return caches.match(OFFLINE_PAGE);
        })
    );
    return;
  }

  // All other pages (HTML, assets): Cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((response) => {
          // Cache successful responses
          if (!response || response.status !== 200 || response.type === "error") {
            return response;
          }

          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clonedResponse).catch(() => {
              // Ignore cache write failures
            });
          });

          return response;
        })
        .catch(() => {
          // If it's an HTML page and not cached, show offline page
          if (event.request.destination === "document") {
            return caches.match(OFFLINE_PAGE);
          }
          // For other resources, try cache or return error
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            // Return a 503 error response
            return new Response("Resource not available offline", {
              status: 503,
              statusText: "Service Unavailable",
            });
          });
        });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action !== "end-trip") return;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const appWindow = windows.find((window) => "focus" in window);
    if (appWindow) {
      appWindow.focus();
      return appWindow.postMessage({ type: "end-live-trip" });
    }
    return clients.openWindow("/html/trip.html");
  }));
});
