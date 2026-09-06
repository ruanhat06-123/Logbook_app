/**
 * GPS Tracking Module
 * Offline-first GPS tracking with drift filtering, accuracy validation, and screen wake lock
 * Handles geolocation.watchPosition() with persistent local storage of coordinates
 */

import { getLocalStore, setLocalStore } from "./localStore.js";

const log = (...args) => console.log("[GPS Tracking]", ...args);
const warn = (...args) => console.warn("[GPS Tracking]", ...args);
const error = (...args) => console.error("[GPS Tracking]", ...args);

// State management
let watchId = null;
let isTracking = false;
let tripCoordinates = [];
let lastRecordedCoord = null;
let wakeLockSentinel = null;
let tripStartTime = null;

// Configuration
const GPS_CONFIG = {
  enableHighAccuracy: true,
  timeout: 10000, // 10 seconds
  maximumAge: 0, // No cached positions
};

// Filter out GPS points with poor accuracy (> 25 meters)
const ACCURACY_THRESHOLD = 25;

// Only record a point if the driver has moved > 10 meters from the last recorded point
const MINIMUM_DISTANCE_METERS = 10;

/**
 * Haversine distance calculator (used locally in this module)
 * Returns distance in meters between two lat/lon coordinates
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Request Screen Wake Lock API to prevent phone sleep during active tracking
 */
async function requestScreenWakeLock() {
  if (!("wakeLock" in navigator)) {
    warn("Screen Wake Lock API not supported on this device");
    return false;
  }

  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    log("Screen wake lock acquired");

    // Re-acquire wake lock if document becomes visible again
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) return;
      if (wakeLockSentinel === null) {
        try {
          wakeLockSentinel = await navigator.wakeLock.request("screen");
          log("Screen wake lock re-acquired after visibility change");
        } catch (err) {
          error("Failed to re-acquire wake lock:", err);
        }
      }
    });

    return true;
  } catch (err) {
    error("Failed to acquire screen wake lock:", err);
    return false;
  }
}

/**
 * Release Screen Wake Lock
 */
async function releaseScreenWakeLock() {
  if (wakeLockSentinel !== null) {
    try {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
      log("Screen wake lock released");
    } catch (err) {
      error("Failed to release wake lock:", err);
    }
  }
}

/**
 * Start GPS tracking with drift filtering and accuracy validation
 * Returns: { success: boolean, message: string }
 */
export async function startTripTracking() {
  if (isTracking) {
    warn("Trip tracking already active");
    return { success: false, message: "Tracking already in progress" };
  }

  // Check geolocation support
  if (!navigator.geolocation) {
    error("Geolocation API not supported");
    return { success: false, message: "Geolocation not supported on this device" };
  }

  try {
    // Initialize trip coordinates array from storage or create new
    tripCoordinates = (await getLocalStore("tripCoordinates")) || [];
    tripStartTime = Date.now();
    lastRecordedCoord = null;
    isTracking = true;

    log("Trip tracking started", { timestamp: tripStartTime, storedCoords: tripCoordinates.length });

    // Request screen wake lock
    await requestScreenWakeLock();

    // Start watching position
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        handlePositionSuccess(position);
      },
      (err) => {
        handlePositionError(err);
      },
      GPS_CONFIG
    );

    return { success: true, message: "GPS tracking started" };
  } catch (err) {
    error("Failed to start tracking:", err);
    isTracking = false;
    return { success: false, message: `Error: ${err.message}` };
  }
}

/**
 * Handle successful position update
 */
function handlePositionSuccess(position) {
  const { latitude, longitude, accuracy, altitude, heading, speed } = position.coords;
  const timestamp = position.timestamp;

  // Filter 1: Accuracy check (reject if accuracy > 25 meters)
  if (accuracy > ACCURACY_THRESHOLD) {
    warn("Position rejected: poor accuracy", { accuracy, threshold: ACCURACY_THRESHOLD });
    return;
  }

  // Filter 2: Drift check - only log if moved > 10 meters from last recorded point
  if (lastRecordedCoord !== null) {
    const distance = haversineDistance(
      lastRecordedCoord.latitude,
      lastRecordedCoord.longitude,
      latitude,
      longitude
    );

    if (distance < MINIMUM_DISTANCE_METERS) {
      log("Position rejected: insufficient distance movement", { distance, threshold: MINIMUM_DISTANCE_METERS });
      return;
    }
  }

  // Position passed all filters - record it
  const coord = {
    latitude,
    longitude,
    accuracy,
    altitude,
    heading,
    speed,
    timestamp,
  };

  tripCoordinates.push(coord);
  lastRecordedCoord = coord;

  log("Position recorded", {
    lat: latitude.toFixed(6),
    lon: longitude.toFixed(6),
    totalPoints: tripCoordinates.length,
    accuracy: accuracy.toFixed(1),
  });

  // Persist to local storage after every GPS tick (offline-first)
  setLocalStore("tripCoordinates", tripCoordinates).catch((err) => {
    error("Failed to persist coordinates to local storage:", err);
  });

  // Dispatch custom event for UI updates
  window.dispatchEvent(
    new CustomEvent("gps-position-recorded", {
      detail: { coord, totalPoints: tripCoordinates.length },
    })
  );
}

/**
 * Handle position error
 */
function handlePositionError(err) {
  warn("Geolocation error:", {
    code: err.code,
    message: err.message,
  });

  // Dispatch event so UI can show user feedback
  window.dispatchEvent(
    new CustomEvent("gps-position-error", {
      detail: { code: err.code, message: err.message },
    })
  );
}

/**
 * End GPS tracking and return the finalized trip payload
 * Returns: { success: boolean, tripPayload: object | null, message: string }
 */
export async function endTripTracking() {
  if (!isTracking || watchId === null) {
    warn("No active trip tracking");
    return { success: false, tripPayload: null, message: "No active trip" };
  }

  try {
    // Stop watching position
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    isTracking = false;
    const tripEndTime = Date.now();

    // Release screen wake lock
    await releaseScreenWakeLock();

    // Build finalized trip payload
    const tripPayload = {
      tripId: generateTripId(),
      startTime: tripStartTime,
      endTime: tripEndTime,
      durationMs: tripEndTime - tripStartTime,
      rawCoordinates: tripCoordinates,
      pointCount: tripCoordinates.length,
      status: "pending-sync", // Will change to "synced" after ORS API call
    };

    log("Trip tracking ended", {
      duration: `${(tripPayload.durationMs / 1000 / 60).toFixed(1)}min`,
      points: tripPayload.pointCount,
    });

    // Save to local storage as "cached_trip_payload"
    await setLocalStore("cachedTripPayload", tripPayload);

    // Also store in pending trips array for sync queue
    const pendingTrips = (await getLocalStore("pendingTrips")) || [];
    pendingTrips.push(tripPayload);
    await setLocalStore("pendingTrips", pendingTrips);

    // Clear the active trip coordinates
    tripCoordinates = [];
    lastRecordedCoord = null;
    tripStartTime = null;
    await setLocalStore("tripCoordinates", []);

    return { success: true, tripPayload, message: "Trip saved locally" };
  } catch (err) {
    error("Failed to end tracking:", err);
    return { success: false, tripPayload: null, message: `Error: ${err.message}` };
  }
}

/**
 * Generate a unique trip ID
 */
function generateTripId() {
  return `trip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get the current trip coordinates array
 */
export function getTripCoordinates() {
  return [...tripCoordinates];
}

/**
 * Get current tracking status
 */
export function getTrackingStatus() {
  return {
    isTracking,
    pointCount: tripCoordinates.length,
    elapsedSeconds: isTracking && tripStartTime ? (Date.now() - tripStartTime) / 1000 : 0,
    lastCoord: lastRecordedCoord,
  };
}

/**
 * Cancel active trip tracking (discards coordinates)
 */
export async function cancelTripTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  isTracking = false;
  tripCoordinates = [];
  lastRecordedCoord = null;
  tripStartTime = null;

  await releaseScreenWakeLock();
  await setLocalStore("tripCoordinates", []);

  log("Trip tracking cancelled");
  return { success: true, message: "Trip cancelled" };
}

/**
 * Clear cached pending trips from local storage
 */
export async function clearPendingTrips() {
  await setLocalStore("pendingTrips", []);
  log("Pending trips cleared");
}

export default {
  startTripTracking,
  endTripTracking,
  getTripCoordinates,
  getTrackingStatus,
  cancelTripTracking,
  clearPendingTrips,
};
