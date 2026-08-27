// logbook.js
import "./app.js";
import { notifyServiceDue, requestServiceNotifications, serviceReminderMarkup } from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

if (user) {
  // Fetch vehicles only (no report UI here)
  const { data: vehiclesData, error: vErr } = await supabase.from("vehicles").select("*").order("number_plate");
  if (vErr) console.error("vehicles fetch error:", vErr);

  const vehicleList = vehiclesData || [];

  await shell(
    "logbook",
    `<header class="topbar"><div><div class="eyebrow">Logbook / new fill-up</div><h1>Record a fill-up.</h1></div><div class="top-date"><strong>FUEL ENTRY</strong>Keep it moving</div></header>
    ${vehicleList.map(serviceReminderMarkup).join("")}
    <div class="card" style="max-width:760px">
      <div class="notice">Enter the details of your fuel stop. You can enter consumption manually or let the system calculate it when distance is available.</div>
      <form id="log-form" class="form-grid">
        <div class="field full">
          <label for="vehicle">Vehicle</label>
          <select id="vehicle" required>
            <option value="">Select a vehicle</option>
            ${vehicleList.map((item) => `<option value="${item.id}" data-current-mileage="${Number.isFinite(Number(item.current_mileage)) ? Number(item.current_mileage) : ""}">${escapeHtml(item.number_plate || "")} · ${escapeHtml(item.make || "")} ${escapeHtml(item.model || "")}</option>`).join("")}
          </select>
        </div>

        <div class="field"><label for="previous">Mileage at last fill (km)</label><input id="previous" type="number" step="1" placeholder="Auto-populated from last fill"></div>
        <div class="field"><label for="current">Current mileage (km)</label><input id="current" type="number" step="1" required></div>
        <div class="field"><label for="liters">Fuel amount (litres)</label><input id="liters" type="number" step="0.001" inputmode="decimal" pattern="^\\d+(\\.\\d{1,3})?$" required></div>
        <div class="field"><label for="price">Price per litre (ZAR)</label><input id="price" type="number" step="0.01" required></div>

        <div class="field" id="calculated-total-field">
          <label for="calculated-total-value">Calculated total</label>
          <div id="calculated-total-value" class="mono">ZAR 0.00</div>
        </div>

        <div class="field"><label for="fuel-type">Fuel type</label><select id="fuel-type"><option>Petrol 93</option><option>Petrol 95</option><option>Diesel PPM500</option><option>Diesel PPM50</option><option>Diesel PPM10</option></select></div>
        <div class="field"><label for="location">Fuel location</label><input id="location"></div>
        <div class="field"><label for="date">Date</label><input id="date" type="date" required></div>

        <hr style="grid-column: 1 / -1; border: none; height: 1px; background:#eee; margin:8px 0;">

        <div class="field"><label for="consumption-manual">Consumption (L/100km) — optional</label><input id="consumption-manual" type="number" step="0.001" inputmode="decimal" placeholder="Enter L/100km if known"></div>
        <div class="field"><label for="efficiency-manual">Efficiency (km/L) — optional</label><input id="efficiency-manual" type="number" step="0.001" inputmode="decimal" placeholder="Enter km/L if known"></div>
        <div class="field full"><div class="notice">If you enter either consumption or efficiency manually, the other value will be derived from it. If both are left blank the system will calculate consumption when distance since last fill is available.</div></div>

        <div class="form-actions field full">
          <a href="vehicles.html" class="btn btn-secondary">Cancel</a>
          <button class="btn btn-primary" type="submit">Save fill-up →</button>
        </div>
      </form>
      <div id="success" class="notice" hidden></div>
    </div>`
  );

  await requestServiceNotifications();
  vehicleList.forEach(notifyServiceDue);

  // DOM refs
  const vehicleSelect = document.querySelector("#vehicle");
  const previousInput = document.querySelector("#previous");
  const currentInput = document.querySelector("#current");
  const litersInput = document.querySelector("#liters");
  const priceInput = document.querySelector("#price");
  const totalValueEl = document.querySelector("#calculated-total-value");
  const dateInput = document.querySelector("#date");
  const successEl = document.querySelector("#success");
  const consumptionManualInput = document.querySelector("#consumption-manual");
  const efficiencyManualInput = document.querySelector("#efficiency-manual");

  // Helpers
  const formatMoney = (value) =>
    `ZAR ${Number(value || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  function updateCalculatedTotal() {
    const liters = parseFloat(litersInput.value);
    const price = parseFloat(priceInput.value);
    if (!Number.isFinite(liters) || liters <= 0 || !Number.isFinite(price) || price < 0) {
      totalValueEl.textContent = formatMoney(0);
      return;
    }
    const total = liters * price;
    totalValueEl.textContent = formatMoney(total);
  }

  litersInput.addEventListener("input", updateCalculatedTotal);
  priceInput.addEventListener("input", updateCalculatedTotal);

  // Populate previous mileage from last refuel or vehicle row
  async function fetchLastFillMileage(vehicleId) {
    previousInput.value = "";
    if (!vehicleId) return;
    const option = vehicleSelect.querySelector(`option[value="${vehicleId}"]`);
    if (option && option.dataset.currentMileage) {
      previousInput.value = option.dataset.currentMileage;
      return;
    }
    try {
      const { data: lastFill } = await supabase
        .from("car_logbook")
        .select("current_mileage, created_at")
        .eq("vehicle_id", vehicleId)
        .eq("entry_type", "refuel")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (lastFill && Number.isFinite(Number(lastFill.current_mileage))) {
        previousInput.value = Number(lastFill.current_mileage);
        return;
      }
      const { data: vehicleRow } = await supabase.from("vehicles").select("current_mileage").eq("id", vehicleId).single();
      if (vehicleRow && Number.isFinite(Number(vehicleRow.current_mileage))) {
        previousInput.value = Number(vehicleRow.current_mileage);
        return;
      }
    } catch (err) {
      console.error("Error fetching last fill mileage:", err);
    }
  }

  vehicleSelect.addEventListener("change", async () => {
    await fetchLastFillMileage(vehicleSelect.value);
  });

  // Initialize date and previous mileage
  dateInput.value = new Date().toISOString().slice(0, 10);
  if (vehicleSelect.value) await fetchLastFillMileage(vehicleSelect.value);
  updateCalculatedTotal();

  // Compute consumption helpers
  const computeFromLitresAndDistance = (litres, distanceKm) => {
    if (!Number.isFinite(litres) || litres <= 0) return { lPer100: null, kmPerL: null };
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return { lPer100: null, kmPerL: null };
    const lPer100 = Number(((litres / distanceKm) * 100).toFixed(3));
    const kmPerL = Number((distanceKm / litres).toFixed(3));
    return { lPer100, kmPerL };
  };

  const computeFromConsumption = (lPer100) => {
    if (!Number.isFinite(lPer100) || lPer100 <= 0) return { lPer100: null, kmPerL: null };
    const kmPerL = Number((100 / lPer100).toFixed(3));
    return { lPer100: Number(lPer100.toFixed(3)), kmPerL };
  };

  const computeFromEfficiency = (kmPerL) => {
    if (!Number.isFinite(kmPerL) || kmPerL <= 0) return { lPer100: null, kmPerL: null };
    const lPer100 = Number(((1 / kmPerL) * 100).toFixed(3));
    return { lPer100, kmPerL: Number(kmPerL.toFixed(3)) };
  };

  // When user types a manual consumption, derive the other field
  consumptionManualInput?.addEventListener("input", () => {
    const val = parseFloat(consumptionManualInput.value);
    if (Number.isFinite(val) && val > 0) {
      const derived = computeFromConsumption(val);
      efficiencyManualInput.value = derived.kmPerL ?? "";
    } else {
      efficiencyManualInput.value = "";
    }
  });

  efficiencyManualInput?.addEventListener("input", () => {
    const val = parseFloat(efficiencyManualInput.value);
    if (Number.isFinite(val) && val > 0) {
      const derived = computeFromEfficiency(val);
      consumptionManualInput.value = derived.lPer100 ?? "";
    } else {
      consumptionManualInput.value = "";
    }
  });

  // Submit handler: accept manual consumption or compute when possible
  document.querySelector("#log-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const vehicleId = vehicleSelect.value;
    const mileageLastFill = previousInput.value ? Number(previousInput.value) : null;
    const currentMileage = Number(currentInput.value);
    const litersRaw = parseFloat(litersInput.value);
    const liters = Number.isFinite(litersRaw) ? Number(litersRaw.toFixed(3)) : NaN;
    const pricePerLitre = Number(priceInput.value);
    const fuelType = document.querySelector("#fuel-type").value;
    const location = document.querySelector("#location").value || null;
    const date = document.querySelector("#date").value;

    // Manual consumption inputs (may be empty)
    const manualConsumptionRaw = consumptionManualInput.value ? parseFloat(consumptionManualInput.value) : null;
    const manualEfficiencyRaw = efficiencyManualInput.value ? parseFloat(efficiencyManualInput.value) : null;
    const manualConsumption = Number.isFinite(manualConsumptionRaw) ? Number(manualConsumptionRaw.toFixed(3)) : null;
    const manualEfficiency = Number.isFinite(manualEfficiencyRaw) ? Number(manualEfficiencyRaw.toFixed(3)) : null;

    if (!vehicleId) return window.alert("Please select a vehicle.");
    if (!Number.isFinite(currentMileage)) return window.alert("Please enter a valid current mileage.");
    if (!Number.isFinite(liters) || liters <= 0) return window.alert("Please enter a valid fuel amount (up to 3 decimal places).");
    if (!Number.isFinite(pricePerLitre) || pricePerLitre < 0) return window.alert("Please enter a valid price per litre.");

    // distance since last fill (guard against missing last fill)
    const distanceSinceLastFill = (Number.isFinite(mileageLastFill) && mileageLastFill !== null)
      ? Math.max(0, currentMileage - Number(mileageLastFill))
      : null;

    // Determine consumption/efficiency to store:
    // Priority:
    // 1) If user provided manualConsumption or manualEfficiency, use those (derive the other).
    // 2) Else if distanceSinceLastFill available, compute from litres and distance.
    // 3) Else store nulls.
    let lPer100 = null;
    let kmPerL = null;

    if (manualConsumption !== null) {
      const derived = computeFromConsumption(manualConsumption);
      lPer100 = derived.lPer100;
      kmPerL = derived.kmPerL;
    } else if (manualEfficiency !== null) {
      const derived = computeFromEfficiency(manualEfficiency);
      lPer100 = derived.lPer100;
      kmPerL = derived.kmPerL;
    } else if (distanceSinceLastFill !== null && distanceSinceLastFill > 0) {
      const derived = computeFromLitresAndDistance(liters, distanceSinceLastFill);
      lPer100 = derived.lPer100;
      kmPerL = derived.kmPerL;
    }

    const totalCost = Number((liters * pricePerLitre).toFixed(2));

    try {
      const { data: insertData, error: insertErr } = await supabase.from("car_logbook").insert({
        vehicle_id: vehicleId,
        entry_type: "refuel",
        mileage_last_fill: mileageLastFill,
        current_mileage: currentMileage,
        fuel_price: pricePerLitre,
        price_per_litre: pricePerLitre,
        fuel_amount_liters: liters,
        fuel_location: location,
        total_cost: totalCost,
        fuel_type: fuelType,
        fuel_consumption_l_per_100km: lPer100,
        fuel_efficiency_km_per_l: kmPerL,
        created_at: new Date(date),
      }).select().single();

      if (insertErr) {
        console.error("Insert fuel log error:", insertErr);
        return window.alert(insertErr.message || "Failed to save fill-up. Check console for details.");
      }

      // update vehicle current_mileage
      const { error: updateErr } = await supabase.from("vehicles").update({
        current_mileage: currentMileage,
      }).eq("id", vehicleId).eq("user_id", user.id);

      if (updateErr) {
        console.error("Update vehicle mileage error (logbook):", updateErr);
        window.alert("Fill-up saved but failed to update vehicle mileage. Check console for details.");
      } else {
        successEl.hidden = false;
        const consumptionText = lPer100 === null ? "—" : `${lPer100} L/100km`;
        const efficiencyText = kmPerL === null ? "—" : `${kmPerL} km/L`;
        successEl.textContent = `Fill-up saved. Total: ${formatMoney(totalCost)}. Consumption: ${consumptionText} · ${efficiencyText}.`;
        // reset form fields (keep vehicle selected)
        litersInput.value = "";
        priceInput.value = "";
        currentInput.value = "";
        consumptionManualInput.value = "";
        efficiencyManualInput.value = "";
        previousInput.value = currentMileage;
        setTimeout(() => { successEl.hidden = true; }, 4000);
      }
    } catch (err) {
      console.error("Unexpected error saving fill-up:", err);
      window.alert("An unexpected error occurred. See console for details.");
    }
  });
}

// small helper used in template
function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}
