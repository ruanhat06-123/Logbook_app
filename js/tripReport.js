// trip-report.js
import "./app.js";
import { requestServiceNotifications, notifyServiceDue } from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

try {
  const [vehiclesResp, tripsResp, logbookTripsResp] = await Promise.all([
    supabase.from("vehicles").select("*").order("number_plate"),
    supabase.from("trips").select("*").order("created_at", { ascending: false }),
    supabase.from("car_logbook").select("*").eq("entry_type", "trip").order("created_at", { ascending: false }),
  ]);

  console.group("trip-report fetch results");
  console.log("vehiclesResp:", vehiclesResp);
  console.log("tripsResp:", tripsResp);
  console.log("logbookTripsResp:", logbookTripsResp);
  console.groupEnd();

  const vehicleRows = vehiclesResp.data || [];
  const tripRows = (tripsResp.data && tripsResp.data.length) ? tripsResp.data : (logbookTripsResp.data || []);

  const today = new Date();
  const inputDate = (d) => d.toISOString().slice(0, 10);

  await shell(
    "trip-report",
    `<header class="topbar"><div><div class="eyebrow">Insights / trip reports</div><h1>Track every journey.</h1></div><div class="top-date"><strong>TRIP REPORT</strong>Odometer-led</div></header>
    <div class="card">
      <div class="report-controls">
        <div class="field"><label for="vehicle-filter">Vehicle</label><select id="vehicle-filter"><option value="all">All vehicles</option>${vehicleRows.map(v => `<option value="${v.id}">${(v.number_plate||"").replace(/</g,"&lt;")}</option>`).join("")}</select></div>
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

  const safeVehicle = globalThis.vehicle || ((list, id) => (list || []).find(v => String(v.id) === String(id)));
  const safeDateText = globalThis.dateText || (d => d ? new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "");
  const safeEscape = globalThis.escapeHtml || (s => String(s||"").replace(/[&<>'"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c])));

  const toISODate = (val) => {
    if (!val) return "";
    const dt = (val instanceof Date) ? val : new Date(val);
    return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0,10);
  };

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
      const itemVehicle = normalizeId(item.vehicle_id);
      const vehicleMatch = vehicleId === "all" || itemVehicle === normalizeId(vehicleId);
      const typeMatch = tripType === "all" || String(item.trip_type||"").toLowerCase() === tripType;
      const purposeMatch = purpose === "all" || String(item.trip_purpose || item.purpose || "").toLowerCase() === purpose;
      const dateMatch = created && created >= start && created <= end;
      return vehicleMatch && typeMatch && purposeMatch && dateMatch;
    });
  };

  const draw = () => {
    try {
      const rows = filteredRows();
      const distance = rows.reduce((s,i) => s + Number(i.trip_distance_km || i.distance_km || 0), 0);
      const business = rows.filter(i => String(i.trip_type) === "business").reduce((s,i) => s + Number(i.trip_distance_km || i.distance_km || 0), 0);
      const personal = rows.filter(i => String(i.trip_type) === "personal").reduce((s,i) => s + Number(i.trip_distance_km || i.distance_km || 0), 0);

      outputEl.innerHTML = `
        <div class="total-strip">
          <div class="total-box"><label>Total trips</label><strong>${rows.length}</strong></div>
          <div class="total-box"><label>Total distance</label><strong>${distance.toLocaleString()} km</strong></div>
          <div class="total-box"><label>Business / personal</label><strong>${business.toLocaleString()} / ${personal.toLocaleString()} km</strong></div>
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>
          <th>Date</th><th>Vehicle</th><th>Type</th><th>Purpose</th><th>Origin</th><th>Destination</th><th>Start odometer</th><th>End odometer</th><th>Distance</th>
        </tr></thead><tbody>
        ${rows.map(item => {
          const vehicleLabel = safeVehicle(vehicleRows, item.vehicle_id)?.number_plate || "—";
          const dateLabel = safeDateText(item.created_at);
          const start = Number(item.mileage_start ?? item.mileage_start_km ?? 0).toLocaleString();
          const end = Number(item.mileage_end ?? item.mileage_end_km ?? 0).toLocaleString();
          const dist = Number(item.trip_distance_km ?? item.distance_km ?? 0).toLocaleString();
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
            <td class="mono">${start} km</td>
            <td class="mono">${end} km</td>
            <td class="mono">${dist} km</td>
          </tr>`;
        }).join("")}
        </tbody></table></div>` : `<div class="empty">No trips match this filter.</div>`}
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
    const header = ["Date","Vehicle","Trip type","Purpose","Origin","Destination","Start odometer (km)","End odometer (km)","Distance (km)"];
    const csvRows = [header, ...rows.map(item => [
      toISODate(item.created_at),
      safeVehicle(vehicleRows, item.vehicle_id)?.number_plate || "",
      item.trip_type || "",
      item.trip_purpose || item.purpose || "",
      item.trip_origin || item.origin || item.start_location || "",
      item.trip_destination || item.destination || item.end_location || "",
      item.mileage_start ?? item.mileage_start_km ?? "",
      item.mileage_end ?? item.mileage_end_km ?? "",
      item.trip_distance_km ?? item.distance_km ?? ""
    ])];
    const csv = csvRows.map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
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
