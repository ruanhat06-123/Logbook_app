import "./app.js";
import { notifyServiceDue, requestServiceNotifications, serviceReminderKey, serviceReminderMarkup } from "./serviceReminder.js";

const user = await requireAuth();
if (user) {
  const [{ data: vehicleRows }, { data: logRows }] = await Promise.all([
    supabase.from("vehicles").select("*").order("created_at", { ascending: false }),
    supabase.from("car_logbook").select("*").order("created_at", { ascending: false }),
  ]);
  const currentVehicles = vehicleRows || [];
  const currentLogs = logRows || [];
  const fuelLogs = currentLogs.filter((item) => (item.entry_type || "refuel") === "refuel");
  const total = fuelLogs.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
  const liters = fuelLogs.reduce((sum, item) => sum + Number(item.fuel_amount_liters || 0), 0);
  const distance = fuelLogs.reduce((sum, item) => sum + Math.max(0, Number(item.current_mileage || 0) - Number(item.mileage_last_fill || item.current_mileage || 0)), 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const vehicleMarkup = currentVehicles.length ? currentVehicles.map((item) => {
    const nextService = Number(item.next_service_mileage);
    const remaining = Number.isFinite(nextService) ? nextService - Number(item.current_mileage || 0) : null;
    const distanceLabel = remaining === null ? "Service distance not entered" : remaining <= 0 ? `Service overdue by ${Math.abs(remaining).toLocaleString()} km` : `${remaining.toLocaleString()} km to next service`;
    return `<div class="vehicle-row"><div class="car-icon">⌁</div><div class="row-main"><div class="row-title">${item.make || "Vehicle make not specified"} ${item.model || ""}</div><div class="row-sub">${item.number_plate || "Number plate not specified"} · Last service: ${item.last_service_mileage ? `${Number(item.last_service_mileage).toLocaleString()} km` : "Not entered"} · Next: ${item.next_service_mileage ? `${nextService.toLocaleString()} km` : "Not entered"} · ${distanceLabel}</div></div><div class="row-actions"><span class="status">ACTIVE</span><button class="icon-button" type="button" data-edit-vehicle="${item.id}" aria-label="Edit ${item.number_plate}" title="Edit vehicle">✎</button><button class="icon-button" type="button" data-delete-vehicle="${item.id}" aria-label="Remove ${item.number_plate}" title="Remove vehicle">×</button></div></div>`;
  }).join("") : '<div class="empty">No vehicles yet. Add a vehicle to begin.</div>';
  const activityMarkup = currentLogs.slice(0, 3).map((item) => `<div class="log-row"><div class="car-icon">${item.entry_type === "trip" ? "↗" : "＋"}</div><div class="row-main"><div class="row-title">${currentVehicles.find((entry) => entry.id === item.vehicle_id)?.number_plate || "Vehicle not specified"}</div><div class="row-sub">${item.entry_type === "trip" ? `${item.trip_type || "Trip"} · ${dateText(item.created_at)}` : `${dateText(item.created_at)} · ${item.fuel_location || "Location not specified"}`}</div></div><div class="row-value">${item.entry_type === "trip" ? `${Number(item.trip_distance_km || 0).toLocaleString()} km` : money(item.total_cost)}</div></div>`).join("") || '<div class="empty">No entries recorded yet. Add an entry to begin.</div>';
  const formMarkup = `<form id="vehicle-form" class="form-grid"><div class="field"><label for="plate">Number plate</label><input name="plate" id="plate" required></div><div class="field"><label for="make">Make</label><input name="make" id="make" required></div><div class="field"><label for="model">Model</label><input name="model" id="model" required></div><div class="field"><label for="year">Year</label><input name="year" id="year" type="number" min="1886" max="2200"></div><div class="field"><label for="last-service">Last service mileage (km)</label><input name="last-service" id="last-service" type="number" min="0"></div><div class="field"><label for="next-service">Next service mileage (km)</label><input name="next-service" id="next-service" type="number" min="0"></div><div class="field"><label for="mileage">Current mileage (km)</label><input name="mileage" id="mileage" type="number" min="0" required></div><div class="form-actions field full"><button class="btn btn-primary" type="submit">Add vehicle →</button></div></form>`;
  await shell("home", `<header class="topbar"><div><div class="eyebrow">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div><h1>${greeting}.</h1></div><div class="top-date"><strong>PERSONAL LOGBOOK</strong>Service mileage included</div></header>${currentVehicles.map(serviceReminderMarkup).join("")}<section class="grid stats-grid"><div class="card stat"><div class="stat-label">Active vehicles</div><div class="stat-value">${currentVehicles.length}</div><div class="stat-note">Across your account</div></div><div class="card stat"><div class="stat-label">Fuel logged</div><div class="stat-value">${liters.toFixed(1)} L</div><div class="stat-note">Across all vehicles</div></div><div class="card stat"><div class="stat-label">Distance logged</div><div class="stat-value">${distance.toLocaleString()} km</div><div class="stat-note">From recorded fill-ups</div></div><div class="card stat"><div class="stat-label">Total spend</div><div class="stat-value">${money(total).replace("ZAR ", "")}</div><div class="stat-note">All recorded time</div></div></section><section class="grid two-col"><div class="card" id="vehicles"><div class="card-head"><h2>Your vehicles</h2><span><a class="text-link" href="logbook.html">＋ Fill-up</a> <a class="text-link" href="trip.html">↗ Trip</a></span></div>${vehicleMarkup}</div><div class="card"><div class="card-head"><h2>Recent activity</h2><a class="text-link" href="report.html">Fuel report</a></div>${activityMarkup}</div></section><section class="card" style="margin-top:20px"><div class="card-head"><div><div class="eyebrow">Fleet manager</div><h2>Add another vehicle</h2></div></div>${formMarkup}</section>`);
  await requestServiceNotifications();
  currentVehicles.forEach(notifyServiceDue);
  document.querySelectorAll("[data-confirm-service]").forEach((button) => button.addEventListener("click", async () => {
    const item = currentVehicles.find((entry) => entry.id === button.dataset.confirmService);
    const { error } = await supabase.from("vehicles").update({ service_reminder_confirmed_for: serviceReminderKey(item) }).eq("id", item.id);
    if (error) return window.alert(error.message);
    window.location.reload();
  }));
  document.querySelectorAll("[data-delete-vehicle]").forEach((button) => button.addEventListener("click", async () => {
    const item = currentVehicles.find((entry) => entry.id === button.dataset.deleteVehicle);
    if (!item || !window.confirm(`Remove ${item.number_plate}? Its logs will also be removed.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", item.id);
    if (error) return window.alert(error.message);
    window.location.reload();
  }));
  document.querySelectorAll("[data-edit-vehicle]").forEach((button) => button.addEventListener("click", () => {
    const item = currentVehicles.find((entry) => entry.id === button.dataset.editVehicle);
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-vehicle-title"><div class="modal-head"><h2 id="edit-vehicle-title">Edit vehicle</h2><button class="modal-close" type="button" aria-label="Close">×</button></div><form id="edit-vehicle-form" class="form-grid"><div class="field"><label for="edit-plate">Number plate</label><input id="edit-plate" value="${item.number_plate || ""}" required></div><div class="field"><label for="edit-make">Make</label><input id="edit-make" value="${item.make || ""}" required></div><div class="field"><label for="edit-model">Model</label><input id="edit-model" value="${item.model || ""}" required></div><div class="field"><label for="edit-year">Year</label><input id="edit-year" type="number" min="1886" max="2200" value="${item.year || ""}"></div><div class="field"><label for="edit-mileage">Current mileage (km)</label><input id="edit-mileage" type="number" min="0" step="1" value="${item.current_mileage || 0}" required></div><div class="field"><label for="edit-last-service">Last service mileage (km)</label><input id="edit-last-service" type="number" min="0" step="1" value="${item.last_service_mileage || ""}"></div><div class="field"><label for="edit-next-service">Next service mileage (km)</label><input id="edit-next-service" type="number" min="0" step="1" value="${item.next_service_mileage || ""}"></div><div class="form-actions field full"><button class="btn btn-secondary modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save changes →</button></div></form></div>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector(".modal-close").addEventListener("click", close);
    backdrop.querySelector(".modal-cancel").addEventListener("click", close);
    backdrop.querySelector("#edit-vehicle-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const { error } = await supabase.from("vehicles").update({ number_plate: backdrop.querySelector("#edit-plate").value.trim().toUpperCase(), make: backdrop.querySelector("#edit-make").value.trim(), model: backdrop.querySelector("#edit-model").value.trim(), year: backdrop.querySelector("#edit-year").value || null, current_mileage: Number(backdrop.querySelector("#edit-mileage").value), last_service_mileage: Number(backdrop.querySelector("#edit-last-service").value) || null, next_service_mileage: Number(backdrop.querySelector("#edit-next-service").value) || null, service_reminder_confirmed_for: null }).eq("id", item.id);
      if (error) return window.alert(error.message);
      window.location.reload();
    });
  }));
  document.querySelector("#vehicle-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const { error } = await supabase.from("vehicles").insert({ user_id: user.id, number_plate: form.plate.value.trim().toUpperCase(), make: form.make.value.trim(), model: form.model.value.trim(), year: form.year.value || null, last_service_mileage: Number(form["last-service"].value) || null, next_service_mileage: Number(form["next-service"].value) || null, current_mileage: Number(form.mileage.value) });
    if (error) return window.alert(error.message);
    window.location.reload();
  });
}
