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
async function handleStartTrip(event) {
  event?.preventDefault?.();

  const vehicleSelect = document.getElementById("vehicle");
  const vehicleId = vehicleSelect?.value;

  if (!vehicleId) {
    alert("Please select a vehicle");
    return;
  }

  try {
    const result = await startTripTracking();

    if (!result.success) {
      alert(`Failed to start trip: ${result.message}`);
      return;
    }

    log("Trip started successfully");

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
    activeTripSession = {
      vehicleId,
      startTime: Date.now(),
      startedAt: new Date().toLocaleString(),
    };

    // Save session to local storage in case of crash
    await setLocalStore("activeTripSession", activeTripSession);

    // Show the live tracking notification
    await showTrackingNotification(0);
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
    await showTrackingNotification(currentDistance);
  }, 1000);
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
async function showTrackingNotification(distanceMeters) {
  if (localStorage.getItem("tripNotifications") === "off") return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (err) {
      warn("Notification permission request failed:", err);
    }
  }
  if (Notification.permission !== "granted") return;

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
    if (swRegistration?.showNotification) {
      await swRegistration.showNotification("Trip started", options);
    } else {
      new Notification("Trip started", options);
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
async function handleEndTrip(event) {
  event?.preventDefault?.();

  try {
    stopTrackingStatusPolling();

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
    };

    // Store pending trip data so the trip page can pick it up on reload
    pendingTripData = tripData;
    await setLocalStore("pendingTripData", tripData);

    // Clear active session
    activeTripSession = null;
    await setLocalStore("activeTripSession", null);

    // Populate the existing trip form with the recorded data
    populateTripForm(tripData);
  } catch (err) {
    error("Error ending trip:", err);
    alert(`Error ending trip: ${err.message}`);
    startTrackingStatusPolling();
  }
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
