// public/env.js
// Runtime environment for the client. Only expose public tokens here.
// Use the local API during development and the apex production domain only.
const isLocalDev =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  window.Capacitor?.isNativePlatform?.() !== true;
window.__ENV = {
  SUPABASE_URL: "https://kvfssjjryzwjgulqjvws.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_0yZ0XYeLvMegIWH6tebl4g_G2NxkIga",
  VITE_MAPBOX_TOKEN: "pk.eyJ1IjoicnVhbmhhdDA2IiwiYSI6ImNtdGZ4Y3pmYTFmZTYyeHNlZzM0a2wycjAifQ.8Sg2NivUAa2cJ8fNFPPn1Q",
  // Use the local API during development and the apex production domain only.
  VITE_API_URL: isLocalDev
    ? "http://localhost:3000"
    : "https://logmate.co.za",
};
