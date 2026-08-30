// api-server.js
// Minimal Express proxy for OpenRouteService directions
require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch"); // npm i node-fetch@2
const app = express();
app.use(express.json());

const ORS_KEY = process.env.ORS_API_KEY;
if (!ORS_KEY) {
  console.error("ORS_API_KEY missing in .env");
  process.exit(1);
}

app.post("/api/ors/directions", async (req, res) => {
  try {
    const { coordinates } = req.body; // expect [[lon,lat],[lon,lat]]
    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }

    const body = {
      coordinates,
      format: "json",
      units: "m",
    };

    const resp = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Authorization: ORS_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const data = await resp.json();
    return res.status(resp.status).json(data);
  } catch (err) {
    console.error("ORS proxy error", err);
    return res.status(500).json({ error: "Proxy error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`API proxy listening on http://localhost:${PORT}`),
);
