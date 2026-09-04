const CACHE_NAME = "logmate-shell-v1";
const APP_SHELL = ["/", "/index.html", "/css/style.css", "/logo.svg", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request)),
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
