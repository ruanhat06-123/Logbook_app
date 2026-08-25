import "./app.js";

const user = await requireAuth();
if (user) {
  const [{ data: currentVehicles }, { data: currentLogs }] = await Promise.all([
    supabase.from("vehicles").select("*").order("number_plate"),
    supabase.from("car_logbook").select("*").eq("entry_type", "trip").order("created_at", { ascending: false }),
  ]);
  const vehicleRows = currentVehicles || [];
  const logRows = currentLogs || [];
  const today = new Date();
  const inputDate = (date) => date.toISOString().slice(0, 10);
  await shell("trip-report", `<header class="topbar"><div><div class="eyebrow">Insights / trip reports</div><h1>Track every journey.</h1></div><div class="top-date"><strong>TRIP REPORT</strong>Odometer-led</div></header><div class="card"><div class="report-controls"><div class="field"><label for="vehicle-filter">Vehicle</label><select id="vehicle-filter"><option value="all">All vehicles</option>${vehicleRows.map((item) => `<option value="${item.id}">${item.number_plate}</option>`).join("")}</select></div><div class="field"><label for="trip-filter">Trip type</label><select id="trip-filter"><option value="all">All trips</option><option value="personal">Personal</option><option value="business">Business</option></select></div><div class="field"><label for="start-date">From</label><input id="start-date" type="date" value="${inputDate(new Date(today.getFullYear(), 0, 1))}"></div><div class="field"><label for="end-date">To</label><input id="end-date" type="date" value="${inputDate(today)}"></div><button id="filter-button" class="btn btn-primary">Update report ↗</button><button id="download-button" class="btn btn-secondary">Download CSV ↓</button><button id="print-button" class="btn btn-secondary">Print report</button></div><div id="report-output"></div></div>`);
  const filteredRows = () => {
    const vehicleId = document.querySelector("#vehicle-filter").value;
    const tripType = document.querySelector("#trip-filter").value;
    const start = document.querySelector("#start-date").value;
    const end = document.querySelector("#end-date").value;
    return logRows.filter((item) => (vehicleId === "all" || item.vehicle_id === vehicleId) && (tripType === "all" || item.trip_type === tripType) && item.created_at.slice(0, 10) >= start && item.created_at.slice(0, 10) <= end);
  };
  const draw = () => {
    const rows = filteredRows();
    const distance = rows.reduce((sum, item) => sum + Number(item.trip_distance_km || 0), 0);
    const business = rows.filter((item) => item.trip_type === "business").reduce((sum, item) => sum + Number(item.trip_distance_km || 0), 0);
    const personal = rows.filter((item) => item.trip_type === "personal").reduce((sum, item) => sum + Number(item.trip_distance_km || 0), 0);
    document.querySelector("#report-output").innerHTML = `<div class="total-strip"><div class="total-box"><label>Total trips</label><strong>${rows.length}</strong></div><div class="total-box"><label>Total distance</label><strong>${distance.toLocaleString()} km</strong></div><div class="total-box"><label>Business / personal</label><strong>${business.toLocaleString()} / ${personal.toLocaleString()} km</strong></div></div>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Vehicle</th><th>Type</th><th>Start odometer</th><th>End odometer</th><th>Distance</th></tr></thead><tbody>${rows.map((item) => `<tr><td class="mono">${dateText(item.created_at)}</td><td><strong>${vehicle(vehicleRows, item.vehicle_id)?.number_plate || "—"}</strong></td><td>${item.trip_type || "—"}</td><td class="mono">${Number(item.mileage_start).toLocaleString()} km</td><td class="mono">${Number(item.mileage_end).toLocaleString()} km</td><td class="mono">${Number(item.trip_distance_km || 0).toLocaleString()} km</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No trips match this filter.</div>'}`;
  };
  document.querySelector("#filter-button").addEventListener("click", draw);
  document.querySelector("#print-button").addEventListener("click", () => window.print());
  draw();
  document.querySelector("#download-button").addEventListener("click", () => {
    const rows = filteredRows();
    const csv = [["Date", "Vehicle", "Trip type", "Start odometer (km)", "End odometer (km)", "Distance (km)"], ...rows.map((item) => [item.created_at.slice(0, 10), vehicle(vehicleRows, item.vehicle_id)?.number_plate || "", item.trip_type || "", item.mileage_start, item.mileage_end, item.trip_distance_km])].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "trip-report.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  });
}