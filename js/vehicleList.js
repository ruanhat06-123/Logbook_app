import "./app.js";
import {
  notifyServiceDue,
  requestServiceNotifications,
  serviceReminderMarkup,
} from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

const currentVehicles = (await vehicles()) || [];
const vehicleMarkup = currentVehicles.length
  ? currentVehicles.map((item) => {
      const nextService = Number(item.next_service_mileage);
      const remaining = Number.isFinite(nextService)
        ? nextService - Number(item.current_mileage || 0)
        : null;
      const distanceLabel = remaining === null
        ? "Service distance not entered"
        : remaining <= 0
          ? `Service overdue by ${Math.abs(remaining).toLocaleString()} km`
          : `${remaining.toLocaleString()} km to next service`;
      return `<article class="vehicle-row">
        <div class="vehicle-identity">
          <div class="car-icon">⌁</div>
          <div>
            <div class="row-title">${escapeHtml(item.make || "Vehicle make not specified")} ${escapeHtml(item.model || "")}</div>
            <div class="vehicle-plate">${escapeHtml(item.number_plate || "Number plate not specified")}</div>
          </div>
        </div>
        <div class="vehicle-details">
          <div class="vehicle-detail"><span>Current mileage</span><strong>${Number(item.current_mileage || 0).toLocaleString()} km</strong></div>
          <div class="vehicle-detail"><span>Last service</span><strong>${item.last_service_mileage ? `${Number(item.last_service_mileage).toLocaleString()} km` : "Not entered"}</strong></div>
          <div class="vehicle-detail"><span>Next service</span><strong>${item.next_service_mileage ? `${nextService.toLocaleString()} km` : "Not entered"}</strong><small class="${remaining !== null && remaining <= 0 ? "service-overdue" : ""}">${escapeHtml(distanceLabel)}</small></div>
        </div>
        <div class="row-actions vehicle-actions">
          <a class="btn btn-small" href="logbook.html?vehicle=${encodeURIComponent(item.id)}">＋ Fill-up</a>
          <a class="btn btn-small" href="trip.html?vehicle=${encodeURIComponent(item.id)}">↗ Trip</a>
          <button class="icon-button" type="button" data-edit-vehicle="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.number_plate || "")}" title="Edit vehicle">✎</button>
          <button class="icon-button" type="button" data-delete-vehicle="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.number_plate || "")}" title="Remove vehicle">×</button>
        </div>
      </article>`;
    }).join("")
  : '<div class="empty">No vehicles yet. Add a vehicle to begin.</div>';

await shell("vehicles", `
  <header class="topbar">
    <div><div class="eyebrow">Vehicle management</div><h1>Your vehicles.</h1></div>
    <div class="top-date"><strong>VEHICLE LIST</strong>${currentVehicles.length} active vehicle${currentVehicles.length === 1 ? "" : "s"}</div>
  </header>
  ${currentVehicles.map(serviceReminderMarkup).join("")}
  <section class="card" id="vehicles">
    <div class="card-head"><h2>Vehicles</h2><a class="btn btn-primary" href="add-vehicle.html">Add vehicle →</a></div>
    ${vehicleMarkup}
  </section>
`);

await requestServiceNotifications();
currentVehicles.forEach(notifyServiceDue);

document.querySelectorAll("[data-delete-vehicle]").forEach((button) =>
  button.addEventListener("click", async () => {
    const item = currentVehicles.find((entry) => String(entry.id) === String(button.dataset.deleteVehicle));
    if (!item || !window.confirm(`Remove ${item.number_plate}? Its logs will also be removed.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", item.id);
    if (error) return window.alert(error.message);
    window.location.reload();
  }),
);

document.querySelectorAll("[data-edit-vehicle]").forEach((button) =>
  button.addEventListener("click", () => {
    const item = currentVehicles.find((entry) => String(entry.id) === String(button.dataset.editVehicle));
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-vehicle-title"><div class="modal-head"><h2 id="edit-vehicle-title">Edit vehicle</h2><button class="modal-close" type="button" aria-label="Close">×</button></div><form id="edit-vehicle-form" class="form-grid"><div class="field"><label for="edit-plate">Number plate</label><input id="edit-plate" value="${escapeHtml(item.number_plate || "")}" required></div><div class="field"><label for="edit-make">Make</label><input id="edit-make" value="${escapeHtml(item.make || "")}" required></div><div class="field"><label for="edit-model">Model</label><input id="edit-model" value="${escapeHtml(item.model || "")}" required></div><div class="field"><label for="edit-year">Year</label><input id="edit-year" type="number" min="1886" max="2200" value="${escapeHtml(item.year || "")}"></div><div class="field"><label for="edit-mileage">Current mileage (km)</label><input id="edit-mileage" type="number" min="0" value="${escapeHtml(item.current_mileage || 0)}" required></div><div class="field"><label for="edit-last-service">Last service mileage (km)</label><input id="edit-last-service" type="number" min="0" value="${escapeHtml(item.last_service_mileage || "")}"></div><div class="field"><label for="edit-next-service">Next service mileage (km)</label><input id="edit-next-service" type="number" min="0" value="${escapeHtml(item.next_service_mileage || "")}"></div><div class="form-actions field full"><button class="btn btn-secondary modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save changes →</button></div></form></div>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector(".modal-close").addEventListener("click", close);
    backdrop.querySelector(".modal-cancel").addEventListener("click", close);
    backdrop.querySelector("#edit-vehicle-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const { error } = await supabase.from("vehicles").update({
        number_plate: backdrop.querySelector("#edit-plate").value.trim().toUpperCase(),
        make: backdrop.querySelector("#edit-make").value.trim(),
        model: backdrop.querySelector("#edit-model").value.trim(),
        year: backdrop.querySelector("#edit-year").value || null,
        current_mileage: Number(backdrop.querySelector("#edit-mileage").value),
        last_service_mileage: backdrop.querySelector("#edit-last-service").value ? Number(backdrop.querySelector("#edit-last-service").value) : null,
        next_service_mileage: backdrop.querySelector("#edit-next-service").value ? Number(backdrop.querySelector("#edit-next-service").value) : null,
      }).eq("id", item.id);
      if (error) return window.alert(error.message);
      window.location.reload();
    });
  }),
);
