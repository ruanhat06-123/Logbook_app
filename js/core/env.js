// public/env.js
// Runtime environment for the client. Only expose public tokens here.
window.__ENV = {
  VITE_MAPBOX_TOKEN: "pk.eyJ1IjoicnVhbmhhdDA2IiwiYSI6ImNtdGZ4Y3pmYTFmZTYyeHNlZzM0a2wycjAifQ.8Sg2NivUAa2cJ8fNFPPn1Q",
  // Use the local API during development and the apex production domain only.
  VITE_API_URL: ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:3000"
    : "https://logmate.co.za",
};
