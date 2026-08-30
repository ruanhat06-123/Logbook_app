// api-server.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ORS_API_KEY = process.env.ORS_API_KEY || "";
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN || "";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve env.js so client can read runtime token when using static server
app.get("/env.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  // Only expose the public Mapbox token
  res.send(`window.__ENV = { VITE_MAPBOX_TOKEN: ${JSON.stringify(MAPBOX_TOKEN)} };`);
});

// ORS proxy endpoint (server-side secret)
app.post("/api/ors/directions", async (req, res) => {
  if (!ORS_API_KEY) return res.status(500).json({ error: "Server missing ORS_API_KEY" });
  try {
    const r = await fetch("https://api.openrouteservice.org/v2/directions/driving-car?api_key=" + encodeURIComponent(ORS_API_KEY), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    console.error("ORS proxy error:", err);
    res.status(502).json({ error: "ORS proxy failed" });
  }
});

// Serve static files (adjust folder as needed)
const staticDir = path.join(process.cwd(), "public"); // put your index.html and assets in public/
app.use(express.static(staticDir));

// Fallback to index.html for SPA routes
app.get("*", (req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log(`env.js available at http://localhost:${PORT}/env.js`);
});
