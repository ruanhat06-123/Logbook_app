import "./app.js";
const user = await requireAuth();
if (user) {
  const [{ data: currentVehicles }, { data: currentLogs }] = await Promise.all([
    supabase.from("vehicles").select("*").order("number_plate"),
    supabase
      .from("car_logbook")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);
  const vehicleRows = currentVehicles || [],
    logRows = currentLogs || [];
  const today = new Date(),
    startDate = new Date(today.getFullYear(), 0, 1),
    formatInputDate = (date) => date.toISOString().slice(0, 10);
  await shell(
    "report",
    `<header class="topbar"><div><div class="eyebrow">Insights / reports</div><h1>See where it goes.</h1></div><div class="top-date"><strong>FUEL REPORT</strong>Updated just now</div></header><div class="card"><div class="report-controls"><div class="field"><label for="vehicle-filter">Vehicle</label><select id="vehicle-filter"><option value="all">All vehicles</option>${vehicleRows.map((item) => `<option value="${item.id}">${item.number_plate}</option>`).join("")}</select></div><div class="field"><label for="start-date">From</label><input id="start-date" type="date" value="${formatInputDate(startDate)}"></div><div class="field"><label for="end-date">To</label><input id="end-date" type="date" value="${formatInputDate(today)}"></div><button id="filter-button" class="btn btn-primary">Update report ↗</button><button id="download-button" class="btn btn-secondary">Download CSV ↓</button><button id="print-button" class="btn btn-secondary">Print report</button></div><div id="report-output"></div></div>`,
  );
  function filteredRows() {
    const selected = document.querySelector("#vehicle-filter").value,
      start = document.querySelector("#start-date").value,
      end = document.querySelector("#end-date").value;
    return logRows
      .filter(
        (item) =>
          (item.entry_type || "refuel") === "refuel" &&
          (selected === "all" || item.vehicle_id === selected) &&
          item.created_at.slice(0, 10) >= start &&
          item.created_at.slice(0, 10) <= end,
      )
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  function draw() {
    const filtered = filteredRows(),
      totalLiters = filtered.reduce(
        (sum, item) => sum + Number(item.fuel_amount_liters),
        0,
      ),
      totalCost = filtered.reduce(
        (sum, item) => sum + Number(item.total_cost),
        0,
      ),
      totalDistance = filtered.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Number(item.current_mileage) -
              Number(item.mileage_last_fill || item.current_mileage),
          ),
        0,
      );
    document.querySelector("#report-output").innerHTML =
      `<div class="total-strip"><div class="total-box"><label>Total fuel</label><strong>${totalLiters.toFixed(1)} L</strong></div><div class="total-box"><label>Total spend</label><strong>${money(totalCost)}</strong></div><div class="total-box"><label>Distance covered</label><strong>${totalDistance.toLocaleString()} km</strong></div></div>${filtered.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Vehicle</th><th>Fuel type</th><th>Location</th><th>Odometer</th><th>Distance from last fill</th><th>Fuel</th><th>Cost</th></tr></thead><tbody>${filtered.map((item) => { const distanceFromLastFill = item.entry_type === "trip" ? null : Math.max(0, Number(item.current_mileage) - Number(item.mileage_last_fill || item.current_mileage)); return `<tr><td class="mono">${dateText(item.created_at)}</td><td><strong>${vehicle(vehicleRows, item.vehicle_id)?.number_plate || "—"}</strong></td><td>${item.entry_type === "trip" ? "Trip" : item.fuel_type || "Petrol"}</td><td>${item.entry_type === "trip" ? `${item.trip_origin || "Trip"} → ${item.trip_destination || "Destination"}` : item.fuel_location || "Not specified"}</td><td class="mono">${Number(item.current_mileage).toLocaleString()} km</td><td class="mono">${distanceFromLastFill === null ? "—" : `${distanceFromLastFill.toLocaleString()} km`}</td><td class="mono">${item.entry_type === "trip" ? `${Number(item.trip_distance_km || 0).toLocaleString()} km` : `${Number(item.fuel_amount_liters).toFixed(1)} L`}</td><td class="mono">${item.entry_type === "trip" ? "—" : money(item.total_cost)}</td></tr>`; }).join("")}</tbody></table></div>` : '<div class="empty">No entries match this date range.</div>'}`;
  }
  document.querySelector("#filter-button").addEventListener("click", draw);
  document
    .querySelector("#print-button")
    .addEventListener("click", () => window.print());
  draw();
  document.querySelector("#download-button").addEventListener("click", () => {
    const filtered = filteredRows(),
      start = document.querySelector("#start-date").value,
      end = document.querySelector("#end-date").value,
      csv = [
        [
          "Date",
          "Vehicle",
          "Fuel type",
          "Location",
          "Odometer (km)",
          "Distance from last fill (km)",
          "Fuel (L)",
          "Price per litre (ZAR)",
          "Total cost (ZAR)",
        ],
        ...filtered.map((item) => [
          item.created_at.slice(0, 10),
          vehicle(vehicleRows, item.vehicle_id)?.number_plate || "",
          item.fuel_type || "Petrol",
          item.fuel_location || "",
          item.current_mileage,
          item.entry_type === "trip"
            ? ""
            : Math.max(
                0,
                Number(item.current_mileage) -
                  Number(item.mileage_last_fill || item.current_mileage),
              ),
          item.fuel_amount_liters,
          item.fuel_price,
          item.total_cost,
        ]),
      ]
        .map((row) =>
          row
            .map((value) => `"${String(value).replaceAll('"', '""')}"`)
            .join(","),
        )
        .join("\n"),
      link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `mileage-report-${start}-to-${end}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
}
