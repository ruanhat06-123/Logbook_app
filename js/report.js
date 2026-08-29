// report.js
import "./app.js";
import { requestServiceNotifications, notifyServiceDue } from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

try {
  // Fetch vehicles and car_logbook entries only
  const [vehiclesResp, logbookResp] = await Promise.all([
    supabase.from("vehicles").select("*").order("number_plate"),
    supabase.from("car_logbook").select("*").order("created_at", { ascending: false }),
  ]);

  if (vehiclesResp.error) console.error("vehicles fetch error:", vehiclesResp.error);
  if (logbookResp.error) console.error("car_logbook fetch error:", logbookResp.error);

  const vehicleRows = vehiclesResp.data || [];
  const logRows = logbookResp.data || [];

  const today = new Date();
  const startDate = new Date(today.getFullYear(), 0, 1);
  const formatInputDate = (date) => date.toISOString().slice(0, 10);

  // Print-focused CSS (A4 landscape)
  const printStyles = `
  <style>
    .table { 
      min-width: 900px;
      border-collapse: collapse; 
      table-layout: auto;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; 
    }
    .table th, .table td { 
      padding: 6px 8px; 
      border-bottom: 1px solid #eee; 
      vertical-align: top; 
      font-size: 12px; 
    }
    .table th { font-weight: 600; text-align: left; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace; }

    @media screen {
      .table th, .table td { font-size: 13px; padding: 8px 10px; }
      .report-controls { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
      .table-wrap { overflow-x: auto; }
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

  const safeVehicle = (list, id) => (list || []).find((v) => String(v.id) === String(id));
  const safeDateText = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
  const safeEscape = (v) => String(v || "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

  // Accept multiple possible price field names (prefer fuel_price)
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

  // Build refuel rows only (exclude trips entirely)
  function mergedRows() {
    return (logRows || [])
      .filter((r) => (r.entry_type || "") === "refuel")
      .map((r) => ({ ...r, _source: "refuel" }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // Build refuel lookup by vehicle + date for price/litres fallback
  const refuelMap = {};
  (logRows || []).forEach((r) => {
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
      const cur = Number(item.current_mileage ?? 0);
      const last = Number(item.mileage_last_fill ?? cur);
      const dist = Math.max(0, cur - last);
      return sum + (Number.isFinite(dist) ? dist : 0);
    }, 0);

    const rowsHtml = filtered.length
      ? `<div class="table-wrap"><table class="table"><thead><tr>
          <th>Date</th>
          <th>Vehicle</th>
          <th>Fuel type</th>
          <th>Location</th>
          <th>Odometer</th>
          <th>Distance From last fill</th>
          <th>Fuel</th>
          <th>ZAR/L</th>
          <th>Total</th>
          <th>Consumption</th>
        </tr></thead><tbody>
        ${filtered
          .map((item) => {
            const dateLabel = safeDateText(item.created_at);
            const vehicleLabel = safeVehicle(vehicleRows, item.vehicle_id)?.number_plate || "—";
            const fuelType = item.fuel_type || "Petrol";
            const location = item.fuel_location || "Not specified";
            const odometer = Number(item.current_mileage ?? 0);
            const distance = Math.max(0, odometer - Number(item.mileage_last_fill ?? odometer));
            const fuelDisplay = `${Number(item.fuel_amount_liters ?? 0).toFixed(3)} L`;
            const priceVal = readPricePerLitre(item);
            const priceLabel = priceVal === null ? "—" : `ZAR ${Number(priceVal).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const totalLabel = money(item.total_cost ?? (priceVal !== null ? (Number(item.fuel_amount_liters ?? 0) * priceVal) : 0));

            // consumption: prefer stored value on row, else compute if litres available and distance > 0
            const storedConsumption = item.fuel_consumption_l_per_100km ?? null;
            let consumptionVal = storedConsumption;
            if (consumptionVal === null) {
              if (distance > 0) {
                const litres = (item.fuel_amount_liters ?? item.liters ?? null);
                if (litres !== null && Number.isFinite(litres) && litres > 0) {
                  consumptionVal = Number(((litres / distance) * 100).toFixed(3));
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
              <td class="mono">${distance.toLocaleString()} km</td>
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
      "Location",
      "Odometer (km)",
      "Distance from last fill (km)",
      "Fuel (L)",
      "ZAR/L",
      "Total (ZAR)",
      "Consumption (L/100km)",
    ];

    const rows = filtered.map((item) => {
      const date = toISODate(item.created_at);
      const vehicleLabel = safeVehicle(vehicleRows, item.vehicle_id)?.number_plate || "";
      const fuelType = item.fuel_type || "";
      const location = item.fuel_location || "";
      const odometer = item.current_mileage ?? "";
      const distance = Math.max(0, Number(item.current_mileage ?? 0) - Number(item.mileage_last_fill ?? item.current_mileage ?? 0));
      const fuelLitres = item.fuel_amount_liters ?? item.liters ?? "";
      const priceVal = readPricePerLitre(item);
      const priceCsv = priceVal === null ? "" : Number(priceVal).toFixed(2);
      const totalCsv = item.total_cost ?? (priceVal !== null && fuelLitres !== "" ? (Number(fuelLitres) * priceVal).toFixed(2) : "");
      const storedConsumption = item.fuel_consumption_l_per_100km ?? "";
      let consumptionCsv = storedConsumption;
      if ((consumptionCsv === "" || consumptionCsv === null) && distance && Number(distance) > 0) {
        if (fuelLitres !== "" && Number.isFinite(Number(fuelLitres)) && Number(fuelLitres) > 0) {
          consumptionCsv = Number(((Number(fuelLitres) / Number(distance)) * 100).toFixed(3));
        }
      }
      return [
        date,
        vehicleLabel,
        fuelType,
        location,
        odometer,
        distance,
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
