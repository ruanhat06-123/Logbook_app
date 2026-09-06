/**
 * Offline Sync Module
 * Handles automatic syncing of pending trips to OpenRouteService (ORS) when connectivity returns
 * Implements network state detection and background sync queue
 */

import { getLocalStore, setLocalStore, removeLocalStore } from "./localStore.js";
import { callOpenRouteServiceMapMatching, calculateDistanceFromCoordinates } from "./distanceCalculator.js";

const log = (...args) => console.log("[Offline Sync]", ...args);
const warn = (...args) => console.warn("[Offline Sync]", ...args);
const error = (...args) => console.error("[Offline Sync]", ...args);

let isSyncing = false;
let syncListenerAdded = false;

/**
 * Initialize offline sync system
 * Sets up network listeners for automatic sync when online
 */
export function initializeOfflineSync() {
  if (syncListenerAdded) {
    warn("Offline sync already initialized");
    return;
  }

  syncListenerAdded = true;

  // Listen for online event
  window.addEventListener("online", () => {
    log("Network connection restored, attempting sync...");
    syncPendingTrips();
  });

  // Also check on app initialization if already online
  if (navigator.onLine) {
    log("App initialized with active network, checking for pending trips");
    syncPendingTrips();
  }

  log("Offline sync initialized");
}

/**
 * Sync all pending trips to OpenRouteService
 * Processes queued trips and updates their distance with road-snapped values
 * @param {string} orsApiKey - OpenRouteService API key (optional if using server proxy)
 * @returns {Promise<{success: boolean, syncedCount: number, failedCount: number, message: string}>}
 */
export async function syncPendingTrips(orsApiKey = null) {
  if (isSyncing) {
    warn("Sync already in progress");
    return { success: false, syncedCount: 0, failedCount: 0, message: "Sync already in progress" };
  }

  // Check network connectivity
  if (!navigator.onLine) {
    warn("Not online, sync deferred");
    return { success: false, syncedCount: 0, failedCount: 0, message: "Offline - sync deferred" };
  }

  isSyncing = true;

  try {
    const pendingTrips = (await getLocalStore("pendingTrips")) || [];

    if (pendingTrips.length === 0) {
      log("No pending trips to sync");
      return { success: true, syncedCount: 0, failedCount: 0, message: "No pending trips" };
    }

    log(`Starting sync of ${pendingTrips.length} pending trips`);

    let syncedCount = 0;
    let failedCount = 0;
    const results = [];

    // Process each pending trip
    for (let i = 0; i < pendingTrips.length; i++) {
      const trip = pendingTrips[i];
      log(`Syncing trip ${i + 1}/${pendingTrips.length}`, { tripId: trip.tripId });

      try {
        const syncResult = await syncSingleTrip(trip, orsApiKey);

        if (syncResult.success) {
          syncedCount++;
          results.push(syncResult);
          log(`✓ Trip synced successfully`, { tripId: trip.tripId, distance: syncResult.snappedDistance });
        } else {
          failedCount++;
          results.push(syncResult);
          warn(`✗ Trip sync failed`, { tripId: trip.tripId, reason: syncResult.message });
        }
      } catch (err) {
        failedCount++;
        error(`Unexpected error syncing trip ${trip.tripId}:`, err);
        results.push({
          tripId: trip.tripId,
          success: false,
          message: `Unexpected error: ${err.message}`,
        });
      }

      // Small delay between requests to avoid rate limiting
      if (i < pendingTrips.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Remove successfully synced trips from pending queue
    const remainingTrips = pendingTrips.filter((trip, i) => !results[i].success);
    await setLocalStore("pendingTrips", remainingTrips);

    const message = `Sync complete: ${syncedCount} succeeded, ${failedCount} failed`;
    log(message);

    return {
      success: failedCount === 0,
      syncedCount,
      failedCount,
      message,
      results,
    };
  } catch (err) {
    error("Fatal error during sync:", err);
    return {
      success: false,
      syncedCount: 0,
      failedCount: 1,
      message: `Fatal sync error: ${err.message}`,
    };
  } finally {
    isSyncing = false;
  }
}

/**
 * Sync a single trip to ORS Map Matching API
 * @private
 */
async function syncSingleTrip(trip, orsApiKey = null) {
  try {
    if (!trip.rawCoordinates || trip.rawCoordinates.length < 2) {
      return {
        tripId: trip.tripId,
        success: false,
        message: "Insufficient coordinates for syncing",
      };
    }

    // Call ORS Map Matching API
    const orsResult = await callOpenRouteServiceMapMatching(trip.rawCoordinates, orsApiKey);

    if (!orsResult.success) {
      return {
        tripId: trip.tripId,
        success: false,
        message: orsResult.message,
      };
    }

    // Update trip payload with snapped distance
    const updatedTrip = {
      ...trip,
      snappedDistance: orsResult.snappedDistance,
      snappedCoordinates: orsResult.snappedCoordinates,
      status: "synced",
      syncedAt: Date.now(),
    };

    // Store the synced trip for historical reference
    const syncedTrips = (await getLocalStore("syncedTrips")) || [];
    syncedTrips.push(updatedTrip);
    await setLocalStore("syncedTrips", syncedTrips);

    // Dispatch custom event for UI updates
    window.dispatchEvent(
      new CustomEvent("trip-synced", {
        detail: updatedTrip,
      })
    );

    return {
      tripId: trip.tripId,
      success: true,
      snappedDistance: orsResult.snappedDistance,
      message: "Trip synced successfully",
    };
  } catch (err) {
    error("Error syncing single trip:", err);
    return {
      tripId: trip.tripId,
      success: false,
      message: `Error: ${err.message}`,
    };
  }
}

/**
 * Get current sync status
 * @returns {object} Sync status info
 */
export async function getSyncStatus() {
  const pendingTrips = (await getLocalStore("pendingTrips")) || [];
  const syncedTrips = (await getLocalStore("syncedTrips")) || [];

  return {
    isSyncing,
    isOnline: navigator.onLine,
    pendingTripsCount: pendingTrips.length,
    syncedTripsCount: syncedTrips.length,
  };
}

/**
 * Get all synced trips from local storage
 * @returns {Promise<Array>} Array of synced trip payloads
 */
export async function getSyncedTrips() {
  return (await getLocalStore("syncedTrips")) || [];
}

/**
 * Get all pending trips from local storage
 * @returns {Promise<Array>} Array of pending trip payloads
 */
export async function getPendingTrips() {
  return (await getLocalStore("pendingTrips")) || [];
}

/**
 * Manually trigger sync (useful for UI buttons)
 * @param {string} orsApiKey - OpenRouteService API key (optional)
 * @returns {Promise<object>} Sync result
 */
export async function manualSync(orsApiKey = null) {
  if (!navigator.onLine) {
    warn("Cannot sync while offline");
    return {
      success: false,
      syncedCount: 0,
      failedCount: 0,
      message: "Device is offline",
    };
  }

  return syncPendingTrips(orsApiKey);
}

/**
 * Clear all synced trips history
 */
export async function clearSyncedTripsHistory() {
  await removeLocalStore("syncedTrips");
  log("Synced trips history cleared");
}

export default {
  initializeOfflineSync,
  syncPendingTrips,
  manualSync,
  getSyncStatus,
  getSyncedTrips,
  getPendingTrips,
  clearSyncedTripsHistory,
};
