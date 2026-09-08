// fleet.js
import "../core/app.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

const subscriptionState = await getSubscriptionState(user.id);

if (!isFleetTier(subscriptionState)) {
  await shell(
    "fleet",
    `
    <header class="topbar">
      <div>
        <div class="eyebrow">Fleet management</div>
        <h1>Upgrade to unlock your fleet dashboard.</h1>
      </div>
      <div class="top-date"><strong>FLEET STARTER / FLEET PRO</strong>Multi-vehicle overview</div>
    </header>
    <section class="card">
      <div class="card-head"><h2>Fleet dashboards are a Fleet plan feature</h2></div>
      <p class="row-sub">Get a consolidated view across every vehicle — total distance, fuel spend, service compliance, and business/personal split — plus SARS PDF export for the whole fleet.</p>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
        <a class="btn btn-primary" href="settings.html#billing">View plans →</a>
      </div>
    </section>
  `,
  );
} else {
  const [currentVehicles, logRowsResp, tripRowsResp] = await Promise.all([
    vehicles(),
    supabase.from("car_logbook").select("*").order("created_at", { ascending: false }),
    supabase.from("trips").select("*").order("created_at", { ascending: false }),
  ]);

  const currentLogs = logRowsResp?.data || [];
  const currentTrips = tripRowsResp?.data || [];
  const fuelLogs = currentLogs.filter((item) => (item.entry_type || "refuel") === "refuel");

  const totalSpend = fuelLogs.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
  const totalLiters = fuelLogs.reduce((sum, item) => sum + Number(item.fuel_amount_liters || 0), 0);
  const totalTripDistance = currentTrips.reduce((sum, item) => sum + Number(item.trip_distance_km || 0), 0);
  const businessDistance = currentTrips
    .filter((item) => item.trip_type === "business")
    .reduce((sum, item) => sum + Number(item.trip_distance_km || 0), 0);
  const businessPct = totalTripDistance ? Math.round((businessDistance / totalTripDistance) * 100) : 0;
  const vehiclesDue = currentVehicles.filter((item) => {
    const next = Number(item.next_service_mileage);
    if (!Number.isFinite(next)) return false;
    return next - Number(item.current_mileage || 0) <= 1000;
  });

  const vehicleRows = currentVehicles.length
    ? currentVehicles
        .map((item) => {
          const vehicleFuel = fuelLogs.filter((log) => String(log.vehicle_id) === String(item.id));
          const vehicleTrips = currentTrips.filter((trip) => String(trip.vehicle_id) === String(item.id));
          const spend = vehicleFuel.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
          const distance = vehicleTrips.reduce((sum, trip) => sum + Number(trip.trip_distance_km || 0), 0);
          const next = Number(item.next_service_mileage);
          const remaining = Number.isFinite(next) ? next - Number(item.current_mileage || 0) : null;
          const serviceLabel =
            remaining === null
              ? "Service distance not entered"
              : remaining <= 0
                ? `Overdue by ${Math.abs(remaining).toLocaleString()} km`
                : `${remaining.toLocaleString()} km to next service`;

          return `<div class="vehicle-row" data-vehicle-id="${escapeHtml(item.id)}">
            <div class="car-icon">⌁</div>
            <div class="row-main">
              <div class="row-title">${escapeHtml(item.number_plate || "Vehicle")} · ${escapeHtml(item.make || "")} ${escapeHtml(item.model || "")}</div>
              <div class="row-sub">${vehicleTrips.length} trips · ${distance.toLocaleString()} km logged · ${money(spend)} fuel spend · ${escapeHtml(serviceLabel)}</div>
            </div>
            <div class="row-actions">
              <a class="btn btn-small" href="vehicles.html">Open →</a>
            </div>
          </div>`;
        })
        .join("")
    : '<div class="empty">No vehicles yet. Add a vehicle to start building your fleet.</div>';

  await shell(
    "fleet",
    `
    <header class="topbar">
      <div>
        <div class="eyebrow">Fleet management</div>
        <h1>Your fleet at a glance.</h1>
      </div>
      <div class="top-date"><strong>${escapeHtml(tierLabel(subscriptionState).toUpperCase())}</strong>${currentVehicles.length} vehicle${currentVehicles.length === 1 ? "" : "s"}</div>
    </header>
    <section class="grid stats-grid">
      <div class="card stat"><div class="stat-label">Fleet vehicles</div><div class="stat-value">${currentVehicles.length}</div><div class="stat-note"><a href="vehicles.html">Manage vehicles</a></div></div>
      <div class="card stat"><div class="stat-label">Total distance</div><div class="stat-value">${totalTripDistance.toLocaleString()} km</div><div class="stat-note">Across all logged trips</div></div>
      <div class="card stat"><div class="stat-label">Business use</div><div class="stat-value">${businessPct}%</div><div class="stat-note">Of total logged distance</div></div>
      <div class="card stat"><div class="stat-label">Fuel spend</div><div class="stat-value">${money(totalSpend)}</div><div class="stat-note">${totalLiters.toFixed(0)} L total</div></div>
    </section>
    ${
      vehiclesDue.length
        ? `<section class="card"><div class="card-head"><h2>Service due soon</h2></div><p class="row-sub">${vehiclesDue.length} vehicle${vehiclesDue.length === 1 ? "" : "s"} within 1,000 km of the next service. Review from <a href="vehicles.html">My vehicles</a>.</p></section>`
        : ""
    }
    <section class="card">
      <div class="card-head"><h2>Vehicles</h2><a class="text-link" href="trip-report.html">Fleet trip report</a></div>
      ${vehicleRows}
    </section>
  `,
  );
}
