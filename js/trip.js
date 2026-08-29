// trip.js
import "./app.js";
import { notifyServiceDue, requestServiceNotifications, serviceReminderMarkup } from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

if (user) {
  const [{ data: vehiclesData }] = await Promise.all([
    supabase.from("vehicles").select("*").order("number_plate"),
  ]);

  const vehicleList = vehiclesData || [];

  const vehicleOptionsHtml = vehicleList
    .map((item) => {
      const current = Number.isFinite(Number(item.current_mileage)) ? Number(item.current_mileage) : "";
      return `<option value="${item.id}" data-current-mileage="${current}">${escapeHtml(item.number_plate || "")} · ${escapeHtml(item.make || "Not specified")} ${escapeHtml(item.model || "")}</option>`;
    })
    .join("");

  await shell(
    "trip",
    `<header class="topbar"><div><div class="eyebrow">Logbook / new trip</div><h1>Record a trip.</h1></div><div class="top-date"><strong>TRIP ENTRY</strong>Odometer-led</div></header>
    ${vehicleList.map(serviceReminderMarkup).join("")}
    <div class="card" style="max-width:760px">
      <div class="notice">Trip distance is calculated from the start and end odometer readings.</div>
      <form id="trip-form" class="form-grid">
        <div class="field full">
          <label for="vehicle">Vehicle</label>
          <select id="vehicle" required>
            <option value="">Select a vehicle</option>
            ${vehicleOptionsHtml}
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
          <input id="start-odo" type="number" min="0" step="1" required placeholder="Auto-populated from vehicle">
        </div>

        <div class="field">
          <label for="end-odo">End odometer (km)</label>
          <input id="end-odo" type="number" min="0" step="1" required>
        </div>

        <div class="field">
          <label for="origin">Origin</label>
          <input id="origin" type="text" maxlength="200" placeholder="Where the trip started" required>
        </div>

        <div class="field" style="display:flex;gap:8px;align-items:flex-end;">
          <div style="flex:1">
            <label for="destination">Destination</label>
            <input id="destination" type="text" maxlength="200" placeholder="Where the trip ended" required>
          </div>
          <div style="width:140px">
            <label>&nbsp;</label>
            <button id="detect-destination" type="button" class="btn btn-secondary" style="width:100%">Detect</button>
          </div>
        </div>

        <div id="destination-status" class="notice" hidden></div>

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

        <!-- Visible only when purpose === "other" -->
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
    </div>`
  );

  await requestServiceNotifications();
  vehicleList.forEach(notifyServiceDue);

  const vehicleSelect = document.querySelector("#vehicle");
  const startOdoInput = document.querySelector("#start-odo");
  const endOdoInput = document.querySelector("#end-odo");
  const dateInput = document.querySelector("#date");
  const originInput = document.querySelector("#origin");
  const destinationInput = document.querySelector("#destination");
  const purposeSelect = document.querySelector("#purpose");
  const purposeOtherField = document.querySelector("#purpose-other-field");
  const purposeOtherInput = document.querySelector("#purpose-other");
  const successEl = document.querySelector("#success");
  const detectDestBtn = document.querySelector("#detect-destination");
  const destStatus = document.querySelector("#destination-status");

  dateInput.value = new Date().toISOString().slice(0, 10);

  async function populateStartOdometer(vehicleId) {
    startOdoInput.value = "";
    if (!vehicleId) return;

    const selectedOption = vehicleSelect.querySelector(`option[value="${vehicleId}"]`);
    if (selectedOption) {
      const dataVal = selectedOption.dataset.currentMileage;
      if (dataVal !== undefined && dataVal !== "") {
        startOdoInput.value = Number(dataVal);
        return;
      }
    }

    try {
      // Prefer last entry from car_logbook
      const { data: lastLog } = await supabase
        .from("car_logbook")
        .select("current_mileage, created_at")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (lastLog && Number.isFinite(Number(lastLog.current_mileage))) {
        startOdoInput.value = Number(lastLog.current_mileage);
        return;
      }

      // Fallback to vehicles table
      const { data: vehicleRow } = await supabase
        .from("vehicles")
        .select("current_mileage")
        .eq("id", vehicleId)
        .single();

      if (vehicleRow && Number.isFinite(Number(vehicleRow.current_mileage))) {
        startOdoInput.value = Number(vehicleRow.current_mileage);
        return;
      }
    } catch (err) {
      console.error("Error populating start odometer:", err);
    }
  }

  vehicleSelect.addEventListener("change", async () => {
    await populateStartOdometer(vehicleSelect.value);
  });

  if (vehicleSelect.value) await populateStartOdometer(vehicleSelect.value);

  // Show/hide "other" purpose input and manage required state
  function updatePurposeOtherVisibility() {
    const isOther = purposeSelect.value === "other";
    purposeOtherField.style.display = isOther ? "block" : "none";
    if (!isOther) purposeOtherInput.value = "";
  }

  purposeSelect.addEventListener("change", updatePurposeOtherVisibility);
  updatePurposeOtherVisibility();

  // Reverse geocode helper (same approach as logbook)
  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1`;
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) throw new Error("Reverse geocode failed");
      const data = await resp.json();
      if (data && data.display_name) return data.display_name;
      if (data && data.address) {
        const parts = [];
        if (data.address.road) parts.push(data.address.road);
        if (data.address.suburb) parts.push(data.address.suburb);
        if (data.address.city) parts.push(data.address.city);
        if (data.address.state) parts.push(data.address.state);
        if (data.address.country) parts.push(data.address.country);
        if (parts.length) return parts.join(", ");
      }
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    } catch (err) {
      console.warn("Reverse geocode error:", err);
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    }
  }

  function showDestStatus(message, isError = false) {
    if (!destStatus) return;
    destStatus.hidden = false;
    destStatus.textContent = message;
    destStatus.style.color = isError ? "#a00" : "#333";
    setTimeout(() => { if (destStatus) destStatus.hidden = true; }, 6000);
  }

  async function detectDestination() {
    if (!navigator.geolocation) {
      showDestStatus("Geolocation not supported by this browser", true);
      return;
    }
    detectDestBtn.disabled = true;
    showDestStatus("Detecting destination…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const address = await reverseGeocode(lat, lon);
        destinationInput.value = address;
        showDestStatus("Destination detected");
      } catch (err) {
        console.error("Destination detection error:", err);
        destinationInput.value = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
        showDestStatus("Destination detected (coordinates only)");
      } finally {
        detectDestBtn.disabled = false;
      }
    }, (err) => {
      console.warn("Geolocation error:", err);
      detectDestBtn.disabled = false;
      if (err.code === 1) {
        showDestStatus("Location permission denied", true);
      } else if (err.code === 2) {
        showDestStatus("Position unavailable", true);
      } else if (err.code === 3) {
        showDestStatus("Location request timed out", true);
      } else {
        showDestStatus("Failed to detect destination", true);
      }
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60 * 1000
    });
  }

  detectDestBtn?.addEventListener("click", detectDestination);

  document.querySelector("#trip-form").addEventListener("submit", async (event) => {
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
    if (purpose === "other" && !purposeOther) return window.alert("Please describe the purpose when 'Other' is selected.");
    if (!Number.isFinite(startOdo)) return window.alert("Please enter a valid start odometer.");
    if (!Number.isFinite(endOdo)) return window.alert("Please enter a valid end odometer.");
    if (endOdo < startOdo) return window.alert("End odometer must be greater than or equal to start odometer.");

    const tripDistance = endOdo - startOdo;
    const tripPurposeToStore = (purpose === "other") ? purposeOther : purpose;

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
          trip_purpose: tripPurposeToStore
        })
        .select()
        .single();

      if (insertErr) {
        console.error("Insert trip error:", insertErr);
        return window.alert(insertErr.message || "Failed to save trip. Check console for details.");
      }

      const { error: updateErr } = await supabase
        .from("vehicles")
        .update({ current_mileage: endOdo })
        .eq("id", vehicleId)
        .eq("user_id", user.id);

      if (updateErr) {
        console.error("Update vehicle mileage error (trip):", updateErr);
        window.alert("Trip saved but failed to update vehicle mileage. Check console for details.");
      } else {
        successEl.hidden = false;
        successEl.textContent = "Trip saved and vehicle odometer updated.";
        setTimeout(() => window.location.reload(), 700);
      }
    } catch (err) {
      console.error("Unexpected error saving trip:", err);
      window.alert("An unexpected error occurred. See console for details.");
    }
  });
}

// small helper used in template
function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}
