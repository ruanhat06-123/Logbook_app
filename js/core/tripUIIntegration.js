/**
 * Trip UI Integration Module
 * Orchestrates the complete live-trip workflow:
 * - Start GPS tracking when the user clicks "Start trip"
 * - Show a persistent notification with the current distance while tracking
 * - When the trip ends, capture the trip data and populate the existing
 *   trip form on the page (no separate completion form / modal)
 * - Close the tracking notification when the trip is ended from the app
 */

import {
  startTripTracking,
  endTripTracking,
  getTrackingStatus,
} from "./gpsTracking.js";
import {
  calculateDistanceFromCoordinates,
  formatDistance,
} from "./distanceCalculator.js";
import { getLocalStore, setLocalStore } from "./localStore.js";
import {
  isNativeBackgroundLocationAvailable,
  startNativeBackgroundWatcher,
  stopNativeBackgroundWatcher,
} from "./nativeBackgroundGeolocation.js";

const log = (...args) => console.log("[Trip UI]", ...args);
const warn = (...args) => console.warn("[Trip UI]", ...args);
const error = (...args) => console.error("[Trip UI]", ...args);

const APP_ICON = "/assets/logo.svg";
const TRACKING_NOTIFICATION_TAG = "logmate-live-trip";

const MAPBOX_TOKEN =
  (typeof window !== "undefined" && window.__ENV?.VITE_MAPBOX_TOKEN) || "";

/**
 * Reverse-geocode a single coordinate pair via Mapbox.
 * Called at most twice per trip (start point + end point), both fired once
 * in parallel at trip end. Results are cached in local storage keyed by
 * rounded coordinates so reloads never cost extra calls.
 * Falls back to raw "lat,lon" text when offline or when no token is set.
 */
async function reverseGeocode(lat, lon) {
  const fallback = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (!MAPBOX_TOKEN || !navigator.onLine) return fallback;
  const cacheKey = `geocache_${lat.toFixed(4)}_${lon.toFixed(4)}`;
  try {
    const cached = await getLocalStore(cacheKey);
    if (cached) return cached;
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(lon)},${encodeURIComponent(lat)}.json?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1`;
    const resp = await fetch(url);
    if (!resp.ok) return fallback;
    const data = await resp.json();
    const label = data?.features?.[0]?.place_name || fallback;
    await setLocalStore(cacheKey, label);
    return label;
  } catch (err) {
    warn("Reverse geocode failed, using coordinates:", err);
    return fallback;
  }
}

// State
let activeTripSession = null;
let trackingStatusInterval = null;
let pendingTripData = null;
let swRegistration = null;
let lastNotificationUpdateAt = 0;
let smartWatchId = null;
let nativeSmartWatcherId = null;
let smartMonitorInterval = null;
let smartMovementCandidateCount = 0;
let smartLastPosition = null;
let smartLastMovementAt = 0;
let smartStarting = false;
let smartEnding = false;
const STATUS_UPDATE_INTERVAL_MS = 5000;
const NOTIFICATION_UPDATE_INTERVAL_MS = 15000;
const DEFAULT_SMART_START_SPEED_MPS = 3;
const DEFAULT_SMART_START_DISTANCE_METERS = 25;
const SMART_START_CONFIRMATIONS = 3;
const SMART_ACCURACY_THRESHOLD_METERS = 15;
const DEFAULT_SMART_STOP_AFTER_MINUTES = 3;

const boundedLocalNumber = (key, fallback, min, max) => {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

const smartStartSpeedMps = () =>
  boundedLocalNumber("smartTripStartSpeedKph", DEFAULT_SMART_START_SPEED_MPS * 3.6, 5, 80) / 3.6;
const smartStartDistanceMeters = () =>
  boundedLocalNumber("smartTripStartDistanceMeters", DEFAULT_SMART_START_DISTANCE_METERS, 5, 200);
const smartStopAfterMs = () =>
  boundedLocalNumber("smartTripStopMinutes", DEFAULT_SMART_STOP_AFTER_MINUTES, 1, 30) * 60 * 1000;

/**
 * Initialize trip UI handlers
 * Call this once when the trip page loads
 */
export async function initializeTripUI() {
  log("Initializing trip UI");

  // Grab the service worker registration once so we can show/update
  // notifications without calling navigator.serviceWorker.ready every time.
  if ("serviceWorker" in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.ready;
    } catch (err) {
      warn("Service worker not ready for notifications:", err);
    }
  }

  // Wire up button handlers
  const startBtn = document.getElementById("start-live-trip");
  const endBtn = document.getElementById("end-live-trip");

  if (startBtn) {
    startBtn.addEventListener("click", handleStartTrip);
  }

  if (endBtn) {
    endBtn.addEventListener("click", handleEndTrip);
  }

  const storedActiveTrip = await getLocalStore("activeTripSession");
  if (storedActiveTrip?.startTime && !getTrackingStatus().isTracking) {
    await handleStartTrip(undefined, {
      automatic: storedActiveTrip.automatic === true,
      resumeSession: storedActiveTrip,
    });
  }

  if (localStorage.getItem("smartTrips") === "on") startSmartTripMonitor();

  // Listen for "End trip" action from the notification
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "end-live-trip") {
      log("Received end-live-trip message from notification");
      handleEndTrip();
    }
  });

  log("Trip UI initialized");
}

/**
 * Handle "Start trip" button click
 */
async function handleStartTrip(
  event,
  { automatic = false, resumeSession = null } = {},
) {
  event?.preventDefault?.();

  const vehicleSelect = document.getElementById("vehicle");
  const vehicleId = vehicleSelect?.value;

  if (resumeSession?.vehicleId && vehicleSelect) {
    vehicleSelect.value = resumeSession.vehicleId;
  }

  if (!vehicleId && !automatic) {
    alert("Please select a vehicle");
    return;
  }

  try {
    const result = await startTripTracking({
      startTime: resumeSession?.startTime || Date.now(),
    });

    if (!result.success) {
      alert(`Failed to start trip: ${result.message}`);
      return;
    }

    log("Trip started successfully");
    lastNotificationUpdateAt = 0;

    // Update UI
    const startBtn = document.getElementById("start-live-trip");
    const endBtn = document.getElementById("end-live-trip");
    const statusDiv = document.getElementById("live-trip-status");

    if (startBtn) startBtn.hidden = true;
    if (endBtn) endBtn.hidden = false;

    // Start polling tracking status
    startTrackingStatusPolling();

    // Disable vehicle selection during trip
    if (vehicleSelect) vehicleSelect.disabled = true;

    // Show status
    if (statusDiv) {
      statusDiv.hidden = false;
      statusDiv.textContent = "🟢 Trip tracking active...";
    }

    // Create active trip session
    activeTripSession = resumeSession || {
      vehicleId,
      startTime: Date.now(),
      startedAt: new Date().toLocaleString(),
      automatic,
    };
    if (automatic) smartLastMovementAt = Date.now();

    // Save session to local storage in case of crash
    await setLocalStore("activeTripSession", activeTripSession);

      // Show the live tracking notification with smart flag
      await showTrackingNotification(0, { smart: automatic });
  } catch (err) {
    error("Error starting trip:", err);
    alert(`Error starting trip: ${err.message}`);
  }
}

/**
 * Start polling GPS tracking status for real-time UI + notification updates
 */
function startTrackingStatusPolling() {
  if (trackingStatusInterval) clearInterval(trackingStatusInterval);

  trackingStatusInterval = setInterval(async () => {
    const status = getTrackingStatus();
    const statusDiv = document.getElementById("live-trip-status");

    // Compute the current offline (straight-line) distance of the trip
    // without hitting any external API.
    const coordinates = (await getLocalStore("tripCoordinates")) || [];
    const currentDistance = calculateDistanceFromCoordinates(coordinates);
    const distanceStr = formatDistance(currentDistance);

    if (statusDiv && !statusDiv.hidden) {
      const minutes = Math.floor(status.elapsedSeconds / 60);
      const seconds = Math.floor(status.elapsedSeconds % 60);
      const timeStr = `${minutes}m ${seconds}s`;

      statusDiv.innerHTML = `🟢 <strong>Tracking active:</strong> ${timeStr} · ${distanceStr}`;
    }

    // Update the persistent notification with the current distance
    await showTrackingNotification(currentDistance, {
      smart: activeTripSession?.automatic === true,
    });
  }, STATUS_UPDATE_INTERVAL_MS);
}

/**
 * Stop polling tracking status
 */
function stopTrackingStatusPolling() {
  if (trackingStatusInterval) {
    clearInterval(trackingStatusInterval);
    trackingStatusInterval = null;
  }
}

/**
 * Show or update the persistent tracking notification with the
 * current trip distance. Uses the service worker when available so the
 * notification can show an "End trip" action; falls back to a plain
 * Notification otherwise.
 */
async function showTrackingNotification(distanceMeters, { smart = false } = {}) {
    if (!smart && localStorage.getItem("tripNotifications") === "off") return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (err) {
      warn("Notification permission request failed:", err);
    }
  }
  if (Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - lastNotificationUpdateAt < NOTIFICATION_UPDATE_INTERVAL_MS) return;
  lastNotificationUpdateAt = now;

  const options = {
    body: `LogMate is tracking this trip. Current distance: ${formatDistance(distanceMeters)}`,
    tag: TRACKING_NOTIFICATION_TAG,
    icon: APP_ICON,
    badge: APP_ICON,
    renotify: false,
    silent: true,
    actions: [{ action: "end-trip", title: "End trip" }],
  };

  try {
      const title = smart ? "Smart Trip started" : "Trip started";
      if (swRegistration?.showNotification) {
        await swRegistration.showNotification(title, options);
      } else {
        new Notification(title, options);
      }
  } catch (err) {
    warn("Failed to show tracking notification:", err);
  }
}

/**
 * Close the live tracking notification (called when the trip is ended
 * from inside the app).
 */
async function closeTrackingNotification() {
  try {
    if (swRegistration?.getNotifications) {
      const notifications = await swRegistration.getNotifications({
        tag: TRACKING_NOTIFICATION_TAG,
      });
      notifications.forEach((n) => n.close());
    }
  } catch (err) {
    warn("Failed to close tracking notification:", err);
  }
}

/**
 * Handle "End trip" button click
 */
async function handleEndTrip(event, { automatic = false } = {}) {
  event?.preventDefault?.();

  try {
    stopTrackingStatusPolling();

    const wasAutomatic = automatic || activeTripSession?.automatic === true;
    const result = await endTripTracking();

    if (!result.success) {
      alert(`Failed to end trip: ${result.message}`);
      // Resume tracking if end failed
      startTrackingStatusPolling();
      return;
    }

    log("Trip ended successfully", result.tripPayload);

    // Update UI
    const startBtn = document.getElementById("start-live-trip");
    const endBtn = document.getElementById("end-live-trip");
    const statusDiv = document.getElementById("live-trip-status");
    const vehicleSelect = document.getElementById("vehicle");

    if (startBtn) startBtn.hidden = false;
    if (endBtn) endBtn.hidden = true;
    if (statusDiv) statusDiv.hidden = true;
    if (vehicleSelect) vehicleSelect.disabled = false;

    // Close the persistent tracking notification since the trip was ended
    // from within the app.
    await closeTrackingNotification();

    // Calculate offline distance locally from the recorded GPS route
    // (no API call — this is the user's actual travelled route).
    const coordinates = result.tripPayload.rawCoordinates;
    const offlineDistance = calculateDistanceFromCoordinates(coordinates);

    // Resolve the start and end locations with at most 2 API calls per
    // trip (one reverse geocode for each endpoint), fired in parallel.
    // Results are cached, so a page reload never re-spends the calls.
    const firstCoord = coordinates[0];
    const lastCoord = coordinates[coordinates.length - 1];
    if (statusDiv) {
      statusDiv.hidden = false;
      statusDiv.textContent = "Trip ended · resolving start and end locations…";
    }

    const [originLabel, destinationLabel] = await Promise.all([
      firstCoord
        ? reverseGeocode(firstCoord.latitude, firstCoord.longitude)
        : Promise.resolve(""),
      lastCoord && coordinates.length > 1
        ? reverseGeocode(lastCoord.latitude, lastCoord.longitude)
        : Promise.resolve(""),
    ]);

    // Prepare trip completion data
    const tripData = {
      tripId: result.tripPayload.tripId,
      vehicleId: activeTripSession?.vehicleId,
      startTime: result.tripPayload.startTime,
      endTime: result.tripPayload.endTime,
      durationMs: result.tripPayload.durationMs,
      pointCount: result.tripPayload.pointCount,
      offlineDistance,
      originLabel,
      destinationLabel,
      rawCoordinates: coordinates,
      automatic: wasAutomatic,
    };

    // Store pending trip data so the trip page can pick it up on reload
    pendingTripData = tripData;
    await setLocalStore("pendingTripData", tripData);

    // Clear active session
    activeTripSession = null;
    await setLocalStore("activeTripSession", null);

    // Populate the existing trip form with the recorded data
    populateTripForm(tripData);
    if (wasAutomatic) showSmartTripReview(tripData);
    smartEnding = false;
    if (wasAutomatic && localStorage.getItem("smartTrips") === "on") {
      startSmartTripMonitor().catch((err) => warn("Smart Trips monitor restart failed:", err));
    }
  } catch (err) {
    error("Error ending trip:", err);
    smartEnding = false;
    alert(`Error ending trip: ${err.message}`);
    startTrackingStatusPolling();
  }
}

function handleSmartLocation({ latitude, longitude, speed, timestamp }) {
  let distance = 0;
  if (smartLastPosition) {
    distance = calculateDistanceFromCoordinates([
      { latitude: smartLastPosition.latitude, longitude: smartLastPosition.longitude },
      { latitude, longitude },
    ]);
  }
  const elapsed = smartLastPosition ? Math.max(1, (timestamp - smartLastPosition.timestamp) / 1000) : 0;
  const startSpeed = smartStartSpeedMps();
  const moving = Number(speed) >= startSpeed || (elapsed > 0 && distance / elapsed >= startSpeed) || distance >= smartStartDistanceMeters();
  smartLastPosition = { latitude, longitude, timestamp };
  if (getTrackingStatus().isTracking) {
    if (moving) smartLastMovementAt = Date.now();
    return;
  }
  if (moving) smartMovementCandidateCount += 1;
  else smartMovementCandidateCount = 0;
  if (smartMovementCandidateCount >= SMART_START_CONFIRMATIONS && !smartStarting) {
    smartStarting = true;
    smartMovementCandidateCount = 0;
    if (nativeSmartWatcherId !== null) {
      stopNativeBackgroundWatcher(nativeSmartWatcherId).catch(() => {});
      nativeSmartWatcherId = null;
    }
    handleStartTrip(undefined, { automatic: true }).finally(() => { smartStarting = false; });
  }
}

export async function startSmartTripMonitor() {
  if (smartWatchId !== null || nativeSmartWatcherId !== null) return;
  smartLastMovementAt = Date.now();
  if (isNativeBackgroundLocationAvailable()) {
    nativeSmartWatcherId = await startNativeBackgroundWatcher(
      (location) => handleSmartLocation({
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speed,
        timestamp: location.time || Date.now(),
      }),
      (err) => warn("Smart Trips native location monitor:", err),
    );
  }
  if (nativeSmartWatcherId === null && navigator.geolocation) {
    smartWatchId = navigator.geolocation.watchPosition(
      (position) => handleSmartLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        speed: position.coords.speed,
        timestamp: position.timestamp || Date.now(),
      }),
      (err) => warn("Smart Trips location monitor:", err.message),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    );
  }
  if (!smartMonitorInterval) smartMonitorInterval = setInterval(() => {
    if (!smartEnding && getTrackingStatus().isTracking && activeTripSession?.automatic && Date.now() - smartLastMovementAt >= smartStopAfterMs()) {
      smartEnding = true;
      handleEndTrip(undefined, { automatic: true });
    }
  }, 15000);
}

function showSmartTripReview(tripData) {
  document.querySelector("[data-smart-review]")?.remove();
  const vehicleSelect = document.querySelector("#vehicle");
  const vehicles = [...(vehicleSelect?.options || [])]
    .filter((option) => option.value)
    .map((option) => `<option value="${option.value}">${option.textContent}</option>`)
    .join("");
  const endOdo = document.querySelector("#end-odo")?.value || "";
  document.body.insertAdjacentHTML("beforeend", `<div class="smart-review-backdrop" data-smart-review><section class="smart-review" role="dialog" aria-modal="true" aria-labelledby="smart-review-title"><div class="eyebrow">Smart Trips / Review</div><h2 id="smart-review-title">Review your ended trip</h2><p class="row-sub">Smart Trips stopped recording after you stopped moving. Confirm these details before saving the trip.</p><div class="form-grid"><div class="field full"><label for="smart-review-vehicle">Vehicle</label><select id="smart-review-vehicle" required><option value="">Select a vehicle</option>${vehicles}</select></div><div class="field"><label for="smart-review-type">Trip type</label><select id="smart-review-type"><option value="personal">Personal</option><option value="business">Business</option></select></div><div class="field"><label for="smart-review-purpose">Purpose</label><select id="smart-review-purpose" required><option value="">Select purpose</option><option value="commute">Commute</option><option value="errand">Errand</option><option value="delivery">Delivery</option><option value="client_meeting">Client meeting</option><option value="other">Other</option></select></div><div class="field full"><label for="smart-review-end-odo">End odometer (km)</label><input id="smart-review-end-odo" type="number" min="0" step="1" value="${endOdo}" required></div></div><label class="setting-check"><input id="smart-review-confirm" type="checkbox"> I confirm the end odometer is correct.</label><div class="smart-review-actions"><button class="btn btn-primary" type="button" data-smart-confirm>Confirm details</button><button class="btn btn-secondary" type="button" data-smart-continue>Continue trip</button><button class="btn btn-secondary" type="button" data-smart-dismiss>Keep editing</button><button class="btn btn-secondary" type="button" data-smart-discard>Discard trip</button></div></section></div>`);
  const review = document.querySelector("[data-smart-review]");
  review.querySelector("[data-smart-confirm]").addEventListener("click", () => {
    const selectedVehicle = review.querySelector("#smart-review-vehicle").value;
    const purpose = review.querySelector("#smart-review-purpose").value;
    const confirmed = review.querySelector("#smart-review-confirm").checked;
    if (!selectedVehicle || !purpose || !confirmed) {
      review.querySelector(".row-sub").textContent = "Select a vehicle and purpose, then confirm the end odometer before continuing.";
      return;
    }
    document.querySelector("#vehicle").value = selectedVehicle;
    document.querySelector("#trip-type").value = review.querySelector("#smart-review-type").value;
    document.querySelector("#purpose").value = purpose;
    document.querySelector("#end-odo").value = review.querySelector("#smart-review-end-odo").value;
    review.remove();
  });
  review.querySelector("[data-smart-continue]").addEventListener("click", async () => {
    const route = Array.isArray(tripData.rawCoordinates) ? tripData.rawCoordinates : [];
    if (!route.length) {
      review.querySelector(".row-sub").textContent = "There is no recorded route to continue.";
      return;
    }
    const vehicleId = review.querySelector("#smart-review-vehicle").value || tripData.vehicleId;
    if (!vehicleId) {
      review.querySelector(".row-sub").textContent = "Select a vehicle before continuing the trip.";
      return;
    }
    try {
      await setLocalStore("tripCoordinates", route);
      await setLocalStore("pendingTripData", null);
      await setLocalStore("cachedTripPayload", null);
      activeTripSession = {
        vehicleId,
        startTime: tripData.startTime || Date.now(),
        startedAt: new Date(tripData.startTime || Date.now()).toLocaleString(),
        automatic: true,
      };
      smartEnding = false;
      review.remove();
      await handleStartTrip(undefined, { automatic: true, resumeSession: activeTripSession });
    } catch (err) {
      error("Failed to continue Smart Trip:", err);
      review.querySelector(".row-sub").textContent = "Unable to continue this trip. Please try again.";
    }
  });
  review.querySelector("[data-smart-dismiss]").addEventListener("click", () => review.remove());
  review.querySelector("[data-smart-discard]").addEventListener("click", async () => {
    if (!window.confirm("Discard this Smart Trip? The recorded route will not be saved.")) return;
    await setLocalStore("pendingTripData", null);
    await setLocalStore("cachedTripPayload", null);
    await setLocalStore("tripCoordinates", []);
    window.location.reload();
  });
}

/**
 * Populate the existing trip form on the page with data from a completed
 * live trip. This intentionally reuses the main #trip-form instead of
 * showing a second, separate "completion" form.
 */
function populateTripForm(tripData) {
  const vehicleSelect = document.getElementById("vehicle");
  const dateInput = document.getElementById("date");
  const startOdoInput = document.getElementById("start-odo");
  const endOdoInput = document.getElementById("end-odo");
  const originInput = document.getElementById("origin");
  const destinationInput = document.getElementById("destination");

  // Vehicle
  if (vehicleSelect && tripData.vehicleId) {
    vehicleSelect.value = tripData.vehicleId;
  }

  // Date
  if (dateInput && tripData.startTime) {
    dateInput.value = new Date(tripData.startTime).toISOString().slice(0, 10);
  }

  // Odometer readings. Start odometer comes from the vehicle's current
  // mileage (already auto-populated by the page); end odometer is the
  // start plus the recorded straight-line distance.
  const startOdo = Number(startOdoInput?.value);
  if (Number.isFinite(startOdo) && endOdoInput) {
    const distanceKm = tripData.offlineDistance / 1000;
    endOdoInput.value = Math.round(startOdo + distanceKm);
  }

  // Origin / destination: use the reverse-geocoded place names resolved at
  // trip end (falling back to raw coordinates when offline).
  const coords = tripData.rawCoordinates || [];
  if (originInput && coords.length > 0) {
    const first = coords[0];
    originInput.value =
      tripData.originLabel ||
      `${first.latitude.toFixed(6)},${first.longitude.toFixed(6)}`;
  }
  if (destinationInput && coords.length > 1) {
    const last = coords[coords.length - 1];
    destinationInput.value =
      tripData.destinationLabel ||
      `${last.latitude.toFixed(6)},${last.longitude.toFixed(6)}`;
  }

  // Let the user know the form was populated from the live trip
  const statusDiv = document.getElementById("live-trip-status");
  if (statusDiv) {
    statusDiv.hidden = false;
    statusDiv.textContent = `Trip ended · ${formatDistance(tripData.offlineDistance)} recorded — review the details below and save.`;
  }

  // Scroll the form into view so the user can complete the remaining fields
  document.getElementById("trip-form")?.scrollIntoView({ behavior: "smooth" });
}

export default {
  initializeTripUI,
};
