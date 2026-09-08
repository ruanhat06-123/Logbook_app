// public/env.js
// Runtime environment for the client. Only expose public tokens here.
window.__ENV = {
  VITE_MAPBOX_TOKEN: "pk.eyJ1IjoicnVhbmhhdDA2IiwiYSI6ImNtdGZ4Y3pmYTFmZTYyeHNlZzM0a2wycjAifQ.8Sg2NivUAa2cJ8fNFPPn1Q",
  // Base URL of server/api-server.js (ORS proxy + PayFast billing). Leave
  // unset in production if the API is served from the same origin; pages
  // fall back to http://localhost:3000 when running on Five Server (:5500).
  VITE_API_URL: "",
};
