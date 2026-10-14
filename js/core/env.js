// public/env.js
// Runtime environment for the client. Only expose public tokens here.
// Use the local API during development and the current site origin on the web.
const isLocalDev =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  window.Capacitor?.isNativePlatform?.() !== true;
const isNativeApp = window.Capacitor?.isNativePlatform?.() === true;
window.__ENV = {
  SUPABASE_URL: "https://kvfssjjryzwjgulqjvws.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_0yZ0XYeLvMegIWH6tebl4g_G2NxkIga",
  VITE_MAPBOX_TOKEN: "pk.eyJ1IjoicnVhbmhhdDA2IiwiYSI6ImNtdGZ4Y3pmYTFmZTYyeHNlZzM0a2wycjAifQ.8Sg2NivUAa2cJ8fNFPPn1Q",
  // Keep web API requests same-origin to avoid redirects breaking CORS preflight.
  // Native apps continue to use the production API host.
  VITE_API_URL: isLocalDev
    ? "http://localhost:3000"
    : isNativeApp
      ? "https://logmate.co.za"
      : window.location.origin,
};
