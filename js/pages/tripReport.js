// trip-report.js
import "../core/app.js";
import { requestServiceNotifications, notifyServiceDue } from "../core/serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

try {
  // Fetch vehicles and trips (primary) and fallback trip-like entries from car_logbook
  const [vehiclesResp, tripsResp, logbookTripsResp] = await Promise.all([
    supabase.from("vehicles").select("*").order("number_plate"),
    supabase.from("trips").select("*").order("created_at", { ascending: false }),
    supabase.from("car_logbook").select("*").eq("entry_type", "trip").order("created_at", { ascending: false }),
  ]);

  const vehicleRows = vehiclesResp.data || [];
  const tripRows = (tripsResp.data && tripsResp.data.length) ? tripsResp.data : (logbookTripsResp.data || []);

  const toISODate = (val) => {
    if (!val) return "";
    const d = (val instanceof Date) ? val : new Date(val);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  const today = new Date();
  const inputDate = (d) => d.toISOString().slice(0, 10);

  // CSS: keep single-row layout and ensure small screens show all columns via horizontal scroll
  const printStyles = `
    <style>
      :root {
        --mono-font: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace;
        --ui-font: system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Helvetica Neue";
      }

      .table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .table { min-width: 900px; width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--ui-font); }
      .table th, .table td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .table th { font-weight: 600; text-align: left; }
      .mono { font-family: var(--mono-font); }

      /* Column width hints for large screens */
      .table th:nth-child(1), .table td:nth-child(1) { width: 9%; }
      .table th:nth-child(2), .table td:nth-child(2) { width: 11%; }
      .table th:nth-child(3), .table td:nth-child(3) { width: 8%; }
      .table th:nth-child(4), .table td:nth-child(4) { width: 18%; }
      .table th:nth-child(5), .table td:nth-child(5) { width: 10%; }
      .table th:nth-child(6), .table td:nth-child(6) { width: 10%; }
      .table th:nth-child(7), .table td:nth-child(7) { width: 10%; }
      .table th:nth-child(8), .table td:nth-child(8) { width: 10%; }
      .table th:nth-child(9), .table td:nth-child(9) { width: 14%; }

      @media screen {
        .table th, .table td { font-size: 13px; padding: 8px 10px; }
        .report-controls { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
      }

      @page { size: A4 landscape; margin: 8mm; }
      @media print {
        .report-controls, .btn { display: none !important; }
        .table th, .table td { font-size: 9.5px !important; padding: 4px 6px !important; white-space: nowrap; }
        table, thead, tbody, tr, td, th { page-break-inside: avoid !important; }
        .table-wrap { width: 100%; overflow: visible; }
      }

      /* Very small screens: keep single-row layout but allow horizontal scroll */
      @media (max-width: 420px) {
        .table { min-width: 900px; }
        .table th, .table td { font-size: 12px; padding: 6px 8px; }
        .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      }
    </style>
  `;

  await shell(
    "trip-report",
    `${printStyles}
    <header class="topbar"><div><div class="eyebrow">Insights / trip reports</div><h1>Track every journey.</h1></div><div class="top-date"><strong>TRIP REPORT</strong>Odometer-led</div></header>
    <div class="card">
      <div class="report-controls">
        <div class="field"><label for="vehicle-filter">Vehicle</label><select id="vehicle-filter"><option value="all">All vehicles</option>${vehicleRows.map(v => `<option value="${v.id}">${escapeHtml(v.number_plate || "")}</option>`).join("")}</select></div>
        <div class="field"><label for="trip-filter">Trip type</label><select id="trip-filter"><option value="all">All trips</option><option value="personal">Personal</option><option value="business">Business</option></select></div>
        <div class="field"><label for="purpose-filter">Purpose</label><select id="purpose-filter"><option value="all">All purposes</option><option value="commute">Commute</option><option value="errand">Errand</option><option value="delivery">Delivery</option><option value="client_meeting">Client meeting</option><option value="other">Other</option></select></div>
        <div class="field"><label for="start-date">From</label><input id="start-date" type="date" value="${inputDate(new Date(today.getFullYear(),0,1))}"></div>
        <div class="field"><label for="end-date">To</label><input id="end-date" type="date" value="${inputDate(today)}"></div>
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
  const safeVehicle = globalThis.vehicle || ((list, id) => (list || []).find(v => String(v.id) === String(id)));
  const safeDateText = globalThis.dateText || (d => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
  const safeEscape = globalThis.escapeHtml || (s => String(s || "").replace(/[&<>'"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;" }[c])));

  const normalizeId = v => (v === null || v === undefined) ? "" : String(v);

  const outputEl = document.querySelector("#report-output");
  const vehicleFilterEl = document.querySelector("#vehicle-filter");
  const tripFilterEl = document.querySelector("#trip-filter");
  const purposeFilterEl = document.querySelector("#purpose-filter");
  const startDateEl = document.querySelector("#start-date");
  const endDateEl = document.querySelector("#end-date");
  const filterBtn = document.querySelector("#filter-button");
  const printBtn = document.querySelector("#print-button");
  const downloadBtn = document.querySelector("#download-button");

  if (!outputEl) {
    console.error("trip-report: missing #report-output element");
    document.body.innerHTML = `<div class="card"><div class="empty">Trip report failed to render. See console for details.</div></div>`;
    throw new Error("Missing report output container");
  }

  const filteredRows = () => {
    const vehicleId = vehicleFilterEl?.value || "all";
    const tripType = tripFilterEl?.value || "all";
    const purpose = purposeFilterEl?.value || "all";
    const start = startDateEl?.value || "";
    const end = endDateEl?.value || "";

    return (tripRows || []).filter(item => {
      const created = toISODate(item.created_at);
      if (!created) return false;
      const itemVehicle = normalizeId(item.vehicle_id);
      const vehicleMatch = vehicleId === "all" || itemVehicle === normalizeId(vehicleId);
      const typeMatch = tripType === "all" || String(item.trip_type || "").toLowerCase() === tripType;
      const purposeMatch = purpose === "all" || String((item.trip_purpose || item.purpose || "")).toLowerCase() === purpose;
      const dateMatch = (!start || created >= start) && (!end || created <= end);
      return vehicleMatch && typeMatch && purposeMatch && dateMatch;
    });
  };

  const draw = () => {
    try {
      const rows = filteredRows();

      const totalDistance = rows.reduce((s, i) => s + Number(i.trip_distance_km || i.distance_km || Math.max(0, Number(i.mileage_end ?? i.mileage_end_km ?? 0) - Number(i.mileage_start ?? i.mileage_start_km ?? 0))), 0);
      const business = rows.filter(i => String(i.trip_type) === "business").reduce((s, i) => s + Number(i.trip_distance_km || i.distance_km || 0), 0);
      const personal = rows.filter(i => String(i.trip_type) === "personal").reduce((s, i) => s + Number(i.trip_distance_km || i.distance_km || 0), 0);

      const tableHeader = `
        <thead><tr>
          <th>Date</th>
          <th>Vehicle</th>
          <th>Type</th>
          <th>Purpose</th>
          <th>Origin</th>
          <th>Destination</th>
          <th>Start odometer</th>
          <th>End odometer</th>
          <th>Distance (km)</th>
        </tr></thead>`;

      const rowsHtml = rows.map((item) => {
        const vehicleLabel = safeVehicle(vehicleRows, item.vehicle_id)?.number_plate || "—";
        const dateLabel = safeDateText(item.created_at);
        const start = Number(item.mileage_start ?? item.mileage_start_km ?? 0);
        const end = Number(item.mileage_end ?? item.mileage_end_km ?? 0);
        const distNum = Number(item.trip_distance_km ?? item.distance_km ?? Math.max(0, end - start));
        const purposeLabel = safeEscape(item.trip_purpose || item.purpose || "—");
        const origin = safeEscape(item.trip_origin || item.origin || item.start_location || "—");
        const destination = safeEscape(item.trip_destination || item.destination || item.end_location || "—");

        return `<tr>
          <td class="mono">${safeEscape(dateLabel)}</td>
          <td><strong>${safeEscape(vehicleLabel)}</strong></td>
          <td>${safeEscape(item.trip_type || "—")}</td>
          <td>${purposeLabel}</td>
          <td>${origin}</td>
          <td>${destination}</td>
          <td class="mono">${start.toLocaleString()} km</td>
          <td class="mono">${end.toLocaleString()} km</td>
          <td class="mono">${distNum.toLocaleString()} km</td>
        </tr>`;
      }).join("");

      outputEl.innerHTML = `
        <div class="total-strip" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
          <div class="total-box"><label>Total trips</label><strong style="display:block">${rows.length}</strong></div>
          <div class="total-box"><label>Total distance</label><strong style="display:block">${totalDistance.toLocaleString()} km</strong></div>
          <div class="total-box"><label>Business / personal</label><strong style="display:block">${business.toLocaleString()} / ${personal.toLocaleString()} km</strong></div>
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="table">${tableHeader}<tbody>${rowsHtml}</tbody></table></div>` : `<div class="empty">No trips match this filter.</div>`}
      `;
    } catch (err) {
      console.error("Error drawing trip report:", err);
      outputEl.innerHTML = `<div class="empty">Unable to render report. See console for details.</div>`;
    }
  };

  filterBtn?.addEventListener("click", draw);
  printBtn?.addEventListener("click", () => window.print());
  draw();

  downloadBtn?.addEventListener("click", () => {
    const rows = filteredRows();
    const header = [
      "Date","Vehicle","Trip type","Purpose","Origin","Destination",
      "Start odometer (km)","End odometer (km)","Distance (km)"
    ];

    const csvRows = [
      header,
      ...rows.map((item) => {
        const date = toISODate(item.created_at);
        const vehicleLabel = safeVehicle(vehicleRows, item.vehicle_id)?.number_plate || "";
        const dist = item.trip_distance_km ?? item.distance_km ?? Math.max(0, Number(item.mileage_end ?? item.mileage_end_km ?? 0) - Number(item.mileage_start ?? item.mileage_start_km ?? 0));
        return [
          date,
          vehicleLabel,
          item.trip_type || "",
          item.trip_purpose || item.purpose || "",
          item.trip_origin || item.origin || item.start_location || "",
          item.trip_destination || item.destination || item.end_location || "",
          item.mileage_start ?? item.mileage_start_km ?? "",
          item.mileage_end ?? item.mileage_end_km ?? "",
          dist,
        ];
      })
    ];

    const csv = csvRows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "trip-report.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  });

} catch (err) {
  console.error("trip-report initialization error:", err);
  try { document.body.innerHTML = `<div class="card"><div class="empty">Failed to open trip report. See console for details.</div></div>`; } catch(e) {}
}

// small helper used in template if not present globally
function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}
