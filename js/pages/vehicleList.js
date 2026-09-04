import "../core/app.js";
import {
  notifyServiceDue,
  requestServiceNotifications,
  serviceReminderMarkup,
} from "../core/serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

const currentVehicles = (await vehicles()) || [];
const { data: serviceRows = [] } = await supabase
  .from("service_records")
  .select("*, service_record_files(*)")
  .order("service_date", { ascending: false });
const vehicleMarkup = currentVehicles.length
  ? currentVehicles.map((item) => {
      const nextService = Number(item.next_service_mileage);
      const remaining = Number.isFinite(nextService)
        ? nextService - Number(item.current_mileage || 0)
        : null;
      const distanceLabel = remaining === null
        ? "Service distance not entered"
        : remaining <= 0
          ? `Service overdue by ${Math.abs(remaining).toLocaleString()} km`
          : `${remaining.toLocaleString()} km to next service`;
      return `<article class="vehicle-row">
        <div class="vehicle-identity">
          <div class="car-icon">⌁</div>
          <div>
            <div class="row-title">${escapeHtml(item.make || "Vehicle make not specified")} ${escapeHtml(item.model || "")}</div>
            <div class="vehicle-plate">${escapeHtml(item.number_plate || "Number plate not specified")}</div>
          </div>
        </div>
        <div class="vehicle-details">
          <div class="vehicle-detail"><span>Current mileage</span><strong>${Number(item.current_mileage || 0).toLocaleString()} km</strong></div>
          <div class="vehicle-detail"><span>Last service</span><strong>${item.last_service_mileage ? `${Number(item.last_service_mileage).toLocaleString()} km` : "Not entered"}</strong></div>
          <div class="vehicle-detail"><span>Next service</span><strong>${item.next_service_mileage ? `${nextService.toLocaleString()} km` : "Not entered"}</strong><small class="${remaining !== null && remaining <= 0 ? "service-overdue" : ""}">${escapeHtml(distanceLabel)}</small></div>
        </div>
        <div class="row-actions vehicle-actions">
          <a class="btn btn-small" href="logbook.html?vehicle=${encodeURIComponent(item.id)}">＋ Fill-up</a>
          <a class="btn btn-small" href="trip.html?vehicle=${encodeURIComponent(item.id)}">↗ Trip</a>
          <button class="btn btn-small" type="button" data-service-history="${escapeHtml(item.id)}">Service history</button>
          <button class="icon-button" type="button" data-edit-vehicle="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.number_plate || "")}" title="Edit vehicle">✎</button>
          <button class="icon-button" type="button" data-delete-vehicle="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.number_plate || "")}" title="Remove vehicle">×</button>
        </div>
      </article>`;
    }).join("")
  : '<div class="empty">No vehicles yet. Add a vehicle to begin.</div>';

await shell("vehicles", `
  <header class="topbar">
    <div><div class="eyebrow">Vehicle management</div><h1>Your vehicles.</h1></div>
    <div class="top-date"><strong>VEHICLE LIST</strong>${currentVehicles.length} active vehicle${currentVehicles.length === 1 ? "" : "s"}</div>
  </header>
  ${currentVehicles.map(serviceReminderMarkup).join("")}
  <section class="card" id="vehicles">
    <div class="card-head"><h2>Vehicles</h2><a class="btn btn-primary" href="add-vehicle.html">Add vehicle →</a></div>
    ${vehicleMarkup}
  </section>
`);

await requestServiceNotifications();
currentVehicles.forEach(notifyServiceDue);

document.querySelectorAll("[data-service-history]").forEach((button) => {
  button.addEventListener("click", () => {
    const vehicle = currentVehicles.find((item) => String(item.id) === String(button.dataset.serviceHistory));
    const records = serviceRows.filter((record) => String(record.vehicle_id) === String(vehicle.id));
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal service-modal" role="dialog" aria-modal="true" aria-labelledby="service-history-title"><div class="modal-head"><div><h2 id="service-history-title">${escapeHtml(vehicle.make || "Vehicle")} ${escapeHtml(vehicle.model || "")}</h2><div class="row-sub">Service history · ${escapeHtml(vehicle.number_plate || "")}</div></div><button class="modal-close" type="button" aria-label="Close">×</button></div><div class="service-record-list">${records.length ? records.map((record) => `<article class="service-record"><div class="service-record-head"><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(record.service_date || "")}</span></div><div class="row-sub">${record.mileage == null ? "Mileage not entered" : `${Number(record.mileage).toLocaleString()} km`}${record.invoice_amount == null ? "" : ` · R ${Number(record.invoice_amount).toFixed(2)}`}</div>${record.notes ? `<p>${escapeHtml(record.notes)}</p>` : ""}<div class="service-files">${(record.service_record_files || []).map((file) => `<button class="service-file" type="button" data-file-path="${escapeHtml(file.file_path)}">${escapeHtml(file.file_name)}</button>`).join("")}</div></article>`).join("") : '<div class="empty">No service history recorded yet.</div>'}</div><form id="service-record-form" class="form-grid"><div class="field"><label for="service-title">Service title</label><input id="service-title" placeholder="Annual service" required></div><div class="field"><label for="service-date">Date</label><input id="service-date" type="date" required></div><div class="field"><label for="service-mileage">Mileage (km)</label><input id="service-mileage" type="number" min="0"></div><div class="field"><label for="service-amount">Invoice amount (R)</label><input id="service-amount" type="number" min="0" step="0.01"></div><div class="field full"><label for="service-notes">Notes</label><textarea id="service-notes" rows="3" placeholder="Work completed, parts replaced, or warranty details"></textarea></div><div class="field full"><label for="service-files">Invoices or photos</label><input id="service-files" type="file" accept="image/*,.pdf" multiple><small class="field-help">You can upload photos, invoices, or both.</small></div><div class="form-actions field full"><button class="btn btn-secondary modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save service record →</button></div></form></div>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector(".modal-close").addEventListener("click", close);
    backdrop.querySelector(".modal-cancel").addEventListener("click", close);
    backdrop.querySelectorAll("[data-file-path]").forEach((fileButton) => fileButton.addEventListener("click", async () => {
      const { data, error } = await supabase.storage.from("service-documents").createSignedUrl(fileButton.dataset.filePath, 300);
      if (error) return window.alert(error.message);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    }));
    const reportActions = document.createElement("div");
    reportActions.className = "service-report-actions";
    reportActions.innerHTML = '<button class="btn btn-secondary" type="button">Download CSV</button><button class="btn btn-secondary" type="button">Print report</button>';
    backdrop.querySelector(".modal-head").after(reportActions);
    reportActions.children[0].addEventListener("click", () => {
      const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const csv = [["Date", "Service", "Mileage (km)", "Invoice amount (R)", "Notes"], ...records.map((record) => [record.service_date, record.title, record.mileage, record.invoice_amount, record.notes])].map((row) => row.map(quote).join(",")).join("\n");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      link.download = `service-history-${vehicle.number_plate || "vehicle"}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    });
    reportActions.children[1].addEventListener("click", () => {
      const printWindow = window.open("", "_blank", "noopener,noreferrer");
      if (!printWindow) return window.alert("Allow pop-ups to print the service report.");
      printWindow.document.write(`<title>Service history</title><h1>Service history</h1><p>${escapeHtml(vehicle.make || "")} ${escapeHtml(vehicle.model || "")} · ${escapeHtml(vehicle.number_plate || "")}</p><table border="1" cellspacing="0" cellpadding="8"><tr><th>Date</th><th>Service</th><th>Mileage</th><th>Invoice amount</th><th>Notes</th></tr>${records.map((record) => `<tr><td>${escapeHtml(record.service_date || "")}</td><td>${escapeHtml(record.title)}</td><td>${record.mileage == null ? "" : `${Number(record.mileage).toLocaleString()} km`}</td><td>${record.invoice_amount == null ? "" : `R ${Number(record.invoice_amount).toFixed(2)}`}</td><td>${escapeHtml(record.notes || "")}</td></tr>`).join("")}</table>`);
      printWindow.document.close();
      printWindow.print();
    });
    backdrop.querySelector("#service-date").value = new Date().toISOString().slice(0, 10);
    backdrop.querySelector("#service-record-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      const { data: record, error } = await supabase.from("service_records").insert({
        user_id: user.id,
        vehicle_id: vehicle.id,
        title: form.querySelector("#service-title").value.trim(),
        service_date: form.querySelector("#service-date").value,
        mileage: form.querySelector("#service-mileage").value ? Number(form.querySelector("#service-mileage").value) : null,
        invoice_amount: form.querySelector("#service-amount").value ? Number(form.querySelector("#service-amount").value) : null,
        notes: form.querySelector("#service-notes").value.trim() || null,
      }).select().single();
      if (error) return window.alert(error.message);
      const files = Array.from(form.querySelector("#service-files").files || []);
      for (const file of files) {
        const path = `${user.id}/${vehicle.id}/${crypto.randomUUID()}-${file.name}`;
        const upload = await supabase.storage.from("service-documents").upload(path, file, { upsert: false });
        if (upload.error) return window.alert(upload.error.message);
        const fileInsert = await supabase.from("service_record_files").insert({ service_record_id: record.id, user_id: user.id, file_path: path, file_name: file.name, content_type: file.type || "application/octet-stream" });
        if (fileInsert.error) return window.alert(fileInsert.error.message);
      }
      window.location.reload();
    });
  });
});

document.querySelectorAll("[data-delete-vehicle]").forEach((button) =>
  button.addEventListener("click", async () => {
    const item = currentVehicles.find((entry) => String(entry.id) === String(button.dataset.deleteVehicle));
    if (!item || !window.confirm(`Remove ${item.number_plate}? Its logs will also be removed.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", item.id);
    if (error) return window.alert(error.message);
    window.location.reload();
  }),
);

document.querySelectorAll("[data-edit-vehicle]").forEach((button) =>
  button.addEventListener("click", () => {
    const item = currentVehicles.find((entry) => String(entry.id) === String(button.dataset.editVehicle));
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-vehicle-title"><div class="modal-head"><h2 id="edit-vehicle-title">Edit vehicle</h2><button class="modal-close" type="button" aria-label="Close">×</button></div><form id="edit-vehicle-form" class="form-grid"><div class="field"><label for="edit-plate">Number plate</label><input id="edit-plate" value="${escapeHtml(item.number_plate || "")}" required></div><div class="field"><label for="edit-make">Make</label><input id="edit-make" value="${escapeHtml(item.make || "")}" required></div><div class="field"><label for="edit-model">Model</label><input id="edit-model" value="${escapeHtml(item.model || "")}" required></div><div class="field"><label for="edit-year">Year</label><input id="edit-year" type="number" min="1886" max="2200" value="${escapeHtml(item.year || "")}"></div><div class="field"><label for="edit-mileage">Current mileage (km)</label><input id="edit-mileage" type="number" min="0" value="${escapeHtml(item.current_mileage || 0)}" required></div><div class="field"><label for="edit-last-service">Last service mileage (km)</label><input id="edit-last-service" type="number" min="0" value="${escapeHtml(item.last_service_mileage || "")}"></div><div class="field"><label for="edit-next-service">Next service mileage (km)</label><input id="edit-next-service" type="number" min="0" value="${escapeHtml(item.next_service_mileage || "")}"></div><div class="form-actions field full"><button class="btn btn-secondary modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save changes →</button></div></form></div>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector(".modal-close").addEventListener("click", close);
    backdrop.querySelector(".modal-cancel").addEventListener("click", close);
    backdrop.querySelector("#edit-vehicle-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const { error } = await supabase.from("vehicles").update({
        number_plate: backdrop.querySelector("#edit-plate").value.trim().toUpperCase(),
        make: backdrop.querySelector("#edit-make").value.trim(),
        model: backdrop.querySelector("#edit-model").value.trim(),
        year: backdrop.querySelector("#edit-year").value || null,
        current_mileage: Number(backdrop.querySelector("#edit-mileage").value),
        last_service_mileage: backdrop.querySelector("#edit-last-service").value ? Number(backdrop.querySelector("#edit-last-service").value) : null,
        next_service_mileage: backdrop.querySelector("#edit-next-service").value ? Number(backdrop.querySelector("#edit-next-service").value) : null,
      }).eq("id", item.id);
      if (error) return window.alert(error.message);
      window.location.reload();
    });
  }),
);
