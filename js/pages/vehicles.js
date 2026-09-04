// vehicles.js
import "../core/app.js";
import { notifyServiceDue, requestServiceNotifications, serviceReminderMarkup } from "../core/serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

if (user) {
  // Use the shared vehicles() helper which now attaches latest_logbook_mileage
  const [vehicleRowsResp, logRowsResp, tripRowsResp] = await Promise.all([
    vehicles(), // returns vehicles with latest_logbook_mileage
    supabase.from("car_logbook").select("*").order("created_at", { ascending: false }),
    supabase.from("trips").select("*").order("created_at", { ascending: false }),
  ]);

  const currentVehicles = vehicleRowsResp || [];
  const currentLogs = (logRowsResp && logRowsResp.data) ? logRowsResp.data : [];
  const currentTrips = (tripRowsResp && tripRowsResp.data) ? tripRowsResp.data : [];

  // Only consider refuel entries for fuel stats
  const fuelLogs = currentLogs.filter((item) => (item.entry_type || "refuel") === "refuel");
  const total = fuelLogs.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
  const liters = fuelLogs.reduce((sum, item) => sum + Number(item.fuel_amount_liters || 0), 0);
  const distance = fuelLogs.reduce((sum, item) => sum + Math.max(0, Number(item.current_mileage || 0) - Number(item.mileage_last_fill || item.current_mileage || 0)), 0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Vehicle list markup — include latest_logbook_mileage in option dataset so other pages can prefill
  const vehicleMarkup = currentVehicles.length
    ? currentVehicles.map((item) => {
        const nextService = Number(item.next_service_mileage);
        const remaining = Number.isFinite(nextService) ? nextService - Number(item.current_mileage || 0) : null;
        const distanceLabel = remaining === null
          ? "Service distance not entered"
          : remaining <= 0
            ? `Service overdue by ${Math.abs(remaining).toLocaleString()} km`
            : `${remaining.toLocaleString()} km to next service`;

        const latestLogbookMileage = Number.isFinite(Number(item.latest_logbook_mileage)) ? Number(item.latest_logbook_mileage) : "";

        // Two action buttons: Fill-up and Log trip
        return `<div class="vehicle-row" data-vehicle-id="${escapeHtml(item.id)}">
          <div class="car-icon">⌁</div>
          <div class="row-main">
            <div class="row-title">${escapeHtml(item.make || "Vehicle make not specified")} ${escapeHtml(item.model || "")}</div>
            <div class="row-sub">${escapeHtml(item.number_plate || "Number plate not specified")} · Last service: ${item.last_service_mileage ? `${Number(item.last_service_mileage).toLocaleString()} km` : "Not entered"} · Next: ${item.next_service_mileage ? `${nextService.toLocaleString()} km` : "Not entered"} · ${escapeHtml(distanceLabel)}</div>
            <div class="row-sub">Latest logbook mileage: ${latestLogbookMileage === "" ? "—" : `${latestLogbookMileage.toLocaleString()} km`}</div>
          </div>
          <div class="row-actions">
            <button class="btn btn-small" type="button" data-fillup="${escapeHtml(item.id)}" title="Record fill-up for ${escapeHtml(item.number_plate || "")}">＋ Fill-up</button>
            <button class="btn btn-small" type="button" data-log-trip="${escapeHtml(item.id)}" title="Log trip for ${escapeHtml(item.number_plate || "")}">↗ Trip</button>
            <button class="icon-button" type="button" data-edit-vehicle="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.number_plate || "")}" title="Edit vehicle">✎</button>
            <button class="icon-button" type="button" data-delete-vehicle="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.number_plate || "")}" title="Remove vehicle">×</button>
          </div>
        </div>`;
      }).join("")
    : '<div class="empty">No vehicles yet. Add a vehicle to begin.</div>';

  // Recent fuel activity (separate)
  const recentFuel = fuelLogs
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  const fuelActivityMarkup = recentFuel.length
    ? recentFuel.map((item) => {
        const vehicle = currentVehicles.find((v) => String(v.id) === String(item.vehicle_id));
        return `<div class="log-row">
          <div class="car-icon">＋</div>
          <div class="row-main">
            <div class="row-title">${escapeHtml(vehicle?.number_plate || "Vehicle not specified")}</div>
            <div class="row-sub">${dateText(item.created_at)} · ${escapeHtml(item.fuel_location || "Location not specified")}</div>
          </div>
          <div class="row-value">${money(item.total_cost)} · ${Number(item.fuel_amount_liters || 0).toFixed(3)} L</div>
        </div>`;
      }).join("")
    : '<div class="empty">No recent fuel activity.</div>';

  // Recent trips (separate)
  const recentTrips = currentTrips
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  const tripActivityMarkup = recentTrips.length
    ? recentTrips.map((item) => {
        const vehicle = currentVehicles.find((v) => String(v.id) === String(item.vehicle_id));
        return `<div class="log-row">
          <div class="car-icon">↗</div>
          <div class="row-main">
            <div class="row-title">${escapeHtml(vehicle?.number_plate || "Vehicle not specified")}</div>
            <div class="row-sub">${escapeHtml(item.trip_type || "Trip")} · ${dateText(item.created_at)}</div>
          </div>
          <div class="row-value">${Number(item.trip_distance_km || 0).toLocaleString()} km</div>
        </div>`;
      }).join("")
    : '<div class="empty">No recent trips.</div>';

  await shell("home", `
    <header class="topbar">
      <div>
        <div class="eyebrow">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div>
        <h1>${escapeHtml(greeting)}.</h1>
      </div>
      <div class="top-date"><strong>PERSONAL LOGBOOK</strong>Service mileage included</div>
    </header>
    ${currentVehicles.map(serviceReminderMarkup).join("")}
    <section class="grid stats-grid">
      <div class="card stat"><div class="stat-label">Active vehicles</div><div class="stat-value">${currentVehicles.length}</div><div class="stat-note">Across your account</div></div>
      <div class="card stat"><div class="stat-label">Fuel logged</div><div class="stat-value">${liters.toFixed(1)} L</div><div class="stat-note">Across all vehicles</div></div>
      <div class="card stat"><div class="stat-label">Distance logged</div><div class="stat-value">${distance.toLocaleString()} km</div><div class="stat-note">From recorded fill-ups</div></div>
      <div class="card stat"><div class="stat-label">Total spend</div><div class="stat-value">${money(total)}</div><div class="stat-note">All recorded time</div></div>
    </section>

    <section class="grid two-col">
      <div class="card" id="vehicles">
        <div class="card-head"><h2>Your vehicles</h2><span><a class="text-link" href="logbook.html">＋ Fill-up</a> <a class="text-link" href="trip.html">↗ Trip</a></span></div>
        ${vehicleMarkup}
      </div>

      <div class="card">
        <div class="card-head"><h2>Recent fuel activity</h2><a class="text-link" href="report.html">Fuel report</a></div>
        ${fuelActivityMarkup}
      </div>
    </section>

    <section class="grid two-col" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>Recent trips</h2><a class="text-link" href="trip.html">All trips</a></div>
        ${tripActivityMarkup}
      </div>

      <div class="card">
        <div class="card-head"><h2>Vehicle management</h2></div>
        <p class="row-sub">Keep your vehicle details and service intervals up to date.</p>
        <button class="btn btn-primary" id="add-vehicle-btn" type="button">Add vehicle →</button>
      </div>
    </section>
  `);

  await requestServiceNotifications();
  currentVehicles.forEach(notifyServiceDue);

  document.querySelector("#add-vehicle-btn").addEventListener("click", () => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-vehicle-title"><div class="modal-head"><h2 id="add-vehicle-title">Add vehicle</h2><button class="modal-close" type="button" aria-label="Close">×</button></div><form id="add-vehicle-form" class="form-grid"><div class="field"><label for="add-plate">Number plate</label><input id="add-plate" required></div><div class="field"><label for="add-make">Make</label><input id="add-make" required></div><div class="field"><label for="add-model">Model</label><input id="add-model" required></div><div class="field"><label for="add-year">Year</label><input id="add-year" type="number" min="1886" max="2200"></div><div class="field"><label for="add-last-service">Last service mileage (km)</label><input id="add-last-service" type="number" min="0"></div><div class="field"><label for="add-next-service">Next service mileage (km)</label><input id="add-next-service" type="number" min="0"></div><div class="field"><label for="add-mileage">Current mileage (km)</label><input id="add-mileage" type="number" min="0" required></div><div class="form-actions field full"><button class="btn btn-secondary modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Add vehicle →</button></div></form></div>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector(".modal-close").addEventListener("click", close);
    backdrop.querySelector(".modal-cancel").addEventListener("click", close);
    backdrop.querySelector("#add-vehicle-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const { error } = await supabase.from("vehicles").insert({
        user_id: user.id,
        number_plate: backdrop.querySelector("#add-plate").value.trim().toUpperCase(),
        make: backdrop.querySelector("#add-make").value.trim(),
        model: backdrop.querySelector("#add-model").value.trim(),
        year: backdrop.querySelector("#add-year").value || null,
        last_service_mileage: backdrop.querySelector("#add-last-service").value ? Number(backdrop.querySelector("#add-last-service").value) : null,
        current_mileage: Number(backdrop.querySelector("#add-mileage").value),
        next_service_mileage: backdrop.querySelector("#add-next-service").value ? Number(backdrop.querySelector("#add-next-service").value) : null,
      });
      if (error) return window.alert(error.message);
      window.location.reload();
    });
  });

  // Wire up the new Fill-up and Log trip buttons on each vehicle row
  document.querySelectorAll("[data-fillup]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const vehicleId = btn.getAttribute("data-fillup");
      // Navigate to logbook page with vehicle preselected via query param
      window.location.href = `logbook.html?vehicle=${encodeURIComponent(vehicleId)}`;
    });
  });

  document.querySelectorAll("[data-log-trip]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const vehicleId = btn.getAttribute("data-log-trip");
      // Navigate to trip page with vehicle preselected via query param
      window.location.href = `trip.html?vehicle=${encodeURIComponent(vehicleId)}`;
    });
  });

  // Delete vehicle
  document.querySelectorAll("[data-delete-vehicle]").forEach((button) =>
    button.addEventListener("click", async () => {
      const item = currentVehicles.find((entry) => String(entry.id) === String(button.dataset.deleteVehicle));
      if (!item || !window.confirm(`Remove ${item.number_plate}? Its logs will also be removed.`)) return;
      const { error } = await supabase.from("vehicles").delete().eq("id", item.id);
      if (error) return window.alert(error.message);
      window.location.reload();
    })
  );

  // Edit vehicle modal — do not write any "confirmed" flag to DB
  document.querySelectorAll("[data-edit-vehicle]").forEach((button) =>
    button.addEventListener("click", () => {
      const item = currentVehicles.find((entry) => String(entry.id) === String(button.dataset.editVehicle));
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-vehicle-title"><div class="modal-head"><h2 id="edit-vehicle-title">Edit vehicle</h2><button class="modal-close" type="button" aria-label="Close">×</button></div><form id="edit-vehicle-form" class="form-grid"><div class="field"><label for="edit-plate">Number plate</label><input id="edit-plate" value="${escapeHtml(item.number_plate || "")}" required></div><div class="field"><label for="edit-make">Make</label><input id="edit-make" value="${escapeHtml(item.make || "")}" required></div><div class="field"><label for="edit-model">Model</label><input id="edit-model" value="${escapeHtml(item.model || "")}" required></div><div class="field"><label for="edit-year">Year</label><input id="edit-year" type="number" min="1886" max="2200" value="${escapeHtml(item.year || "")}"></div><div class="field"><label for="edit-mileage">Current mileage (km)</label><input id="edit-mileage" type="number" min="0" step="1" value="${escapeHtml(item.current_mileage || 0)}" required></div><div class="field"><label for="edit-last-service">Last service mileage (km)</label><input id="edit-last-service" type="number" min="0" step="1" value="${escapeHtml(item.last_service_mileage || "")}"></div><div class="field"><label for="edit-next-service">Next service mileage (km)</label><input id="edit-next-service" type="number" min="0" step="1" value="${escapeHtml(item.next_service_mileage || "")}"></div><div class="form-actions field full"><button class="btn btn-secondary modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save changes →</button></div></form></div>`;
      document.body.append(backdrop);
      const close = () => backdrop.remove();
      backdrop.querySelector(".modal-close").addEventListener("click", close);
      backdrop.querySelector(".modal-cancel").addEventListener("click", close);
      backdrop.querySelector("#edit-vehicle-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const updated = {
          number_plate: backdrop.querySelector("#edit-plate").value.trim().toUpperCase(),
          make: backdrop.querySelector("#edit-make").value.trim(),
          model: backdrop.querySelector("#edit-model").value.trim(),
          year: backdrop.querySelector("#edit-year").value || null,
          current_mileage: Number(backdrop.querySelector("#edit-mileage").value),
          last_service_mileage: backdrop.querySelector("#edit-last-service").value ? Number(backdrop.querySelector("#edit-last-service").value) : null,
          next_service_mileage: backdrop.querySelector("#edit-next-service").value ? Number(backdrop.querySelector("#edit-next-service").value) : null,
        };
        const { error } = await supabase.from("vehicles").update(updated).eq("id", item.id);
        if (error) return window.alert(error.message);
        window.location.reload();
      });
    })
  );

}

// small helper used in template if not present globally
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}

// helper for money formatting used above — show Rand symbol R
function money(v) {
  return `R ${Number(v || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// helper for date formatting used above
function dateText(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(d);
  }
}
