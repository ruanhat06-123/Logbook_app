// trip.js
import "./app.js";
import { notifyServiceDue, requestServiceNotifications, serviceReminderMarkup } from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

if (user) {
  const { data: vehiclesData } = await supabase.from("vehicles").select("*").order("number_plate");
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

        <div class="field">
          <label for="destination">Destination</label>
          <input id="destination" type="text" maxlength="200" placeholder="Where the trip ended" required>
        </div>

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

  const updateReminderVisibility = () =>
    document.querySelectorAll("[data-service-reminder]").forEach((item) => {
      item.hidden = item.dataset.serviceReminder !== vehicleSelect.value;
    });

  dateInput.value = new Date().toISOString().slice(0, 10);

  async function populateStartOdometer(vehicleId) {
    startOdoInput.value = "";
    if (!vehicleId) return;

    const selectedOption = vehicleSelect.querySelector(`option[value="${vehicleId}"]`);
    if (selectedOption) {
      const dataVal = selectedOption.dataset.currentMileage;
      if (dataVal !== undefined && dataVal !== "") {
        startOdoInput.value = Number(dataVal);
        console.debug("Start odometer populated from option data-current-mileage:", dataVal);
        return;
      }
    }

    try {
      const { data: lastLog, error: logErr } = await supabase
        .from("car_logbook")
        .select("current_mileage, created_at")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!logErr && lastLog && Number.isFinite(Number(lastLog.current_mileage))) {
        startOdoInput.value = Number(lastLog.current_mileage);
        console.debug("Start odometer populated from car_logbook:", lastLog.current_mileage);
        return;
      }

      const { data: vehicleRow, error: vehicleErr } = await supabase
        .from("vehicles")
        .select("current_mileage")
        .eq("id", vehicleId)
        .single();

      if (!vehicleErr && vehicleRow && Number.isFinite(Number(vehicleRow.current_mileage))) {
        startOdoInput.value = Number(vehicleRow.current_mileage);
        console.debug("Start odometer populated from vehicles.current_mileage:", vehicleRow.current_mileage);
        return;
      }

      console.debug("No odometer value found for vehicle:", vehicleId);
    } catch (err) {
      console.error("Error populating start odometer:", err);
    }
  }

  vehicleSelect.addEventListener("change", async () => {
    updateReminderVisibility();
    await populateStartOdometer(vehicleSelect.value);
  });

  updateReminderVisibility();
  if (vehicleSelect.value) await populateStartOdometer(vehicleSelect.value);

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

    if (!vehicleId) return window.alert("Please select a vehicle.");
    if (!origin) return window.alert("Please enter an origin.");
    if (!destination) return window.alert("Please enter a destination.");
    if (!purpose) return window.alert("Please select a purpose.");
    if (!Number.isFinite(startOdo)) return window.alert("Please enter a valid start odometer.");
    if (!Number.isFinite(endOdo)) return window.alert("Please enter a valid end odometer.");
    if (endOdo < startOdo) return window.alert("End odometer must be greater than or equal to start odometer.");

    const tripDistance = endOdo - startOdo;

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
          trip_purpose: purpose,
        })
        .select()
        .single();

      if (insertErr) {
        console.error("Insert trip error:", insertErr);
        return window.alert(insertErr.message || "Failed to save trip. Check console for details.");
      }

      const { data: updatedVehicle, error: updateErr } = await supabase
        .from("vehicles")
        .update({ current_mileage: endOdo })
        .eq("id", vehicleId)
        .eq("user_id", user.id)
        .select()
        .single();

      if (updateErr) {
        console.error("Update vehicle mileage error (trip):", updateErr);
        window.alert("Trip saved but failed to update vehicle mileage. Check console for details.");
      } else {
        const successEl = document.querySelector("#success");
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
