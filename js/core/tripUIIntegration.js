/**
 * Trip UI Integration Module
 * Orchestrates the complete trip workflow:
 * - Start GPS tracking when user clicks "Start trip"
 * - Monitor GPS tracking in real-time
 * - When trip ends, capture the trip data
 * - Show purpose/type selection modal
 * - Save trip to database and sync when online
 */

import { startTripTracking, endTripTracking, getTrackingStatus, getTripCoordinates } from "./gpsTracking.js";
import { calculateDistanceFromCoordinates, formatDistance } from "./distanceCalculator.js";
import { getLocalStore, setLocalStore } from "./localStore.js";

const log = (...args) => console.log("[Trip UI]", ...args);
const warn = (...args) => console.warn("[Trip UI]", ...args);
const error = (...args) => console.error("[Trip UI]", ...args);

// State
let activeTripSession = null;
let trackingStatusInterval = null;
let pendingTripData = null;

/**
 * Initialize trip UI handlers
 * Call this once when the trip page loads
 */
export async function initializeTripUI() {
  log("Initializing trip UI");

  // Restore any pending trip from a previous session
  await restorePendingTripData();

  // Wire up button handlers
  const startBtn = document.getElementById("start-live-trip");
  const endBtn = document.getElementById("end-live-trip");

  if (startBtn) {
    startBtn.addEventListener("click", handleStartTrip);
  }

  if (endBtn) {
    endBtn.addEventListener("click", handleEndTrip);
  }

  // Listen for navigation from notification
  window.addEventListener("message", (event) => {
    if (event.data.type === "end-live-trip") {
      log("Received end-live-trip message from notification");
      handleEndTripFromNotification();
    }
  });

  // Listen for online event to sync pending trips
  window.addEventListener("online", () => {
    log("Online detected, checking for synced trips");
  });

  log("Trip UI initialized");
}

/**
 * Restore pending trip data if the app crashed/reloaded mid-trip
 */
async function restorePendingTripData() {
  try {
    const pending = await getLocalStore("pendingTripData");
    if (pending) {
      log("Found pending trip data from previous session", pending);
      pendingTripData = pending;
      // Show the completion modal immediately
      showTripCompletionModal(pending);
    }
  } catch (err) {
    warn("Failed to restore pending trip data:", err);
  }
}

/**
 * Handle "Start trip" button click
 */
async function handleStartTrip(event) {
  event.preventDefault();

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

    // Request notification permission for end-trip notification
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Create active trip session
    activeTripSession = {
      vehicleId,
      startTime: Date.now(),
      startedAt: new Date().toLocaleString(),
    };

    // Save session to local storage in case of crash
    await setLocalStore("activeTripSession", activeTripSession);
  } catch (err) {
    error("Error starting trip:", err);
    alert(`Error starting trip: ${err.message}`);
  }
}

/**
 * Start polling GPS tracking status for real-time UI updates
 */
function startTrackingStatusPolling() {
  if (trackingStatusInterval) clearInterval(trackingStatusInterval);

  trackingStatusInterval = setInterval(() => {
    const status = getTrackingStatus();
    const statusDiv = document.getElementById("live-trip-status");

    if (statusDiv && !statusDiv.hidden) {
      const minutes = Math.floor(status.elapsedSeconds / 60);
      const seconds = Math.floor(status.elapsedSeconds % 60);
      const timeStr = `${minutes}m ${seconds}s`;
      const pointsStr = `${status.pointCount} points`;

      statusDiv.innerHTML = `🟢 <strong>Tracking active:</strong> ${timeStr} · ${pointsStr}`;

      if (status.lastCoord) {
        const accuracy = status.lastCoord.accuracy.toFixed(1);
        statusDiv.innerHTML += ` · Accuracy: ±${accuracy}m`;
      }
    }
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
 * Handle "End trip" button click
 */
async function handleEndTrip(event) {
  event.preventDefault();

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

    // Calculate offline distance for display
    const coordinates = result.tripPayload.rawCoordinates;
    const offlineDistance = calculateDistanceFromCoordinates(coordinates);

    // Prepare trip completion data
    const tripData = {
      tripId: result.tripPayload.tripId,
      vehicleId: activeTripSession?.vehicleId,
      startTime: result.tripPayload.startTime,
      endTime: result.tripPayload.endTime,
      durationMs: result.tripPayload.durationMs,
      pointCount: result.tripPayload.pointCount,
      offlineDistance,
      rawCoordinates: coordinates,
      status: "pending-sync",
    };

    // Store pending trip data
    pendingTripData = tripData;
    await setLocalStore("pendingTripData", tripData);

    // Clear active session
    activeTripSession = null;
    await setLocalStore("activeTripSession", null);

    // Show purpose/type selection modal
    showTripCompletionModal(tripData);

    // Show notification with "End trip" action
    showEndTripNotification(tripData);
  } catch (err) {
    error("Error ending trip:", err);
    alert(`Error ending trip: ${err.message}`);
    startTrackingStatusPolling();
  }
}

/**
 * Handle end-trip message from notification
 */
async function handleEndTripFromNotification() {
  if (pendingTripData) {
    log("Showing pending trip completion modal from notification");
    showTripCompletionModal(pendingTripData);
  }
}

/**
 * Show trip completion modal for purpose/type selection
 */
function showTripCompletionModal(tripData) {
  // Create modal HTML
  const modalHTML = `
    <div id="trip-completion-modal" class="trip-completion-modal" style="
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 20px;
    ">
      <div style="
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 500px;
        width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 25px rgba(0, 0, 0, 0.15);
      ">
        <h2 style="margin: 0 0 16px 0; font-size: 24px;">Trip completed</h2>
        
        <div style="
          background: #f0f9ff;
          border-left: 4px solid #0284c7;
          padding: 12px 16px;
          border-radius: 6px;
          margin-bottom: 20px;
          font-size: 14px;
        ">
          <div><strong>Duration:</strong> ${formatDuration(tripData.durationMs)}</div>
          <div><strong>Points recorded:</strong> ${tripData.pointCount}</div>
          <div><strong>Offline distance:</strong> ${formatDistance(tripData.offlineDistance)}</div>
          <div style="font-size: 12px; color: #666; margin-top: 8px;">
            📍 Syncing distance with road network when online...
          </div>
        </div>

        <form id="trip-completion-form" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label for="completion-vehicle" style="display: block; font-weight: 500; margin-bottom: 8px;">
              Vehicle
            </label>
            <select id="completion-vehicle" required style="
              width: 100%;
              padding: 8px 12px;
              border: 1px solid #ddd;
              border-radius: 6px;
              font-size: 14px;
            ">
              <option value="">Select vehicle</option>
            </select>
          </div>

          <div>
            <label for="completion-trip-type" style="display: block; font-weight: 500; margin-bottom: 8px;">
              Trip type *
            </label>
            <select id="completion-trip-type" required style="
              width: 100%;
              padding: 8px 12px;
              border: 1px solid #ddd;
              border-radius: 6px;
              font-size: 14px;
            ">
              <option value="">Select trip type</option>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </select>
          </div>

          <div>
            <label for="completion-purpose" style="display: block; font-weight: 500; margin-bottom: 8px;">
              Purpose *
            </label>
            <select id="completion-purpose" required style="
              width: 100%;
              padding: 8px 12px;
              border: 1px solid #ddd;
              border-radius: 6px;
              font-size: 14px;
            ">
              <option value="">Select purpose</option>
              <option value="commute">Commute</option>
              <option value="errand">Errand</option>
              <option value="delivery">Delivery</option>
              <option value="client_meeting">Client meeting</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div id="completion-purpose-other-field" style="display: none;">
            <label for="completion-purpose-other" style="display: block; font-weight: 500; margin-bottom: 8px;">
              Please describe the purpose
            </label>
            <input id="completion-purpose-other" type="text" maxlength="200" placeholder="Describe the purpose" style="
              width: 100%;
              padding: 8px 12px;
              border: 1px solid #ddd;
              border-radius: 6px;
              font-size: 14px;
              box-sizing: border-box;
            " />
          </div>

          <div>
            <label for="completion-notes" style="display: block; font-weight: 500; margin-bottom: 8px;">
              Notes (optional)
            </label>
            <textarea id="completion-notes" maxlength="500" placeholder="Add any additional notes..." style="
              width: 100%;
              padding: 8px 12px;
              border: 1px solid #ddd;
              border-radius: 6px;
              font-size: 14px;
              font-family: inherit;
              box-sizing: border-box;
              resize: vertical;
              min-height: 80px;
            "></textarea>
          </div>

          <div style="display: flex; gap: 12px; margin-top: 20px;">
            <button type="button" id="trip-completion-cancel" class="btn btn-secondary" style="
              flex: 1;
              padding: 10px 16px;
              border: 1px solid #ddd;
              background: #f3f4f6;
              border-radius: 6px;
              cursor: pointer;
              font-weight: 500;
            ">
              Cancel
            </button>
            <button type="submit" class="btn btn-primary" style="
              flex: 1;
              padding: 10px 16px;
              background: #2563eb;
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-weight: 500;
            ">
              Save trip
            </button>
          </div>
        </form>

        <div id="trip-completion-error" style="
          color: #dc2626;
          font-size: 14px;
          margin-top: 12px;
          display: none;
        "></div>
      </div>
    </div>
  `;

  // Remove any existing modal
  const existing = document.getElementById("trip-completion-modal");
  if (existing) existing.remove();

  // Insert modal
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  // Populate vehicle select
  populateVehicleSelect("completion-vehicle", tripData.vehicleId);

  // Wire up form handlers
  const form = document.getElementById("trip-completion-form");
  const purposeSelect = document.getElementById("completion-purpose");
  const purposeOtherField = document.getElementById("completion-purpose-other-field");
  const cancelBtn = document.getElementById("trip-completion-cancel");

  // Show/hide "other" purpose field
  if (purposeSelect) {
    purposeSelect.addEventListener("change", (e) => {
      if (purposeOtherField) {
        purposeOtherField.style.display = e.target.value === "other" ? "block" : "none";
      }
    });
  }

  // Cancel button
  if (cancelBtn) {
    cancelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const modal = document.getElementById("trip-completion-modal");
      if (modal) modal.remove();
    });
  }

  // Form submission
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handleTripCompletion(tripData, form);
    });
  }
}

/**
 * Populate vehicle select dropdown
 */
async function populateVehicleSelect(selectId, selectedVehicleId = null) {
  const select = document.getElementById(selectId);
  if (!select) return;

  try {
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, number_plate, make, model")
      .order("number_plate");

    if (vehicles && vehicles.length > 0) {
      vehicles.forEach((vehicle) => {
        const option = document.createElement("option");
        option.value = vehicle.id;
        option.textContent = `${vehicle.number_plate} · ${vehicle.make} ${vehicle.model}`;
        if (selectedVehicleId === vehicle.id) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    }
  } catch (err) {
    error("Failed to populate vehicle select:", err);
  }
}

/**
 * Handle trip completion form submission
 */
async function handleTripCompletion(tripData, form) {
  try {
    const vehicleId = form.querySelector("#completion-vehicle").value;
    const tripType = form.querySelector("#completion-trip-type").value;
    const purpose = form.querySelector("#completion-purpose").value;
    const purposeOther = form.querySelector("#completion-purpose-other").value;
    const notes = form.querySelector("#completion-notes").value;

    if (!vehicleId || !tripType || !purpose) {
      alert("Please fill in all required fields");
      return;
    }

    // Show saving state
    const submitBtn = form.querySelector("button[type='submit']");
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    // Build trip record
    const tripRecord = {
      vehicle_id: vehicleId,
      trip_type: tripType,
      purpose,
      purpose_other: purpose === "other" ? purposeOther : null,
      notes,
      trip_origin: "GPS Start",
      trip_destination: "GPS End",
      distance_offline: tripData.offlineDistance / 1000, // Convert to km
      distance_snapped: null, // Will be updated after sync
      duration_ms: tripData.durationMs,
      point_count: tripData.pointCount,
      raw_coordinates: tripData.rawCoordinates,
      status: "pending-sync",
      created_at: new Date().toISOString(),
    };

    // Save to database
    const { data, error: dbError } = await supabase
      .from("trips")
      .insert([tripRecord])
      .select();

    if (dbError) {
      throw dbError;
    }

    log("Trip saved to database", data);

    // Update pending trip data with DB ID
    if (data && data[0]) {
      const savedTrip = data[0];
      tripData.tripRecordId = savedTrip.id;
      tripData.tripRecord = savedTrip;
      await setLocalStore("pendingTripData", tripData);
    }

    // Show success message
    const modal = document.getElementById("trip-completion-modal");
    if (modal) {
      modal.innerHTML = `
        <div style="
          background: white;
          border-radius: 12px;
          padding: 24px;
          max-width: 500px;
          width: 100%;
          text-align: center;
        ">
          <h2 style="margin: 0 0 16px 0; font-size: 24px;">✓ Trip saved</h2>
          <p style="color: #666; margin: 0 0 20px 0;">
            Your trip has been saved successfully. 
            <br/><br/>
            ${navigator.onLine ? "Distance is being synced with the road network..." : "It will sync to the road network when you're online."}
          </p>
          <button onclick="document.getElementById('trip-completion-modal').remove()" class="btn btn-primary" style="
            padding: 10px 24px;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
          ">
            Done
          </button>
        </div>
      `;
    }

    // Clear pending trip data
    pendingTripData = null;
    await setLocalStore("pendingTripData", null);

    // Reset form
    form.reset();
  } catch (err) {
    error("Error saving trip:", err);
    const errorDiv = form.querySelector("#trip-completion-error");
    if (errorDiv) {
      errorDiv.style.display = "block";
      errorDiv.textContent = `Error: ${err.message}`;
    }
    const submitBtn = form.querySelector("button[type='submit']");
    submitBtn.disabled = false;
    submitBtn.textContent = "Save trip";
  }
}

/**
 * Show native notification with "End trip" action
 */
function showEndTripNotification(tripData) {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const notification = new Notification("LogMate Trip Complete", {
        body: `Trip complete: ${formatDistance(tripData.offlineDistance)}`,
        icon: "/assets/logo.svg",
        badge: "/assets/logo.svg",
        tag: "trip-complete",
        requireInteraction: true,
        actions: [
          { action: "complete", title: "Complete trip details" },
          { action: "dismiss", title: "Dismiss" },
        ],
      });

      notification.addEventListener("click", () => {
        window.focus();
        showTripCompletionModal(tripData);
        notification.close();
      });

      notification.addEventListener("action", (event) => {
        if (event.action === "complete") {
          window.focus();
          showTripCompletionModal(tripData);
        }
        notification.close();
      });
    } catch (err) {
      warn("Failed to show notification:", err);
    }
  }
}

/**
 * Format duration in milliseconds to readable string
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

export default {
  initializeTripUI,
};
