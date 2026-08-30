// trips.js
// Full updated trip UI with Mapbox + ORS proxy integration and improved light/dark map UI.
// Assumptions:
// - Server-side ORS proxy available at /api/ors/directions (server reads ORS_API_KEY).
// - Runtime env script may expose window.__ENV.VITE_MAPBOX_TOKEN for static servers.
// - When using Vite, import.meta.env.VITE_MAPBOX_TOKEN will be available in dev/build.
// - This file expects `shell`, `supabase`, `requireAuth`, `requestServiceNotifications`, `notifyServiceDue`, and `serviceReminderMarkup` to exist.

import "./app.js";
import {
  notifyServiceDue,
  requestServiceNotifications,
  serviceReminderMarkup,
} from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

if (user) {
  // ---------- Logging helpers ----------
  const log = (...args) => console.log("[trip]", ...args);
  const warn = (...args) => console.warn("[trip]", ...args);
  const error = (...args) => console.error("[trip]", ...args);

  // ---------- Env / tokens ----------
  const MAPBOX_TOKEN =
    (typeof window !== "undefined" &&
      window.__ENV &&
      window.__ENV.VITE_MAPBOX_TOKEN) ||
    (typeof import.meta !== "undefined" &&
      import.meta.env &&
      import.meta.env.VITE_MAPBOX_TOKEN) ||
    "";

  if (!MAPBOX_TOKEN)
    warn(
      "Mapbox token missing. Provide via /env.js (window.__ENV.VITE_MAPBOX_TOKEN) or VITE_MAPBOX_TOKEN.",
    );

  // Mapbox style URLs (constructed at runtime)
  const LIGHT_STYLE = () =>
    `https://api.mapbox.com/styles/v1/mapbox/streets-v11?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
  const DARK_STYLE = () =>
    `https://api.mapbox.com/styles/v1/mapbox/dark-v10?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

  // ---------- Small utilities ----------
  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[c],
    );
  }

  // ---------- Fetch vehicles and render UI ----------
  let vehicleList = [];
  try {
    const { data: vehiclesData, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("number_plate");
    if (error) {
      warn("Failed to fetch vehicles", error);
      vehicleList = [];
    } else {
      vehicleList = vehiclesData || [];
    }
  } catch (err) {
    error("Unexpected vehicles fetch error", err);
    vehicleList = [];
  }

  // Render full UI (includes map modal)
  await shell(
    "trip",
    `
    <header class="topbar">
      <div>
        <div class="eyebrow">Logbook / new trip</div>
        <h1>Record a trip.</h1>
      </div>
      <div class="top-date"><strong>TRIP ENTRY</strong> Odometer-led</div>
    </header>

    ${vehicleList.map(serviceReminderMarkup).join("")}

    <div class="card" style="max-width:760px">
      <div class="notice">Trip distance is calculated from the start and end odometer readings or from the selected start/end locations. Pick a suggestion, choose a previous destination, or open the map to choose a precise point.</div>

      <form id="trip-form" class="form-grid">
        <div class="field full">
          <label for="vehicle">Vehicle</label>
          <select id="vehicle" required>
            <option value="">Select a vehicle</option>
            ${vehicleList
              .map((item) => {
                const current = Number.isFinite(Number(item.current_mileage))
                  ? Number(item.current_mileage)
                  : "";
                return `<option value="${item.id}" data-current-mileage="${current}">${escapeHtml(item.number_plate || "")} · ${escapeHtml(item.make || "Not specified")} ${escapeHtml(item.model || "")}</option>`;
              })
              .join("")}
          </select>
        </div>

        <div class="field">
          <label for="trip-type">Trip type</label>
          <select id="trip-type" required>
            <option value="personal">Personal</option>
            <option value="business">Business</option>
          </select>
        </div>

        <div class="field">
          <label for="date">Date</label>
          <input id="date" type="date" required>
        </div>

        <div class="field">
          <label for="start-odo">Start odometer (km)</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="start-odo" type="number" min="0" step="1" required placeholder="Auto-populated from vehicle" style="flex:1">
            <button id="use-last-end-btn" type="button" class="btn btn-secondary" title="Use end location from last trip as origin">Use last trip end</button>
          </div>
        </div>

        <div class="field">
          <label for="end-odo">End odometer (km)</label>
          <input id="end-odo" type="number" min="0" step="1" required>
        </div>

        <div class="field">
          <label for="origin">Origin</label>
          <div style="position:relative">
            <input id="origin" type="text" maxlength="200" placeholder="Start location (select from suggestions or open map)" autocomplete="off" required>
            <div id="origin-suggestions" class="suggestions" style="position:absolute;left:0;right:0;z-index:40;background:#fff;border:1px solid #ddd;display:none;max-height:260px;overflow:auto;"></div>
            <div style="margin-top:6px;display:flex;gap:8px;align-items:center">
              <button id="open-origin-map" type="button" class="btn btn-secondary" style="padding:6px 10px">Open map</button>
              <div id="origin-map-preview" style="width:120px;height:80px;border:1px solid #eee;display:none"></div>
            </div>
          </div>
        </div>

        <div class="field">
          <label for="destination">Destination</label>
          <div style="position:relative">
            <input id="destination" type="text" maxlength="200" placeholder="End location (select from suggestions or Detect / open map)" autocomplete="off" required>
            <div id="destination-suggestions" class="suggestions" style="position:absolute;left:0;right:0;z-index:40;background:#fff;border:1px solid #ddd;display:none;max-height:260px;overflow:auto;"></div>
            <div style="margin-top:6px;display:flex;gap:8px;align-items:center">
              <button id="detect-destination" type="button" class="btn btn-secondary" style="padding:6px 10px">Detect</button>
              <button id="open-destination-map" type="button" class="btn btn-secondary" style="padding:6px 10px">Open map</button>
              <div id="destination-map-preview" style="width:120px;height:80px;border:1px solid #eee;display:none"></div>
            </div>
          </div>
        </div>

        <div id="location-status" class="notice" hidden></div>

        <div class="field">
          <label for="purpose">Purpose</label>
          <select id="purpose" required>
            <option value="">Select purpose</option>
            <option value="commute">Commute</option>
            <option value="errand">Errand</option>
            <option value="delivery">Delivery</option>
            <option value="client_meeting">Client meeting</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div class="field" id="purpose-other-field" style="display:none;">
          <label for="purpose-other">Please describe the purpose</label>
          <input id="purpose-other" type="text" maxlength="200" placeholder="Describe the purpose" />
        </div>

        <div class="form-actions field full">
          <a href="vehicles.html" class="btn btn-secondary">Cancel</a>
          <button class="btn btn-primary" type="submit">Save trip →</button>
        </div>
      </form>

      <div id="success" class="notice" hidden></div>
    </div>

    <!-- Map modal -->
    <div id="map-modal-backdrop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2000;align-items:center;justify-content:center;padding:20px">
      <div id="map-modal" role="dialog" aria-modal="true" style="width:92%;max-width:1100px;height:82%;background:var(--card-bg,#fff);color:var(--text-color,#111);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 30px rgba(0,0,0,0.25);border:1px solid rgba(0,0,0,0.06)">
        <div class="modal-header" style="display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(0,0,0,0.06);background:linear-gradient(180deg, rgba(255,255,255,0.02), transparent)">
          <div class="modal-title" style="font-weight:700">Select location on map</div>
          <input id="map-search" placeholder="Search places on map (e.g. Joburg Zoo or 123 Main St)" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:6px" />
          <button id="map-search-btn" class="btn btn-secondary" style="padding:6px 10px">Search</button>
          <div style="display:flex;gap:8px;align-items:center">
            <button id="map-theme-toggle" class="btn btn-secondary" type="button" title="Toggle map theme" style="padding:6px 10px;border-radius:8px">☀️ Light</button>
            <button id="map-modal-center" class="btn btn-secondary" style="margin-left:8px">Center here</button>
            <button id="map-modal-close" class="btn btn-primary" style="margin-left:8px">Done</button>
          </div>
        </div>
        <div style="display:flex;flex:1;min-height:0">
          <div id="map-container" style="flex:1;min-height:0;background:var(--map-bg,#e9eef5)"></div>
          <div id="map-search-results" style="width:320px;border-left:1px solid rgba(0,0,0,0.06);overflow:auto;background:var(--panel-bg,#fafafa);padding:10px;display:flex;flex-direction:column">
            <div style="font-weight:600;margin-bottom:8px">Search results</div>
            <div id="map-results-list" style="flex:1;overflow:auto"></div>
          </div>
        </div>
        <div style="padding:8px;border-top:1px solid rgba(0,0,0,0.06);display:flex;gap:8px;align-items:center">
          <div id="map-selected-label" style="flex:1;color:var(--muted,#6b7280)">No point selected</div>
          <button id="map-select-confirm" class="btn btn-primary">Use this point</button>
        </div>
      </div>
    </div>
  `,
  );

  // ---------- DOM refs ----------
  const vehicleSelect = document.querySelector("#vehicle");
  const startOdoInput = document.querySelector("#start-odo");
  const useLastEndBtn = document.querySelector("#use-last-end-btn");
  const endOdoInput = document.querySelector("#end-odo");
  const dateInput = document.querySelector("#date");
  const originInput = document.querySelector("#origin");
  const destinationInput = document.querySelector("#destination");
  const originSuggestions = document.querySelector("#origin-suggestions");
  const destinationSuggestions = document.querySelector(
    "#destination-suggestions",
  );
  const purposeSelect = document.querySelector("#purpose");
  const purposeOtherField = document.querySelector("#purpose-other-field");
  const purposeOtherInput = document.querySelector("#purpose-other");
  const successEl = document.querySelector("#success");
  const detectDestBtn = document.querySelector("#detect-destination");
  const locationStatus = document.querySelector("#location-status");
  const openOriginMapBtn = document.querySelector("#open-origin-map");
  const openDestMapBtn = document.querySelector("#open-destination-map");
  const originMapPreview = document.querySelector("#origin-map-preview");
  const destMapPreview = document.querySelector("#destination-map-preview");

  // Map modal refs
  const mapModalBackdrop = document.querySelector("#map-modal-backdrop");
  const mapContainer = document.querySelector("#map-container");
  const mapModalClose = document.querySelector("#map-modal-close");
  const mapSelectConfirm = document.querySelector("#map-select-confirm");
  const mapSelectedLabel = document.querySelector("#map-selected-label");
  const mapModalCenterBtn = document.querySelector("#map-modal-center");
  const mapSearchInput = document.querySelector("#map-search");
  const mapSearchBtn = document.querySelector("#map-search-btn");
  const mapResultsList = document.querySelector("#map-results-list");
  const mapThemeToggleBtn = document.querySelector("#map-theme-toggle");

  dateInput.value = new Date().toISOString().slice(0, 10);

  // ---------- State ----------
  let originCoords = null; // [lon, lat]
  let destCoords = null; // [lon, lat]
  let destWasDetectedByGeolocation = false;

  // ---------- Odometer population ----------
  async function populateStartOdometer(vehicleId) {
    startOdoInput.value = "";
    if (!vehicleId) return;
    const selectedOption = vehicleSelect.querySelector(
      `option[value="${vehicleId}"]`,
    );
    if (selectedOption && selectedOption.dataset.currentMileage) {
      startOdoInput.value = Number(selectedOption.dataset.currentMileage);
      return;
    }
    try {
      const { data: lastLog, error: lastLogErr } = await supabase
        .from("car_logbook")
        .select("current_mileage, created_at")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (
        !lastLogErr &&
        lastLog &&
        Number.isFinite(Number(lastLog.current_mileage))
      ) {
        startOdoInput.value = Number(lastLog.current_mileage);
        return;
      }
      const { data: vehicleRow, error: vehicleErr } = await supabase
        .from("vehicles")
        .select("current_mileage")
        .eq("id", vehicleId)
        .single();
      if (
        !vehicleErr &&
        vehicleRow &&
        Number.isFinite(Number(vehicleRow.current_mileage))
      ) {
        startOdoInput.value = Number(vehicleRow.current_mileage);
      }
    } catch (err) {
      error("populateStartOdometer error", err);
    }
  }

  vehicleSelect.addEventListener("change", async () => {
    await populateStartOdometer(vehicleSelect.value);
  });
  if (vehicleSelect.value)
    setTimeout(() => populateStartOdometer(vehicleSelect.value), 0);

  // ---------- Purpose other ----------
  function updatePurposeOtherVisibility() {
    const isOther = purposeSelect.value === "other";
    purposeOtherField.style.display = isOther ? "block" : "none";
    purposeOtherInput.required = isOther;
    if (!isOther) purposeOtherInput.value = "";
  }
  purposeSelect.addEventListener("change", updatePurposeOtherVisibility);
  setTimeout(updatePurposeOtherVisibility, 0);

  // ---------- Mapbox geocoding helpers ----------
  async function searchPlacesMapbox(query, limit = 8) {
    if (!MAPBOX_TOKEN) return [];
    try {
      const types = "address,poi,place,neighborhood";
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&autocomplete=true&limit=${limit}&types=${types}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        warn("Mapbox geocoding failed", resp.status);
        return [];
      }
      const data = await resp.json();
      return (data.features || [])
        .map((f) => ({
          label: f.text || f.place_name || "",
          secondary: f.place_name
            ? f.place_name.replace(f.text || "", "").replace(/^,\s*/, "")
            : "",
          coords: f.center ? [Number(f.center[0]), Number(f.center[1])] : null,
          raw: f,
        }))
        .filter((i) => i.coords && i.label);
    } catch (err) {
      error("searchPlacesMapbox error", err);
      return [];
    }
  }

  function renderSuggestions(
    container,
    items,
    inputEl,
    setCoordsCallback,
    previewEl,
  ) {
    container.innerHTML = "";
    if (!items || items.length === 0) {
      container.style.display = "none";
      return;
    }
    items.forEach((it) => {
      const div = document.createElement("div");
      div.className = "suggestion-item";
      div.style.padding = "8px 10px";
      div.style.cursor = "pointer";
      div.style.borderBottom = "1px solid #f6f6f6";
      div.style.display = "flex";
      div.style.flexDirection = "column";

      const primary = document.createElement("div");
      primary.textContent = it.label;
      primary.style.fontWeight = "600";
      primary.style.fontSize = "13px";
      primary.style.color = "#111";

      const secondary = document.createElement("div");
      secondary.textContent = it.secondary || "";
      secondary.style.fontSize = "12px";
      secondary.style.color = "#666";
      secondary.style.marginTop = "4px";

      div.appendChild(primary);
      if (it.secondary) div.appendChild(secondary);

      div.addEventListener("click", () => {
        inputEl.value = `${it.label}${it.secondary ? ", " + it.secondary : ""}`;
        setCoordsCallback(it.coords);
        container.style.display = "none";
        if (previewEl) showSmallMapPreview(previewEl, it.coords);
        tryAutoCalculateIfReady();
      });

      container.appendChild(div);
    });
    container.style.display = "block";
    container.style.zIndex = 9999;
  }

  const originSearch = debounce(async (q) => {
    originCoords = null;
    if (!q || q.trim().length < 1) {
      originSuggestions.style.display = "none";
      return;
    }
    const items = await searchPlacesMapbox(q, 8);
    renderSuggestions(
      originSuggestions,
      items,
      originInput,
      (coords) => {
        originCoords = coords;
      },
      originMapPreview,
    );
  }, 250);

  const destSearch = debounce(async (q) => {
    destCoords = null;
    destWasDetectedByGeolocation = false;
    if (!q || q.trim().length < 1) {
      destinationSuggestions.style.display = "none";
      return;
    }
    const items = await searchPlacesMapbox(q, 8);
    renderSuggestions(
      destinationSuggestions,
      items,
      destinationInput,
      (coords) => {
        destCoords = coords;
      },
      destMapPreview,
    );
  }, 250);

  originInput.addEventListener("input", (e) => originSearch(e.target.value));
  destinationInput.addEventListener("input", (e) => destSearch(e.target.value));
  originInput.addEventListener("blur", () => {
    setTimeout(() => tryAutoCalculateIfReady(), 250);
  });
  destinationInput.addEventListener("blur", () => {
    setTimeout(() => tryAutoCalculateIfReady(), 250);
  });
  destinationInput.addEventListener(
    "keyup",
    debounce(() => tryAutoCalculateIfReady(), 800),
  );

  document.addEventListener("click", (e) => {
    if (!originSuggestions.contains(e.target) && e.target !== originInput)
      originSuggestions.style.display = "none";
    if (
      !destinationSuggestions.contains(e.target) &&
      e.target !== destinationInput
    )
      destinationSuggestions.style.display = "none";
  });

  // ---------- Reverse geocode ----------
  async function reverseGeocodeMapbox(lat, lon) {
    if (!MAPBOX_TOKEN) return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(lon)},${encodeURIComponent(lat)}.json?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Reverse geocode failed");
      const data = await resp.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        return (
          data.features[0].place_name || `${lat.toFixed(6)},${lon.toFixed(6)}`
        );
      }
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    } catch (err) {
      warn("Reverse geocode error:", err);
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    }
  }

  function showLocationStatus(message, isError = false) {
    if (!locationStatus) return;
    locationStatus.hidden = false;
    locationStatus.textContent = message;
    locationStatus.style.color = isError ? "#a00" : "#333";
    setTimeout(() => {
      if (locationStatus) locationStatus.hidden = true;
    }, 6000);
  }

  // ---------- Geolocation detect ----------
  async function detectDestination() {
    if (!navigator.geolocation) {
      showLocationStatus("Geolocation not supported by this browser", true);
      return;
    }
    detectDestBtn.disabled = true;
    showLocationStatus("Detecting destination…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const address = await reverseGeocodeMapbox(lat, lon);
          destinationInput.value = address;
          destCoords = [Number(lon), Number(lat)];
          destWasDetectedByGeolocation = true;
          showSmallMapPreview(destMapPreview, destCoords);
          showLocationStatus("Destination detected");
          tryAutoCalculateIfReady();
        } catch (err) {
          error("Destination detection error", err);
          destinationInput.value = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
          destCoords = [
            Number(pos.coords.longitude),
            Number(pos.coords.latitude),
          ];
          destWasDetectedByGeolocation = true;
          showLocationStatus("Destination detected (coordinates only)");
          showSmallMapPreview(destMapPreview, destCoords);
          tryAutoCalculateIfReady();
        } finally {
          detectDestBtn.disabled = false;
        }
      },
      (err) => {
        detectDestBtn.disabled = false;
        warn("Geolocation error", err);
        if (err.code === 1)
          showLocationStatus("Location permission denied", true);
        else if (err.code === 2)
          showLocationStatus("Position unavailable", true);
        else if (err.code === 3)
          showLocationStatus("Location request timed out", true);
        else showLocationStatus("Failed to detect destination", true);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60 * 1000,
      },
    );
  }
  detectDestBtn?.addEventListener("click", detectDestination);

  // ---------- ORS directions via server proxy ----------
  async function calculateDrivingDistanceKm(originCoordsArr, destCoordsArr) {
    try {
      if (!originCoordsArr || !destCoordsArr)
        throw new Error("Missing coordinates");
      const resp = await fetch("/api/ors/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [originCoordsArr, destCoordsArr] }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        error("ORS proxy returned non-ok", resp.status, text);
        throw new Error("Directions request failed: " + resp.status);
      }
      const data = await resp.json();
      const meters = data?.routes?.[0]?.summary?.distance;
      if (typeof meters === "number") return meters / 1000;
      throw new Error("No route found");
    } catch (err) {
      error("calculateDrivingDistanceKm error", err);
      throw err;
    }
  }

  // ---------- Geocode single address ----------
  async function geocodeSingle(address) {
    if (!address) return null;
    const coordMatch = address
      .trim()
      .match(/^(-?\d+(\.\d+)?)[,\\s]+(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
      const a = Number(coordMatch[1]);
      const b = Number(coordMatch[3]);
      if (a >= -90 && a <= 90 && b >= -180 && b <= 180) return [b, a];
      return [a, b];
    }
    const results = await searchPlacesMapbox(address, 6);
    if (results && results.length > 0) return results[0].coords;
    return null;
  }

  // ---------- Auto-calc ----------
  async function tryAutoCalculateIfReady() {
    const originText = originInput.value.trim();
    const destinationText = destinationInput.value.trim();

    if (!destinationText) return;

    const shouldAutoBecauseDestDetected =
      destWasDetectedByGeolocation && originText.length > 0;
    const shouldAutoBecauseBothSelected = originCoords && destCoords;
    const shouldAutoBecauseBothTyped =
      originText.length > 0 &&
      destinationText.length > 0 &&
      (!originCoords || !destCoords);

    if (
      !shouldAutoBecauseDestDetected &&
      !shouldAutoBecauseBothSelected &&
      !shouldAutoBecauseBothTyped
    )
      return;

    const startOdo = Number(startOdoInput.value);
    if (!Number.isFinite(startOdo)) return;

    let oCoords = originCoords;
    let dCoords = destCoords;

    try {
      if (!oCoords && originText.length > 0) {
        oCoords = await geocodeSingle(originText);
        if (!oCoords) {
          warn("Auto-calc aborted: cannot geocode origin");
          return;
        }
      }

      if (!dCoords && destinationText.length > 0) {
        dCoords = await geocodeSingle(destinationText);
        if (!dCoords) {
          warn("Auto-calc aborted: cannot geocode destination");
          return;
        }
      }

      oCoords = [Number(oCoords[0]), Number(oCoords[1])];
      dCoords = [Number(dCoords[0]), Number(dCoords[1])];

      showLocationStatus("Calculating distance…");
      const distanceKm = await calculateDrivingDistanceKm(oCoords, dCoords);

      const newEndOdo = startOdo + distanceKm;
      endOdoInput.value = Math.round(newEndOdo);

      successEl.hidden = false;
      successEl.textContent = `Distance: ${distanceKm.toFixed(1)} km`;
      setTimeout(() => {
        successEl.hidden = true;
      }, 6000);

      originCoords = oCoords;
      destCoords = dCoords;
      destWasDetectedByGeolocation = false;
    } catch (err) {
      warn("Auto-calc failed:", err);
      showLocationStatus("Automatic distance calculation failed", true);
    } finally {
      setTimeout(() => {
        showLocationStatus("Distance calculation complete");
      }, 800);
    }
  }

  // ---------- Mapbox GL loader and modal with theme toggle ----------
  let mapboxLoaded = false;
  let mapboxLoading = false;
  let modalMap = null;
  let modalMarker = null;
  let modalCurrentCoords = null;

  async function ensureMapboxGL() {
    log("ensureMapboxGL start", { mapboxLoaded, mapboxLoading });
    if (!MAPBOX_TOKEN) throw new Error("Mapbox token missing");
    if (mapboxLoaded) return;
    if (mapboxLoading) {
      return new Promise((resolve) => {
        const check = () => {
          if (mapboxLoaded) resolve();
          else setTimeout(check, 100);
        };
        check();
      });
    }
    mapboxLoading = true;

    const cssHref = "https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css";
    if (!document.querySelector(`link[href="${cssHref}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssHref;
      document.head.appendChild(link);
    }

    const scriptSrc =
      "https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js";
    if (!document.querySelector(`script[src="${scriptSrc}"]`)) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = scriptSrc;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load Mapbox GL"));
        document.head.appendChild(s);
      });
    }

    mapboxLoaded = true;
    mapboxLoading = false;
    log("Mapbox GL loaded");
  }

  async function showSmallMapPreview(containerEl, coords) {
    if (!containerEl) return;
    containerEl.style.display = "block";
    containerEl.innerHTML = "";
    try {
      await ensureMapboxGL();
      mapboxgl.accessToken = MAPBOX_TOKEN;
      const map = new mapboxgl.Map({
        container: containerEl,
        style: LIGHT_STYLE(),
        center: [coords[0], coords[1]],
        zoom: 14,
        interactive: false,
      });
      new mapboxgl.Marker().setLngLat([coords[0], coords[1]]).addTo(map);
      setTimeout(() => {
        map.resize();
      }, 50);
    } catch (err) {
      warn("Small map preview failed:", err);
      containerEl.style.display = "none";
    }
  }

  // Theme helpers
  function getPreferredTheme() {
    const stored = localStorage.getItem("mapTheme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  function setPreferredTheme(theme) {
    localStorage.setItem("mapTheme", theme);
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    // update toggle label if present
    if (mapThemeToggleBtn) {
      mapThemeToggleBtn.textContent = theme === "dark" ? "🌙 Dark" : "☀️ Light";
    }
  }
  function applyMapStyleToMap(mapInstance, theme) {
    if (!mapInstance) return;
    const styleUrl = theme === "dark" ? DARK_STYLE() : LIGHT_STYLE();
    try {
      mapInstance.setStyle(styleUrl);
      mapInstance.once("styledata", () => {
        setTimeout(() => mapInstance.resize(), 80);
      });
    } catch (err) {
      warn("applyMapStyleToMap error", err);
    }
  }

  async function openMapModal(initialCoords = null, onConfirm) {
    try {
      // show modal first so container has layout
      mapModalBackdrop.style.display = "flex";

      await ensureMapboxGL();
      mapboxgl.accessToken = MAPBOX_TOKEN;

      // ensure theme toggle label initial state
      const initialTheme = getPreferredTheme();
      setPreferredTheme(initialTheme);

      if (!modalMap) {
        modalMap = new mapboxgl.Map({
          container: mapContainer,
          style: initialTheme === "dark" ? DARK_STYLE() : LIGHT_STYLE(),
          center: initialCoords
            ? [initialCoords[0], initialCoords[1]]
            : [28.0473, -26.2041],
          zoom: initialCoords ? 14 : 12,
        });

        modalMap.on("click", (e) => {
          const lng = e.lngLat.lng;
          const lat = e.lngLat.lat;
          setModalMarker([lng, lat]);
        });
      } else {
        // switch style to match theme
        applyMapStyleToMap(modalMap, getPreferredTheme());
        modalMap.resize();
        if (initialCoords)
          modalMap.setCenter([initialCoords[0], initialCoords[1]]);
      }

      if (initialCoords) setModalMarker(initialCoords);
      mapSelectedLabel.textContent = modalCurrentCoords
        ? `Selected: ${modalCurrentCoords[1].toFixed(6)}, ${modalCurrentCoords[0].toFixed(6)}`
        : "No point selected";

      // wire search button
      mapSearchBtn.onclick = async () => {
        const q = mapSearchInput.value.trim();
        if (!q) return;
        mapResultsList.innerHTML = `<div style="padding:8px;color:#666">Searching…</div>`;
        try {
          const results = await searchPlacesMapbox(q, 12);
          renderMapSearchResults(results);
          if (results && results.length > 0) {
            const first = results[0];
            modalMap.setCenter([first.coords[0], first.coords[1]]);
            modalMap.setZoom(14);
          }
        } catch (err) {
          mapResultsList.innerHTML = `<div style="padding:8px;color:#a00">Search failed</div>`;
        }
      };

      mapSearchInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          mapSearchBtn.click();
        }
      };

      mapSelectConfirm.onclick = async () => {
        if (!modalCurrentCoords) return;
        const label = await reverseGeocodeMapbox(
          modalCurrentCoords[1],
          modalCurrentCoords[0],
        );
        onConfirm && onConfirm({ coords: modalCurrentCoords, label });
        closeMapModal();
      };

      mapModalClose.onclick = closeMapModal;
      mapModalCenterBtn.onclick = () => {
        if (modalCurrentCoords)
          modalMap.setCenter([modalCurrentCoords[0], modalCurrentCoords[1]]);
      };

      function setModalMarker(coords) {
        modalCurrentCoords = coords;
        if (modalMarker) modalMarker.setLngLat([coords[0], coords[1]]);
        else
          modalMarker = new mapboxgl.Marker({ draggable: true })
            .setLngLat([coords[0], coords[1]])
            .addTo(modalMap)
            .on("dragend", (ev) => {
              const p = ev.target.getLngLat();
              modalCurrentCoords = [p.lng, p.lat];
              mapSelectedLabel.textContent = `Selected: ${modalCurrentCoords[1].toFixed(6)}, ${modalCurrentCoords[0].toFixed(6)}`;
            });
        mapSelectedLabel.textContent = `Selected: ${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}`;
        modalMap.setCenter([coords[0], coords[1]]);
        modalMap.setZoom(15);
      }

      function renderMapSearchResults(results) {
        mapResultsList.innerHTML = "";
        if (!results || results.length === 0) {
          mapResultsList.innerHTML = `<div style="padding:8px;color:#666">No results</div>`;
          return;
        }
        results.forEach((r) => {
          const row = document.createElement("div");
          row.style.padding = "8px";
          row.style.borderBottom = "1px solid #eee";
          row.style.cursor = "pointer";
          const title = document.createElement("div");
          title.textContent = r.label;
          title.style.fontWeight = "600";
          const sub = document.createElement("div");
          sub.textContent = r.secondary || "";
          sub.style.fontSize = "12px";
          sub.style.color = "#666";
          row.appendChild(title);
          if (r.secondary) row.appendChild(sub);
          row.addEventListener("click", () => {
            setModalMarker(r.coords);
          });
          mapResultsList.appendChild(row);
        });
      }

      function closeMapModal() {
        mapModalBackdrop.style.display = "none";
      }

      // ensure theme toggle wiring
      if (mapThemeToggleBtn) {
        mapThemeToggleBtn.textContent =
          getPreferredTheme() === "dark" ? "🌙 Dark" : "☀️ Light";
        mapThemeToggleBtn.onclick = () => {
          const next = getPreferredTheme() === "dark" ? "light" : "dark";
          setPreferredTheme(next);
          applyMapStyleToMap(modalMap, next);
        };
      }

      // react to system theme changes if user hasn't chosen explicitly
      if (window.matchMedia) {
        window
          .matchMedia("(prefers-color-scheme: dark)")
          .addEventListener("change", (e) => {
            const stored = localStorage.getItem("mapTheme");
            if (stored) return;
            const sys = e.matches ? "dark" : "light";
            setPreferredTheme(sys);
            applyMapStyleToMap(modalMap, sys);
          });
      }
    } catch (err) {
      mapModalBackdrop.style.display = "none";
      error("openMapModal error", err);
      showLocationStatus("Map failed to open. See console for details.", true);
      throw err;
    }
  }

  // Attach open map handlers
  function attachMapOpenHandlers() {
    log("attachMapOpenHandlers", {
      openOrigin: !!openOriginMapBtn,
      openDest: !!openDestMapBtn,
    });
    if (openOriginMapBtn)
      openOriginMapBtn.addEventListener("click", async () => {
        log("open-origin clicked");
        try {
          await openMapModal(originCoords || null, ({ coords, label }) => {
            originCoords = coords;
            originInput.value = label || originInput.value;
            showSmallMapPreview(originMapPreview, coords);
            tryAutoCalculateIfReady();
          });
        } catch (err) {
          error("open-origin error", err);
        }
      });

    if (openDestMapBtn)
      openDestMapBtn.addEventListener("click", async () => {
        log("open-destination clicked");
        try {
          await openMapModal(destCoords || null, ({ coords, label }) => {
            destCoords = coords;
            destinationInput.value = label || destinationInput.value;
            showSmallMapPreview(destMapPreview, coords);
            destWasDetectedByGeolocation = true;
            tryAutoCalculateIfReady();
          });
        } catch (err) {
          error("open-destination error", err);
        }
      });
  }
  setTimeout(attachMapOpenHandlers, 50);

  // ---------- Use last trip end as origin ----------
  async function fetchLastTripForVehicle(vehicleId) {
    if (!vehicleId) return null;
    try {
      const { data: lastTrip, error } = await supabase
        .from("trips")
        .select("id, trip_destination, mileage_end, created_at")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (error) {
        warn("fetchLastTripForVehicle error", error);
        return null;
      }
      return lastTrip || null;
    } catch (err) {
      error("fetchLastTripForVehicle unexpected error", err);
      return null;
    }
  }

  useLastEndBtn?.addEventListener("click", async () => {
    const vehicleId = vehicleSelect.value;
    if (!vehicleId) return window.alert("Please select a vehicle first.");
    showLocationStatus("Loading last trip destination…");
    try {
      const lastTrip = await fetchLastTripForVehicle(vehicleId);
      if (!lastTrip) {
        showLocationStatus("No previous trips found for this vehicle", true);
        return;
      }
      if (lastTrip.trip_destination) {
        originInput.value = lastTrip.trip_destination;
        const coords = await geocodeSingle(lastTrip.trip_destination);
        if (coords) {
          originCoords = coords;
          showSmallMapPreview(originMapPreview, originCoords);
        } else {
          originCoords = null;
          if (originMapPreview) originMapPreview.style.display = "none";
        }
        showLocationStatus("Origin set from last trip destination");
        tryAutoCalculateIfReady();
      } else {
        showLocationStatus("Last trip has no recorded destination", true);
      }
    } catch (err) {
      error("useLastEndBtn click error:", err);
      showLocationStatus("Failed to load last trip destination", true);
    }
  });

  // ---------- Submit handler ----------
  document
    .querySelector("#trip-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();

      const vehicleId = vehicleSelect.value;
      const tripType = document.querySelector("#trip-type").value;
      const date = dateInput.value;
      const startOdo = Number(startOdoInput.value);
      const endOdo = Number(endOdoInput.value);
      const origin = originInput.value.trim();
      const destination = destinationInput.value.trim();
      const purpose = purposeSelect.value;
      const purposeOther = purposeOtherInput.value.trim();

      if (!vehicleId) return window.alert("Please select a vehicle.");
      if (!origin) return window.alert("Please enter an origin.");
      if (!destination) return window.alert("Please enter a destination.");
      if (!purpose) return window.alert("Please select a purpose.");
      if (purpose === "other" && !purposeOther)
        return window.alert(
          "Please describe the purpose when 'Other' is selected.",
        );
      if (!Number.isFinite(startOdo))
        return window.alert("Please enter a valid start odometer.");
      if (!Number.isFinite(endOdo))
        return window.alert("Please enter a valid end odometer.");
      if (endOdo < startOdo)
        return window.alert(
          "End odometer must be greater than or equal to start odometer.",
        );

      const tripDistance = endOdo - startOdo;
      const tripPurposeToStore = purpose === "other" ? purposeOther : purpose;

      try {
        const { data: tripData, error: insertErr } = await supabase
          .from("trips")
          .insert({
            vehicle_id: vehicleId,
            trip_type: tripType,
            mileage_start: startOdo,
            mileage_end: endOdo,
            trip_distance_km: tripDistance,
            created_at: new Date(date),
            trip_origin: origin,
            trip_destination: destination,
            trip_purpose: tripPurposeToStore,
          })
          .select()
          .single();

        if (insertErr) {
          error("Insert trip error:", insertErr);
          return window.alert(
            insertErr.message ||
              "Failed to save trip. Check console for details.",
          );
        }

        const { error: updateErr } = await supabase
          .from("vehicles")
          .update({ current_mileage: endOdo })
          .eq("id", vehicleId)
          .eq("user_id", user.id);

        if (updateErr) {
          error("Update vehicle mileage error (trip):", updateErr);
          window.alert(
            "Trip saved but failed to update vehicle mileage. Check console for details.",
          );
        } else {
          successEl.hidden = false;
          successEl.textContent = "Trip saved and vehicle odometer updated.";
          setTimeout(() => window.location.reload(), 700);
        }
      } catch (err) {
        error("Unexpected error saving trip:", err);
        window.alert("An unexpected error occurred. See console for details.");
      }
    });

  // ---------- Finalize ----------
  await requestServiceNotifications();
  vehicleList.forEach(notifyServiceDue);

  log("trip.js initialized");
}
