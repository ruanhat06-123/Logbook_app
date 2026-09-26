import "../core/app.js";
import { getFleetContext, isFleetAdmin } from "../core/fleetAccess.js";
import { scanComplianceBarcode } from "../core/barcodeScanner.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");
const fleetContext = await getFleetContext(user);

await shell("add-vehicle", `
  <header class="topbar">
    <div>
      <div class="eyebrow">Vehicle management</div>
      <h1>Add a vehicle.</h1>
    </div>
    <div class="top-date"><strong>VEHICLE PROFILE</strong>Service mileage included</div>
  </header>
  <div class="card" style="max-width:760px">
    <div class="card-head"><h2>Vehicle details</h2></div>
    <form id="vehicle-form" class="form-grid">
      <div class="field full"><button class="btn btn-secondary" id="scan-compliance" type="button">Scan licence disc / PrDP</button><video id="compliance-camera" autoplay playsinline muted hidden style="width:100%;max-height:220px;border-radius:6px;margin-top:8px"></video><small class="field-help">Scanning is optional and depends on browser/device barcode support. Review all captured values before saving.</small></div>
      <div class="field"><label for="plate">Number plate</label><input name="plate" id="plate" required></div>
      <div class="field"><label for="make">Make</label><input name="make" id="make" required></div>
      <div class="field"><label for="model">Model</label><input name="model" id="model" required></div>
        <div class="field full"><label for="primary-use">Main use</label><select name="primary-use" id="primary-use" required><option value="personal">Mostly personal</option><option value="business">Mostly business</option></select></div>
      <div class="field"><label for="year">Year</label><input name="year" id="year" type="number" min="1886" max="2200"></div>
      <div class="field"><label for="last-service">Last service mileage (km)</label><input name="last-service" id="last-service" type="number" min="0"></div>
      <div class="field"><label for="next-service">Next service mileage (km)</label><input name="next-service" id="next-service" type="number" min="0"></div>
      <div class="field"><label for="mileage">Current mileage (km)</label><input name="mileage" id="mileage" type="number" min="0" required></div>
      <div class="field"><label for="vin">VIN</label><input name="vin" id="vin"></div>
      <div class="field"><label for="engine-number">Engine number</label><input name="engine-number" id="engine-number"></div>
      <div class="field"><label for="licence-disc-expiry">Licence disc expiry</label><input name="licence-disc-expiry" id="licence-disc-expiry" type="date"></div>
      <div class="form-actions field full"><a href="vehicles.html" class="btn btn-secondary">Cancel</a><button class="btn btn-primary" type="submit">Add vehicle →</button></div>
    </form>
    <div id="vehicle-notice" class="notice" hidden></div>
  </div>
`);

document.querySelector("#scan-compliance").addEventListener("click", async () => {
  const button = document.querySelector("#scan-compliance");
  const video = document.querySelector("#compliance-camera");
  button.disabled = true;
  try {
    await scanComplianceBarcode(video, (values) => {
      const get = (...keys) => keys.map((key) => values[key] ?? values[key.replaceAll("_", "")] ?? values[key.toUpperCase()]).find(Boolean) || "";
      const plate = get("number_plate", "numberplate", "registration", "plate");
      const vin = get("vin", "vehicleidentificationnumber");
      const engine = get("engine_number", "enginenumber");
      const expiry = get("licence_disc_expiry_date", "licencediscexpiry", "expiry_date");
      if (plate) document.querySelector("#plate").value = plate.toUpperCase();
      if (vin) document.querySelector("#vin").value = vin;
      if (engine) document.querySelector("#engine-number").value = engine;
      if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) document.querySelector("#licence-disc-expiry").value = expiry;
      const notice = document.querySelector("#vehicle-notice");
      notice.hidden = false;
      notice.textContent = "Barcode captured. Review the vehicle details before saving.";
    });
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#vehicle-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const { error } = await supabase.from("vehicles").insert({
    user_id: user.id,
    fleet_id: isFleetAdmin(fleetContext) ? fleetContext.fleetId : null,
    number_plate: form.plate.value.trim().toUpperCase(),
    make: form.make.value.trim(),
    model: form.model.value.trim(),
      primary_use: form["primary-use"].value,
    year: form.year.value || null,
    last_service_mileage: form["last-service"].value ? Number(form["last-service"].value) : null,
    current_mileage: Number(form.mileage.value),
    next_service_mileage: form["next-service"].value ? Number(form["next-service"].value) : null,
    vin: form.vin.value.trim() || null,
    engine_number: form["engine-number"].value.trim() || null,
    licence_disc_expiry_date: form["licence-disc-expiry"].value || null,
  });
  if (error) {
    const notice = document.querySelector("#vehicle-notice");
    notice.hidden = false;
    notice.textContent = error.message;
    return;
  }
  globalThis.LogMateUI?.navigateTo("app.html?page=vehicles");
});
