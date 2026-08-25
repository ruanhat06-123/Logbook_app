import "./app.js";
import { notifyServiceDue, requestServiceNotifications, serviceReminderKey, serviceReminderMarkup } from "./serviceReminder.js";

const user = await requireAuth();
if (user) {
  const { data } = await supabase.from("vehicles").select("*").order("number_plate");
  const vehicleList = data || [];
  await shell(
    "logbook",
    `<header class="topbar"><div><div class="eyebrow">Logbook / new fill-up</div><h1>Record a fill-up.</h1></div><div class="top-date"><strong>FUEL ENTRY</strong>Keep it moving</div></header>${vehicleList.map(serviceReminderMarkup).join("")}<div class="card" style="max-width:760px"><div class="notice">Enter the details of your fuel stop.</div><form id="log-form" class="form-grid"><div class="field full"><label for="vehicle">Vehicle</label><select id="vehicle" required>${vehicleList.map((item) => `<option value="${item.id}">${item.number_plate} · ${item.make || "Not specified"} ${item.model || ""}</option>`).join("")}</select></div><div class="field"><label for="previous">Mileage at last fill (km)</label><input id="previous" type="number" step="1"></div><div class="field"><label for="current">Current mileage (km)</label><input id="current" type="number" step="1" required></div><div class="field"><label for="liters">Fuel amount (litres)</label><input id="liters" type="number" step="0.1" required></div><div class="field"><label for="price">Price per litre (ZAR)</label><input id="price" type="number" step="0.01" required></div><div class="field"><label for="fuel-type">Fuel type</label><select id="fuel-type"><option>Petrol 93</option><option>Petrol 95</option><option>Diesel PPM500</option><option>Diesel PPM50</option><option>Diesel PPM10</option></select></div><div class="field"><label for="location">Fuel location</label><input id="location"></div><div class="field"><label for="date">Date</label><input id="date" type="date" required></div><div class="form-actions field full"><a href="vehicles.html" class="btn btn-secondary">Cancel</a><button class="btn btn-primary" type="submit">Save fill-up →</button></div></form><div id="success" class="notice" hidden></div></div>`,
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
  document.querySelector("#log-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const liters = Number(document.querySelector("#liters").value);
    const price = Number(document.querySelector("#price").value);
    const currentMileage = Number(document.querySelector("#current").value);
    const vehicleId = vehicleSelect.value;
    const { error } = await supabase.from("car_logbook").insert({ vehicle_id: vehicleId, entry_type: "refuel", mileage_last_fill: Number(document.querySelector("#previous").value || 0), current_mileage: currentMileage, fuel_type: document.querySelector("#fuel-type").value, fuel_price: price, fuel_amount_liters: liters, fuel_location: document.querySelector("#location").value.trim() || "Not specified", total_cost: liters * price, created_at: `${document.querySelector("#date").value}T12:00:00` });
    if (error) return window.alert(error.message);
    const { error: vehicleError } = await supabase.from("vehicles").update({ current_mileage: currentMileage }).eq("id", vehicleId);
    if (vehicleError) return window.alert(vehicleError.message);
    document.querySelector("#success").hidden = false;
    document.querySelector("#success").textContent = "Fill-up saved to your cloud logbook.";
    event.target.reset();
    document.querySelector("#date").value = new Date().toISOString().slice(0, 10);
    updateReminder();
  });
}
