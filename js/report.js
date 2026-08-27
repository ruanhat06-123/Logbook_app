// report.js
import "./app.js";
import { requestServiceNotifications, notifyServiceDue } from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

try {
  // Fetch vehicles, car_logbook entries and trips
  const [vehiclesResp, logbookResp, tripsResp] = await Promise.all([
    supabase.from("vehicles").select("*").order("number_plate"),
    supabase.from("car_logbook").select("*").order("created_at", { ascending: false }),
    supabase.from("trips").select("*").order("created_at", { ascending: false }),
  ]);

  if (vehiclesResp.error) console.error("vehicles fetch error:", vehiclesResp.error);
  if (logbookResp.error) console.error("car_logbook fetch error:", logbookResp.error);
  if (tripsResp.error) console.error("trips fetch error:", tripsResp.error);

  const vehicleRows = vehiclesResp.data || [];
  const logRows = logbookResp.data || [];
  const tripRows = tripsResp.data || [];

  const today = new Date();
  const startDate = new Date(today.getFullYear(), 0, 1);
  const formatInputDate = (date) => date.toISOString().slice(0, 10);

  // Print-focused CSS (A4 landscape)
  const printStyles = `
    <style>
      .table { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
      .table th, .table td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 12px; }
      .table th { font-weight: 600; text-align: left; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace; }

      /* Column width hints (adjusted for single consumption column) */
      .table th:nth-child(1), .table td:nth-child(1) { width: 9%; }   /* Date */
      .table th:nth-child(2), .table td:nth-child(2) { width: 11%; }  /* Vehicle */
      .table th:nth-child(3), .table td:nth-child(3) { width: 9%; }   /* Fuel type */
      .table th:nth-child(4), .table td:nth-child(4) { width: 20%; }  /* Location / Trip */
      .table th:nth-child(5), .table td:nth-child(5) { width: 9%; }   /* Odometer */
      .table th:nth-child(6), .table td:nth-child(6) { width: 8%; }   /* Trip */
      .table th:nth-child(7), .table td:nth-child(7) { width: 7%; }   /* Fuel */
      .table th:nth-child(8), .table td:nth-child(8) { width: 8%; }   /* ZAR/L */
      .table th:nth-child(9), .table td:nth-child(9) { width: 8%; }   /* Total */
      .table th:nth-child(10), .table td:nth-child(10) { width: 11%; } /* Consumption */

      @media screen {
        .table th, .table td { font-size: 13px; padding: 8px 10px; }
        .report-controls { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
      }

      @page { size: A4 landscape; margin: 8mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; color-adjust: exact; }
        .report-controls, .btn { display: none !important; }
        .card { box-shadow: none; border: none; padding: 0; }
        #report-output { margin: 0; }

        .table th, .table td { font-size: 9.5px !important; padding: 4px 6px !important; }
        .total-strip .total-box label { font-size: 9px; }
        .total-strip .total-box strong { font-size: 11px; }

        /* Keep numeric columns on one line */
        .table td:nth-child(1), .table td:nth-child(5), .table td:nth-child(6), .table td:nth-child(7), .table td:nth-child(8), .table td:nth-child(9), .table td:nth-child(10) {
          white-space: nowrap;
          overflow: visible;
        }

        /* Allow wrapping for long text columns */
        .table td:nth-child(4), .table th:nth-child(4) { white-space: normal; word-break: break-word; overflow-wrap: anywhere; }

        table, thead, tbody, tr, td, th { page-break-inside: avoid !important; }
        .table-wrap { width: 100%; overflow: visible; }
      }

      @media (max-width: 800px) {
        .table-wrap { overflow-x: auto; }
      }
    </style>
  `;

  await shell(
    "report",
    `${printStyles}
    <header class="topbar"><div><div class="eyebrow">Insights / reports</div><h1>See where it goes.</h1></div><div class="top-date"><strong>FUEL REPORT</strong>Updated just now</div></header>
    <div class="card">
      <div class="report-controls">
        <div class="field">
          <label for="vehicle-filter">Vehicle</label>
          <select id="vehicle-filter">
            <option value="all">All vehicles</option>
            ${vehicleRows.map((item) => `<option value="${item.id}">${escapeHtml(item.number_plate || "")}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="start-date">From</label>
          <input id="start-date" type="date" value="${formatInputDate(startDate)}">
        </div>
        <div class="field">
          <label for="end-date">To</label>
          <input id="end-date" type="date" value="${formatInputDate(today)}">
        </div>
        <button id="filter-button" class="btn btn-primary">Update report ↗</button>
        <button id="download-button" class="btn btn-secondary">Download CSV ↓</button>
        <button id="print-button" class="btn btn-secondary">Print report</button>
      </div>
      <div id="report-output"></div>
    </div>`
  );

  await requestServiceNotifications();
  vehicleRows.forEach(notifyServiceDue);

  // Helpers
  const money = (v) =>
    `ZAR ${Number(v || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const toISODate = (s) => {
    if (!s) return "";
    try {
      const d = (s instanceof Date) ? s : new Date(s);
      if (Number.isNaN(d.getTime())) return "";
      return d.toISOString().slice(0, 10);
    } catch {
      return "";
    }
  };

  const safeVehicle = globalThis.vehicle || ((list, id) => (list || []).find((v) => String(v.id) === String(id)));
  const safeDateText = globalThis.dateText || ((d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : ""));
  const safeEscape = globalThis.escapeHtml || ((v) => String(v || "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])));

  // Accept multiple possible price field names
  const readPricePerLitre = (row) => {
    if (!row) return null;
    const candidates = [
      row.fuel_price,
      row.price_per_litre,
      row.fuel_price_per_litre,
      row.price_per_liter,
      row.fuel_price_per_liter,
      row.price,
    ];
    for (const c of candidates) {
      if (c !== undefined && c !== null && c !== "") return Number(c);
    }
    return null;
  };

  // Merge rows: include both car_logbook refuels and trips table rows
  function mergedRows() {
    const refuels = (logRows || []).map(r => ({ ...r, _source: "refuel" }));
    const trips = (tripRows || []).map(t => ({ ...t, _source: "trip" }));
    return [...refuels, ...trips].filter(Boolean).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function filteredRows() {
    const selected = document.querySelector("#vehicle-filter")?.value || "all";
    const start = document.querySelector("#start-date")?.value || "";
    const end = document.querySelector("#end-date")?.value || "";

    return mergedRows()
      .filter((item) => {
        const createdDate = toISODate(item.created_at);
        if (!createdDate) return false;
        if (start && createdDate < start) return false;
        if (end && createdDate > end) return false;
        if (selected !== "all" && String(item.vehicle_id) !== String(selected)) return false;
        return true;
      });
  }

  // Read litres for trip fallback (trip may carry trip_litres or we can match refuel by date)
  const readLitresForTrip = (item, refuelMap) => {
    const directLitres = item.fuel_amount_liters ?? item.liters ?? item.trip_litres ?? null;
    if (directLitres !== null && directLitres !== undefined && directLitres !== "") return Number(directLitres);
    const key = `${String(item.vehicle_id)}:${toISODate(item.created_at)}`;
    if (refuelMap && refuelMap[key] && refuelMap[key].litres !== null) return refuelMap[key].litres;
    return null;
  };

  // Build refuel lookup by vehicle + date for fallback (price and litres)
  const refuelsResp = logbookResp.data || [];
  const refuelMap = {};
  (refuelsResp || []).forEach((r) => {
    if ((r.entry_type || "") !== "refuel") return;
    const key = `${String(r.vehicle_id)}:${toISODate(r.created_at)}`;
    if (refuelMap[key] === undefined) {
      const price = r.fuel_price ?? r.price_per_litre ?? r.fuel_price_per_litre ?? r.price_per_liter ?? r.fuel_price_per_liter ?? null;
      const litres = r.fuel_amount_liters ?? r.liters ?? null;
      refuelMap[key] = {
        price: (price !== null && price !== undefined && price !== "") ? Number(price) : null,
        litres: (litres !== null && litres !== undefined && litres !== "") ? Number(litres) : null,
      };
    }
  });

  function draw() {
    const filtered = filteredRows();

    const totalLiters = filtered.reduce((sum, item) => {
      const liters = Number(item.fuel_amount_liters ?? item.liters ?? 0);
      return sum + (Number.isFinite(liters) ? liters : 0);
    }, 0);

    const totalCost = filtered.reduce((sum, item) => {
      const cost = Number(item.total_cost ?? 0);
      return sum + (Number.isFinite(cost) ? cost : 0);
    }, 0);

    const totalDistance = filtered.reduce((sum, item) => {
      if (item._source === "trip") {
        const d = Number(item.trip_distance_km ?? 0);
        return sum + (Number.isFinite(d) ? d : 0);
      } else {
        const cur = Number(item.current_mileage ?? 0);
        const last = Number(item.mileage_last_fill ?? cur);
        const dist = Math.max(0, cur - last);
        return sum + (Number.isFinite(dist) ? dist : 0);
      }
    }, 0);

    const rowsHtml = filtered.length
      ? `<div class="table-wrap"><table class="table"><thead><tr>
          <th>Date</th>
          <th>Vehicle</th>
          <th>Fuel type</th>
          <th>Location / Trip</th>
          <th>Odometer</th>
          <th>Trip</th>
          <th>Fuel</th>
          <th>ZAR/L</th>
          <th>Total</th>
          <th>Consumption</th>
        </tr></thead><tbody>
        ${filtered
          .map((item) => {
            const isTrip = item._source === "trip";
            const dateLabel = safeDateText(item.created_at);
            const vehicleLabel = safeVehicle(vehicleRows, item.vehicle_id)?.number_plate || "—";
            const fuelType = isTrip ? "Trip" : (item.fuel_type || "Petrol");
            const location = isTrip
              ? `${item.trip_origin || "Trip"} → ${item.trip_destination || "Destination"}`
              : (item.fuel_location || "Not specified");
            const odometer = Number(item.current_mileage ?? item.mileage_end ?? 0);
            const tripCol = isTrip ? `${Number(item.trip_distance_km || 0).toLocaleString()} km` : `${Math.max(0, odometer - Number(item.mileage_last_fill ?? odometer)).toLocaleString()} km`;
            const fuelDisplay = isTrip ? `${Number(item.trip_distance_km || 0).toLocaleString()} km` : `${Number(item.fuel_amount_liters ?? 0).toFixed(3)} L`;
            const priceVal = readPricePerLitre(item);
            const priceLabel = priceVal === null ? "—" : `ZAR ${Number(priceVal).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const totalLabel = isTrip ? "—" : money(item.total_cost ?? (priceVal !== null ? (Number(item.fuel_amount_liters ?? 0) * priceVal) : 0));

            // consumption: prefer stored value on row, else compute if litres available and distance > 0
            const storedConsumption = item.fuel_consumption_l_per_100km ?? null;
            let consumptionVal = storedConsumption;
            if (consumptionVal === null) {
              let distanceForCalc = 0;
              if (isTrip) {
                distanceForCalc = Number(item.trip_distance_km ?? 0);
              } else {
                distanceForCalc = Math.max(0, odometer - Number(item.mileage_last_fill ?? odometer));
              }
              if (distanceForCalc > 0) {
                const litres = readLitresForTrip(item, refuelMap);
                if (litres !== null && Number.isFinite(litres) && litres > 0) {
                  consumptionVal = Number(((litres / distanceForCalc) * 100).toFixed(3));
                }
              }
            }

            const consumptionLabel = consumptionVal === null ? "—" : `${Number(consumptionVal).toFixed(3)} L/100km`;

            return `<tr>
              <td class="mono">${safeEscape(dateLabel)}</td>
              <td><strong>${safeEscape(vehicleLabel)}</strong></td>
              <td>${safeEscape(fuelType)}</td>
              <td>${safeEscape(location)}</td>
              <td class="mono">${odometer.toLocaleString()} km</td>
              <td class="mono">${safeEscape(tripCol)}</td>
              <td class="mono">${safeEscape(fuelDisplay)}</td>
              <td class="mono">${safeEscape(priceLabel)}</td>
              <td class="mono">${safeEscape(totalLabel)}</td>
              <td class="mono">${safeEscape(consumptionLabel)}</td>
            </tr>`;
          })
          .join("")}
        </tbody></table></div>`
      : `<div class="empty">No entries match this date range.</div>`;

    document.querySelector("#report-output").innerHTML =
      `<div class="total-strip">
        <div class="total-box"><label>Total fuel</label><strong>${Number(totalLiters).toFixed(3)} L</strong></div>
        <div class="total-box"><label>Total spend</label><strong>${money(totalCost)}</strong></div>
        <div class="total-box"><label>Distance covered</label><strong>${Number(totalDistance).toLocaleString()} km</strong></div>
      </div>
      ${rowsHtml}`;
  }

  function downloadCsv() {
    const filtered = filteredRows();
    const start = document.querySelector("#start-date").value;
    const end = document.querySelector("#end-date").value;

    const header = [
      "Date",
      "Vehicle",
      "Fuel type",
      "Location / Trip",
      "Odometer (km)",
      "Trip (km)",
      "Fuel (L)",
      "ZAR/L",
      "Total (ZAR)",
      "Consumption (L/100km)",
    ];

    const rows = filtered.map((item) => {
      const isTrip = item._source === "trip";
      const date = toISODate(item.created_at);
      const vehicleLabel = safeVehicle(vehicleRows, item.vehicle_id)?.number_plate || "";
      const fuelType = isTrip ? "Trip" : (item.fuel_type || "");
      const location = isTrip
        ? `${item.trip_origin || ""} → ${item.trip_destination || ""}`
        : (item.fuel_location || "");
      const odometer = item.current_mileage ?? item.mileage_end ?? "";
      const tripCsv = isTrip ? (item.trip_distance_km ?? "") : Math.max(0, Number(item.current_mileage ?? 0) - Number(item.mileage_last_fill ?? item.current_mileage ?? 0));
      const fuelLitres = isTrip ? (item.trip_distance_km ?? "") : (item.fuel_amount_liters ?? "");
      const priceVal = readPricePerLitre(item);
      const priceCsv = priceVal === null ? "" : Number(priceVal).toFixed(2);
      const totalCsv = item.total_cost ?? (priceVal !== null && fuelLitres !== "" ? (Number(fuelLitres) * priceVal).toFixed(2) : "");
      // consumption: prefer stored, else compute if possible
      const storedConsumption = item.fuel_consumption_l_per_100km ?? "";
      let consumptionCsv = storedConsumption;
      if ((consumptionCsv === "" || consumptionCsv === null) && tripCsv && Number(tripCsv) > 0) {
        const litres = readLitresForTrip(item, refuelMap);
        if (litres !== null && Number.isFinite(litres) && litres > 0) {
          consumptionCsv = Number(((litres / Number(tripCsv)) * 100).toFixed(3));
        }
      }
      return [
        date,
        vehicleLabel,
        fuelType,
        location,
        odometer,
        tripCsv,
        fuelLitres,
        priceCsv,
        totalCsv,
        consumptionCsv,
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `mileage-report-${start}-to-${end}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // Wire events
  document.querySelector("#filter-button").addEventListener("click", draw);
  document.querySelector("#print-button").addEventListener("click", () => { try { window.print(); } catch (e) { window.print(); } });
  document.querySelector("#download-button").addEventListener("click", downloadCsv);

  // Initial draw
  draw();
} catch (err) {
  console.error("report initialization error:", err);
  try {
    document.body.innerHTML = `<div class="card"><div class="empty">Failed to open report. See console for details.</div></div>`;
  } catch (e) {}
}

// small helper used in template if not present globally
function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}
