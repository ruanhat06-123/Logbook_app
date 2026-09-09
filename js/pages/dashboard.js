import "../core/app.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

const [vehicleRows, logRowsResp, tripRowsResp] = await Promise.all([
  vehicles(),
  supabase.from("car_logbook").select("*").order("created_at", { ascending: false }),
  supabase.from("trips").select("*").order("created_at", { ascending: false }),
]);

const loadWarnings = [logRowsResp.error, tripRowsResp.error].filter(Boolean);
if (loadWarnings.length) {
  console.warn("Dashboard data loaded with warnings:", loadWarnings);
}

const currentVehicles = vehicleRows || [];
const fuelLogs = (logRowsResp.data || []).filter((item) => (item.entry_type || "refuel") === "refuel");
const trips = tripRowsResp.data || [];
const total = fuelLogs.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
const liters = fuelLogs.reduce((sum, item) => sum + Number(item.fuel_amount_liters || 0), 0);
const distance = trips.reduce((sum, item) => sum + Math.max(0, Number(item.trip_distance_km || 0)), 0);
const businessDistance = trips
  .filter((item) => String(item.trip_type || "").toLowerCase() === "business")
  .reduce((sum, item) => sum + Math.max(0, Number(item.trip_distance_km || 0)), 0);
const personalDistance = trips
  .filter((item) => String(item.trip_type || "").toLowerCase() === "personal")
  .reduce((sum, item) => sum + Math.max(0, Number(item.trip_distance_km || 0)), 0);
const businessShare = distance > 0 ? Math.round((businessDistance / distance) * 100) : 0;
const formatWholeKilometres = (value) =>
  Math.round(Number(value)).toLocaleString("de-DE");
const hour = new Date().getHours();
const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

const renderActivityRow = ({ icon, title, subtitle, value }) => `
  <div class="log-row">
    <div class="car-icon" aria-hidden="true">${icon}</div>
    <div class="row-main">
      <div class="row-title">${escapeHtml(title)}</div>
      <div class="row-sub">${subtitle}</div>
    </div>
    <div class="row-value">${value}</div>
  </div>`;

const recentFuel = fuelLogs.slice(0, 5).map((item) => {
  const vehicleItem = currentVehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
  return renderActivityRow({
    icon: "＋",
    title: vehicleItem?.number_plate || "Vehicle not specified",
    subtitle: `${dateText(item.created_at)} · ${escapeHtml(item.fuel_location || "Location not specified")}`,
    value: `${money(item.total_cost)} · ${Number(item.fuel_amount_liters || 0).toFixed(3)} L`,
  });
}).join("") || '<div class="empty">No recent fuel activity.</div>';
const recentTrips = trips.slice(0, 5).map((item) => {
  const vehicleItem = currentVehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
  return renderActivityRow({
    icon: "↗",
    title: vehicleItem?.number_plate || "Vehicle not specified",
    subtitle: `${escapeHtml(item.trip_type || "Trip")} · ${dateText(item.created_at)}`,
    value: `${Number(item.trip_distance_km || 0).toLocaleString()} km`,
  });
}).join("") || '<div class="empty">No recent trips.</div>';

const dashboardWarning = loadWarnings.length
  ? `<div class="app-status app-status-error" role="status" aria-live="polite">Some recent activity could not be loaded. The totals shown may be incomplete.</div>`
  : "";

await shell("home", `
  <header class="topbar dashboard-hero"><div><div class="eyebrow">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div><h1>${escapeHtml(greeting)}.</h1><p class="dashboard-intro">Here is the latest activity across your vehicles.</p></div><div class="top-date"><strong>ACCOUNT OVERVIEW</strong>Updated just now</div></header>
  ${dashboardWarning}
  <section class="dashboard-actions" aria-labelledby="dashboard-actions-title"><div><span class="eyebrow">Shortcuts</span><h2 id="dashboard-actions-title">What would you like to log?</h2></div><div class="dashboard-action-links"><a class="btn btn-primary" href="logbook.html">＋ Record fill-up</a><a class="btn btn-secondary" href="trip.html">↗ Log a trip</a><a class="dashboard-action-link" href="vehicles.html">View vehicles →</a></div></section>
  <section class="dashboard-summary" aria-label="Logbook summary">
    <div class="card stat stat-primary">
      <div class="stat-label">Distance logged</div>
      <div class="stat-value">${formatWholeKilometres(distance)} <span>km</span></div>
      <div class="stat-note">Across all recorded trips · <a href="trip-report.html">Open trip report</a></div>
      <div class="distance-breakdown" aria-label="Distance split by trip type">
        <div><span>Business</span><strong>${formatWholeKilometres(businessDistance)} km</strong></div>
        <div><span>Personal</span><strong>${formatWholeKilometres(personalDistance)} km</strong></div>
        <div><span>Business share</span><strong>${businessShare}%</strong></div>
      </div>
    </div>
    <div class="dashboard-supporting-stats">
      <div class="card stat stat-compact"><div class="stat-label">Vehicles</div><div class="stat-value">${currentVehicles.length}</div><div class="stat-note"><a href="vehicles.html">View vehicles</a></div></div>
      <div class="card stat stat-compact"><div class="stat-label">Fuel volume</div><div class="stat-value">${liters.toFixed(1)} <span>L</span></div><div class="stat-note">Recorded fill-ups</div></div>
      <div class="card stat stat-compact"><div class="stat-label">Fuel spend</div><div class="stat-value">${money(total)}</div><div class="stat-note">Recorded fill-ups</div></div>
    </div>
  </section>
  <section class="grid two-col">
    <div class="card"><div class="card-head"><h2>Recent fuel activity</h2><a class="text-link" href="report.html">Fuel report</a></div>${recentFuel}</div>
    <div class="card"><div class="card-head"><h2>Recent trips</h2><a class="text-link" href="trip-report.html">Trip reports</a></div>${recentTrips}</div>
  </section>
`);
