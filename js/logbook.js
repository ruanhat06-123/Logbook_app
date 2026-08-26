// logbook.js
import "./app.js";
import { notifyServiceDue, requestServiceNotifications, serviceReminderMarkup } from "./serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

if (user) {
  const { data } = await supabase.from("vehicles").select("*").order("number_plate");
  const vehicleList = data || [];

  await shell(
    "logbook",
    `<header class="topbar"><div><div class="eyebrow">Logbook / new fill-up</div><h1>Record a fill-up.</h1></div><div class="top-date"><strong>FUEL ENTRY</strong>Keep it moving</div></header>
    ${vehicleList.map(serviceReminderMarkup).join("")}
    <div class="card" style="max-width:760px">
      <div class="notice">Enter the details of your fuel stop.</div>
      <form id="log-form" class="form-grid">
        <div class="field full">
          <label for="vehicle">Vehicle</label>
          <select id="vehicle" required>
            ${vehicleList.map((item) => `<option value="${item.id}">${item.number_plate} · ${item.make || "Not specified"} ${item.model || ""}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="previous">Mileage at last fill (km)</label>
          <input id="previous" type="number" step="1" placeholder="Auto-populated from last fill">
        </div>
        <div class="field">
          <label for="current">Current mileage (km)</label>
          <input id="current" type="number" step="1" required>
        </div>
        <div class="field">
          <label for="liters">Fuel amount (litres)</label>
          <!-- allow three decimal places -->
          <input id="liters" type="number" step="0.001" inputmode="decimal" pattern="^\\d+(\\.\\d{1,3})?$" required>
        </div>
        <div class="field">
          <label for="price">Price per litre (ZAR)</label>
          <input id="price" type="number" step="0.01" required>
        </div>

        <!-- Calculated total cost display -->
        <div class="field" id="calculated-total-field">
          <label for="calculated-total-value">Calculated total</label>
          <div id="calculated-total-value" class="mono">ZAR 0.00</div>
        </div>

        <div class="field">
          <label for="fuel-type">Fuel type</label>
          <select id="fuel-type">
            <option>Petrol 93</option><option>Petrol 95</option>
            <option>Diesel PPM500</option><option>Diesel PPM50</option><option>Diesel PPM10</option>
          </select>
        </div>
        <div class="field">
          <label for="location">Fuel location</label>
          <input id="location">
        </div>
        <div class="field">
          <label for="date">Date</label>
          <input id="date" type="date" required>
        </div>
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

  const vehicleSelect = document.querySelector("#vehicle");
  const previousInput = document.querySelector("#previous");
  const currentInput = document.querySelector("#current");
  const litersInput = document.querySelector("#liters");
  const priceInput = document.querySelector("#price");
  const totalValueEl = document.querySelector("#calculated-total-value");
  const dateInput = document.querySelector("#date");

  const updateReminderVisibility = () =>
    document.querySelectorAll("[data-service-reminder]").forEach((item) => {
      item.hidden = item.dataset.serviceReminder !== vehicleSelect.value;
    });

  dateInput.value = new Date().toISOString().slice(0, 10);

  // Format money with two decimals
  const formatMoney = (value) =>
    `ZAR ${Number(value || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Live calculation of total cost
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

  async function fetchLastFillMileage(vehicleId) {
    if (!vehicleId) {
      previousInput.value = "";
      return;
    }
    try {
      const { data: lastFill, error: lastErr } = await supabase
        .from("car_logbook")
        .select("current_mileage, created_at")
        .eq("vehicle_id", vehicleId)
        .eq("entry_type", "refuel")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!lastErr && lastFill && Number.isFinite(Number(lastFill.current_mileage))) {
        previousInput.value = Number(lastFill.current_mileage);
        return;
      }

      const { data: vehicleRow, error: vehicleErr } = await supabase
        .from("vehicles")
        .select("current_mileage")
        .eq("id", vehicleId)
        .single();

      if (!vehicleErr && vehicleRow && Number.isFinite(Number(vehicleRow.current_mileage))) {
        previousInput.value = Number(vehicleRow.current_mileage);
        return;
      }

      previousInput.value = "";
    } catch (err) {
      console.error("Error fetching last fill mileage:", err);
      previousInput.value = "";
    }
  }

  vehicleSelect.addEventListener("change", async () => {
    updateReminderVisibility();
    await fetchLastFillMileage(vehicleSelect.value);
  });

  updateReminderVisibility();
  if (vehicleSelect.value) await fetchLastFillMileage(vehicleSelect.value);

  document.querySelector("#log-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const vehicleId = vehicleSelect.value;
    const mileageLastFill = previousInput.value ? Number(previousInput.value) : null;
    const currentMileage = Number(currentInput.value);
    // parse liters allowing up to 3 decimals and store rounded to 3 decimals
    const litersRaw = parseFloat(litersInput.value);
    const liters = Number.isFinite(litersRaw) ? Number(litersRaw.toFixed(3)) : NaN;
    const pricePerLitre = Number(priceInput.value);
    const fuelType = document.querySelector("#fuel-type").value;
    const location = document.querySelector("#location").value;
    const date = document.querySelector("#date").value;

    if (!vehicleId) return window.alert("Please select a vehicle.");
    if (!Number.isFinite(currentMileage)) return window.alert("Please enter a valid current mileage.");
    if (!Number.isFinite(liters) || liters <= 0) return window.alert("Please enter a valid fuel amount (up to 3 decimal places).");
    if (!Number.isFinite(pricePerLitre) || pricePerLitre < 0) return window.alert("Please enter a valid price per litre.");

    const totalCost = Number((liters * pricePerLitre).toFixed(2));

    try {
      const { data: insertData, error: insertErr } = await supabase.from("car_logbook").insert({
        vehicle_id: vehicleId,
        entry_type: "refuel",
        mileage_last_fill: mileageLastFill,
        current_mileage: currentMileage,
        fuel_price: pricePerLitre,
        // store liters with 3 decimal precision
        fuel_amount_liters: liters,
        fuel_location: location || null,
        total_cost: totalCost,
        fuel_type: fuelType,
        created_at: new Date(date),
      }).select().single();

      if (insertErr) {
        console.error("Insert fuel log error:", insertErr);
        return window.alert(insertErr.message || "Failed to save fill-up. Check console for details.");
      }

      const { data: updatedVehicle, error: updateErr } = await supabase.from("vehicles").update({
        current_mileage: currentMileage,
      }).eq("id", vehicleId).eq("user_id", user.id).select().single();

      if (updateErr) {
        console.error("Update vehicle mileage error (logbook):", updateErr);
        window.alert("Fill-up saved but failed to update vehicle mileage. Check console for details.");
      } else {
        const successEl = document.querySelector("#success");
        successEl.hidden = false;
        successEl.textContent = `Fill-up saved. Total: ${formatMoney(totalCost)}. Vehicle odometer updated.`;
        setTimeout(() => window.location.reload(), 900);
      }
    } catch (err) {
      console.error("Unexpected error saving fill-up:", err);
      window.alert("An unexpected error occurred. See console for details.");
    }
  });

  // initialize calculated total on load
  updateCalculatedTotal();
}
