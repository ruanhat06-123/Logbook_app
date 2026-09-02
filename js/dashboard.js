import "./app.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

const [vehicleRows, logRowsResp, tripRowsResp] = await Promise.all([
  vehicles(),
  supabase.from("car_logbook").select("*").order("created_at", { ascending: false }),
  supabase.from("trips").select("*").order("created_at", { ascending: false }),
]);
const currentVehicles = vehicleRows || [];
const fuelLogs = (logRowsResp.data || []).filter((item) => (item.entry_type || "refuel") === "refuel");
const trips = tripRowsResp.data || [];
const total = fuelLogs.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
const liters = fuelLogs.reduce((sum, item) => sum + Number(item.fuel_amount_liters || 0), 0);
const distance = fuelLogs.reduce((sum, item) => sum + Math.max(0, Number(item.current_mileage || 0) - Number(item.mileage_last_fill || item.current_mileage || 0)), 0);
const hour = new Date().getHours();
const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
const recentFuel = fuelLogs.slice(0, 5).map((item) => {
  const vehicleItem = currentVehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
  return `<div class="log-row"><div class="car-icon">＋</div><div class="row-main"><div class="row-title">${escapeHtml(vehicleItem?.number_plate || "Vehicle not specified")}</div><div class="row-sub">${dateText(item.created_at)} · ${escapeHtml(item.fuel_location || "Location not specified")}</div></div><div class="row-value">${money(item.total_cost)} · ${Number(item.fuel_amount_liters || 0).toFixed(3)} L</div></div>`;
}).join("") || '<div class="empty">No recent fuel activity.</div>';
const recentTrips = trips.slice(0, 5).map((item) => {
  const vehicleItem = currentVehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
  return `<div class="log-row"><div class="car-icon">↗</div><div class="row-main"><div class="row-title">${escapeHtml(vehicleItem?.number_plate || "Vehicle not specified")}</div><div class="row-sub">${escapeHtml(item.trip_type || "Trip")} · ${dateText(item.created_at)}</div></div><div class="row-value">${Number(item.trip_distance_km || 0).toLocaleString()} km</div></div>`;
}).join("") || '<div class="empty">No recent trips.</div>';

await shell("home", `
  <header class="topbar"><div><div class="eyebrow">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div><h1>${escapeHtml(greeting)}.</h1></div><div class="top-date"><strong>PERSONAL LOGBOOK</strong>Track the road ahead</div></header>
  <section class="grid stats-grid">
    <div class="card stat"><div class="stat-label">Active vehicles</div><div class="stat-value">${currentVehicles.length}</div><div class="stat-note"><a href="vehicles.html">View vehicles</a></div></div>
    <div class="card stat"><div class="stat-label">Fuel logged</div><div class="stat-value">${liters.toFixed(1)} L</div><div class="stat-note">Across all vehicles</div></div>
    <div class="card stat"><div class="stat-label">Distance logged</div><div class="stat-value">${distance.toLocaleString()} km</div><div class="stat-note">From recorded fill-ups</div></div>
    <div class="card stat"><div class="stat-label">Total spend</div><div class="stat-value">${money(total)}</div><div class="stat-note">All recorded time</div></div>
  </section>
  <section class="grid two-col">
    <div class="card"><div class="card-head"><h2>Recent fuel activity</h2><a class="text-link" href="report.html">Fuel report</a></div>${recentFuel}</div>
    <div class="card"><div class="card-head"><h2>Recent trips</h2><a class="text-link" href="trip-report.html">Trip reports</a></div>${recentTrips}</div>
  </section>
`);
