import "./app.js";
import { notifyServiceDue, requestServiceNotifications, serviceReminderKey, serviceReminderMarkup } from "./serviceReminder.js";

const user = await requireAuth();
if (user) {
  const { data } = await supabase.from("vehicles").select("*").order("number_plate");
  const vehicleList = data || [];
  await shell(
    "trip",
    `<header class="topbar"><div><div class="eyebrow">Logbook / new trip</div><h1>Record a trip.</h1></div><div class="top-date"><strong>TRIP ENTRY</strong>Odometer-led</div></header>${vehicleList.map(serviceReminderMarkup).join("")}<div class="card" style="max-width:760px"><div class="notice">Trip distance is calculated from the start and end odometer readings.</div><form id="trip-form" class="form-grid"><div class="field full"><label for="vehicle">Vehicle</label><select id="vehicle" required>${vehicleList.map((item) => `<option value="${item.id}">${item.number_plate} · ${item.make || "Not specified"} ${item.model || ""}</option>`).join("")}</select></div><div class="field"><label for="trip-type">Trip type</label><select id="trip-type" required><option value="personal">Personal</option><option value="business">Business</option></select></div><div class="field"><label for="date">Date</label><input id="date" type="date" required></div><div class="field"><label for="start-odo">Start odometer (km)</label><input id="start-odo" type="number" min="0" step="1" required></div><div class="field"><label for="end-odo">End odometer (km)</label><input id="end-odo" type="number" min="0" step="1" required></div><div class="form-actions field full"><a href="vehicles.html" class="btn btn-secondary">Cancel</a><button class="btn btn-primary" type="submit">Save trip →</button></div></form><div id="success" class="notice" hidden></div></div>`,
  );
  await requestServiceNotifications();
  vehicleList.forEach(notifyServiceDue);
  const vehicleSelect = document.querySelector("#vehicle");
  const updateReminder = () => document.querySelectorAll("[data-service-reminder]").forEach((item) => { item.hidden = item.dataset.serviceReminder !== vehicleSelect.value; });
  document.querySelector("#date").value = new Date().toISOString().slice(0, 10);
  vehicleSelect.addEventListener("change", updateReminder);
  updateReminder();
  document.querySelectorAll("[data-confirm-service]").forEach((button) => button.addEventListener("click", async () => {
    const item = vehicleList.find((entry) => entry.id === button.dataset.confirmService);
    const { error } = await supabase.from("vehicles").update({ service_reminder_confirmed_for: serviceReminderKey(item) }).eq("id", item.id);
    if (error) return window.alert(error.message);
    window.location.reload();
  }));
  document.querySelector("#trip-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const startOdo = Number(document.querySelector("#start-odo").value);
    const endOdo = Number(document.querySelector("#end-odo").value);
    if (endOdo < startOdo) return window.alert("End odometer must be greater than or equal to start odometer.");
    const vehicleId = vehicleSelect.value;
    const { error } = await supabase.from("car_logbook").insert({ vehicle_id: vehicleId, entry_type: "trip", trip_type: document.querySelector("#trip-type").value, trip_distance_km: endOdo - startOdo, current_mileage: endOdo, mileage_start: startOdo, mileage_end: endOdo, created_at: `${document.querySelector("#date").value}T12:00:00` });
    if (error) return window.alert(error.message);
    const { error: vehicleError } = await supabase.from("vehicles").update({ current_mileage: endOdo }).eq("id", vehicleId);
    if (vehicleError) return window.alert(vehicleError.message);
    document.querySelector("#success").hidden = false;
    document.querySelector("#success").textContent = "Trip saved to your cloud logbook.";
    event.target.reset();
    document.querySelector("#date").value = new Date().toISOString().slice(0, 10);
  });
}
