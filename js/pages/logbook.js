// logbook.js
import "../core/app.js";
import {
  notifyServiceDue,
  requestServiceNotifications,
  serviceReminderMarkup,
} from "../core/serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

if (user) {
  // Fetch vehicles list
  const { data: vehiclesData, error: vErr } = await supabase
    .from("vehicles")
    .select("*")
    .order("number_plate");
  if (vErr) console.error("vehicles fetch error:", vErr);

  const vehicleRows = vehiclesData || [];

  // For each vehicle, fetch the latest car_logbook entry (refuel) to get the most recent current_mileage
  async function attachLatestMileage(rows) {
    return await Promise.all(
      rows.map(async (row) => {
        try {
          const { data: lastFill } = await supabase
            .from("car_logbook")
            .select("current_mileage, created_at")
            .eq("vehicle_id", row.id)
            .eq("entry_type", "refuel")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          return {
            ...row,
            latest_logbook_mileage: Number.isFinite(
              Number(lastFill?.current_mileage),
            )
              ? Number(lastFill.current_mileage)
              : null,
          };
        } catch (err) {
          return { ...row, latest_logbook_mileage: null };
        }
      }),
    );
  }

  const vehicleList = await attachLatestMileage(vehicleRows);

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
            ${vehicleList
              .map(
                (item) =>
                  `<option value="${item.id}" data-current-mileage="${item.latest_logbook_mileage ?? ""}">${escapeHtml(
                    item.number_plate || "",
                  )} · ${escapeHtml(item.make || "")} ${escapeHtml(item.model || "")}</option>`,
              )
              .join("")}
          </select>
        </div>

        <div class="field"><label for="previous">Mileage at last fill (km)</label><input id="previous" type="number" step="1" placeholder="Auto-populated from last fill"></div>
        <div class="field"><label for="current">Current mileage (km)</label><input id="current" type="number" step="1" required></div>
        <div class="field"><label for="liters">Fuel amount (litres)</label><input id="liters" type="number" step="0.001" inputmode="decimal" pattern="^\\d+(\\.\\d{1,3})?$" required></div>
        <div class="field"><label for="price">Price per litre (R)</label><input id="price" type="number" step="0.01" required><small id="price-hint" class="field-help">Checking the latest regional price...</small></div>

        <div class="field" id="calculated-total-field">
          <label for="calculated-total-value">Calculated total</label>
          <div id="calculated-total-value" class="mono">R 0.00</div>
        </div>

        <div class="field"><label for="fuel-type">Fuel type</label><select id="fuel-type"><option>Petrol 93</option><option>Petrol 95</option><option>Diesel PPM500</option><option>Diesel PPM50</option><option>Diesel PPM10</option></select></div>

        <div class="field" style="display:flex;gap:8px;align-items:flex-end;">
          <div style="flex:1">
            <label for="location">Fuel location</label>
            <input id="location" placeholder="City, station or coordinates">
            <div id="location-hint" style="font-size:12px;color:#666;margin-top:6px;display:none"></div>
          </div>
          <div style="width:140px">
            <label>&nbsp;</label>
            <button id="detect-location" type="button" class="btn btn-secondary" style="width:100%">Detect location</button>
          </div>
        </div>

        <div id="location-status" class="notice" hidden></div>

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
    </div>`,
  );

  await requestServiceNotifications();
  vehicleList.forEach(notifyServiceDue);

  // DOM refs
  const vehicleSelect = document.querySelector("#vehicle");
  const requestedVehicle = new URLSearchParams(window.location.search).get("vehicle");
  const preferredVehicle = requestedVehicle || localStorage.getItem("defaultVehicle");
  if (preferredVehicle && vehicleSelect.querySelector(`option[value="${preferredVehicle}"]`)) {
    vehicleSelect.value = preferredVehicle;
  }
  const previousInput = document.querySelector("#previous");
  const currentInput = document.querySelector("#current");
  const litersInput = document.querySelector("#liters");
  const priceInput = document.querySelector("#price");
  const fuelTypeInput = document.querySelector("#fuel-type");
  const priceHint = document.querySelector("#price-hint");
  const totalValueEl = document.querySelector("#calculated-total-value");
  const dateInput = document.querySelector("#date");
  const successEl = document.querySelector("#success");
  const consumptionManualInput = document.querySelector("#consumption-manual");
  const efficiencyManualInput = document.querySelector("#efficiency-manual");
  const locationInput = document.querySelector("#location");
  const detectBtn = document.querySelector("#detect-location");
  const locationStatus = document.querySelector("#location-status");
  const locationHint = document.querySelector("#location-hint");

  // Helpers
  const formatMoney = (value) =>
    `R ${Number(value || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  function updateCalculatedTotal() {
    const liters = parseFloat(litersInput.value);
    const price = parseFloat(priceInput.value);
    if (
      !Number.isFinite(liters) ||
      liters <= 0 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      totalValueEl.textContent = formatMoney(0);
      return;
    }
    const total = liters * price;
    totalValueEl.textContent = formatMoney(total);
  }

  litersInput.addEventListener("input", updateCalculatedTotal);
  priceInput.addEventListener("input", updateCalculatedTotal);

  let priceChangedByUser = false;
  priceInput.addEventListener("input", () => {
    priceChangedByUser = true;
    priceHint.textContent = "Using your entered price.";
  });

  async function populateRegionalFuelPrice() {
    if (priceChangedByUser) return;
    const locale = navigator.language || "en-ZA";
    const countryCode = (locale.split("-")[1] || "ZA").toUpperCase();
    const { data, error } = await supabase
      .from("regional_fuel_prices")
      .select("price_per_litre, currency, region, valid_from, source")
      .eq("country_code", countryCode)
      .eq("fuel_type", fuelTypeInput.value)
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      priceHint.textContent = "No regional price available. Enter the garage price.";
      return;
    }
    priceInput.value = Number(data.price_per_litre).toFixed(2);
    priceHint.textContent = `Suggested ${data.currency || "R"} ${Number(data.price_per_litre).toFixed(2)}${data.region ? ` for ${data.region}` : ""}${data.source ? ` · ${data.source}` : ""}. You can change it.`;
    updateCalculatedTotal();
  }

  fuelTypeInput.addEventListener("change", () => {
    priceChangedByUser = false;
    populateRegionalFuelPrice();
  });
  populateRegionalFuelPrice();

  // Populate previous mileage from last refuel in car_logbook (or from option dataset if present)
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
      }
    } catch (err) {
      console.error("Error fetching last fill mileage:", err);
    }
  }

  vehicleSelect.addEventListener("change", async () => {
    await fetchLastFillMileage(vehicleSelect.value);
  });

  dateInput.value = new Date().toISOString().slice(0, 10);
  if (vehicleSelect.value) await fetchLastFillMileage(vehicleSelect.value);
  updateCalculatedTotal();

  // Compute consumption helpers
  const computeFromLitresAndDistance = (litres, distanceKm) => {
    if (!Number.isFinite(litres) || litres <= 0)
      return { lPer100: null, kmPerL: null };
    if (!Number.isFinite(distanceKm) || distanceKm <= 0)
      return { lPer100: null, kmPerL: null };
    const lPer100 = Number(((litres / distanceKm) * 100).toFixed(3));
    const kmPerL = Number((distanceKm / litres).toFixed(3));
    return { lPer100, kmPerL };
  };

  const computeFromConsumption = (lPer100) => {
    if (!Number.isFinite(lPer100) || lPer100 <= 0)
      return { lPer100: null, kmPerL: null };
    const kmPerL = Number((100 / lPer100).toFixed(3));
    return { lPer100: Number(lPer100.toFixed(3)), kmPerL };
  };

  const computeFromEfficiency = (kmPerL) => {
    if (!Number.isFinite(kmPerL) || kmPerL <= 0)
      return { lPer100: null, kmPerL: null };
    const lPer100 = Number(((1 / kmPerL) * 100).toFixed(3));
    return { lPer100, kmPerL: Number(kmPerL.toFixed(3)) };
  };

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

  // -------------------------
  // Location parsing + reverse geocoding improvements
  // -------------------------
  function parseCoordinates(text) {
    if (!text || typeof text !== "string") return null;
    const trimmed = text.trim();
    const coordMatch = trimmed.match(/^(-?\d+(\.\d+)?)[,\s;]+(-?\d+(\.\d+)?)$/);
    if (!coordMatch) return null;
    const a = Number(coordMatch[1]);
    const b = Number(coordMatch[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a >= -90 && a <= 90 && b >= -180 && b <= 180) return [b, a];
    if (b >= -90 && b <= 90 && a >= -180 && a <= 180) return [a, b];
    return null;
  }

  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1`;
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) throw new Error("Reverse geocode failed");
      const data = await resp.json();
      if (data && data.display_name) return data.display_name;
      if (data && data.address) {
        const parts = [];
        if (data.address.road) parts.push(data.address.road);
        if (data.address.suburb) parts.push(data.address.suburb);
        if (data.address.city) parts.push(data.address.city);
        if (data.address.state) parts.push(data.address.state);
        if (data.address.country) parts.push(data.address.country);
        if (parts.length) return parts.join(", ");
      }
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    } catch (err) {
      console.warn("Reverse geocode error:", err);
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    }
  }

  function showLocationStatus(message, isError = false) {
    if (!locationStatus) return;
    locationStatus.hidden = false;
    locationStatus.textContent = message;
    locationStatus.style.color = isError ? "#a00" : "#333";
    setTimeout(() => {
      if (locationStatus) locationStatus.hidden = true;
    }, 6000);
  }

  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  const handleLocationInput = debounce(async () => {
    const text = locationInput.value?.trim();
    if (!text) {
      if (locationHint) {
        locationHint.style.display = "none";
        locationHint.textContent = "";
      }
      return;
    }

    if (locationHint) {
      locationHint.style.display = "block";
      locationHint.textContent =
        'Tip: you can paste coordinates like "-26.2041, 28.0473" to auto-fill the address.';
    }

    const coords = parseCoordinates(text);
    if (coords) {
      const [lon, lat] = coords;
      showLocationStatus("Resolving coordinates…");
      try {
        const address = await reverseGeocode(lat, lon);
        if (address) {
          locationInput.value = address;
          if (locationHint) {
            locationHint.style.display = "block";
            locationHint.textContent = `Detected coordinates: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
          }
          showLocationStatus("Address resolved from coordinates");
        }
      } catch (err) {
        console.warn("Failed to reverse geocode typed coordinates", err);
        showLocationStatus("Failed to resolve coordinates", true);
      }
    }
  }, 450);

  locationInput.addEventListener("input", handleLocationInput);

  async function detectLocationAndFill() {
    if (!navigator.geolocation) {
      showLocationStatus("Geolocation not supported by this browser", true);
      return;
    }
    detectBtn.disabled = true;
    showLocationStatus("Detecting location…");
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60 * 1000,
        });
      }).then(
        async (pos) => {
          try {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            showLocationStatus("Reverse geocoding location…");
            const address = await reverseGeocode(lat, lon);
            locationInput.value =
              address || `${lat.toFixed(6)},${lon.toFixed(6)}`;
            if (locationHint) {
              locationHint.style.display = "block";
              locationHint.textContent = `Coordinates: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            }
            showLocationStatus("Location detected");
          } catch (err) {
            console.error("Location detection error:", err);
            locationInput.value = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
            showLocationStatus("Location detected (coordinates only)");
          } finally {
            detectBtn.disabled = false;
          }
        },
        (err) => {
          detectBtn.disabled = false;
          console.warn("Geolocation error:", err);
          if (err.code === 1) {
            showLocationStatus("Location permission denied", true);
          } else if (err.code === 2) {
            showLocationStatus("Position unavailable", true);
          } else if (err.code === 3) {
            showLocationStatus("Location request timed out", true);
          } else {
            showLocationStatus("Failed to detect location", true);
          }
        },
      );
    } catch (err) {
      detectBtn.disabled = false;
      console.error("Unexpected geolocation error:", err);
      showLocationStatus("Failed to detect location", true);
    }
  }

  detectBtn.addEventListener("click", detectLocationAndFill);

  // Submit handler
  document
    .querySelector("#log-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();

      const vehicleId = vehicleSelect.value;
      const mileageLastFill = previousInput.value
        ? Number(previousInput.value)
        : null;
      const currentMileage = Number(currentInput.value);
      const litersRaw = parseFloat(litersInput.value);
      const liters = Number.isFinite(litersRaw)
        ? Number(litersRaw.toFixed(3))
        : NaN;
      const pricePerLitre = Number(priceInput.value);
      const fuelType = document.querySelector("#fuel-type").value;
      const locationRaw = locationInput.value || null;
      const date = document.querySelector("#date").value;

      const manualConsumptionRaw = consumptionManualInput.value
        ? parseFloat(consumptionManualInput.value)
        : null;
      const manualEfficiencyRaw = efficiencyManualInput.value
        ? parseFloat(efficiencyManualInput.value)
        : null;
      const manualConsumption = Number.isFinite(manualConsumptionRaw)
        ? Number(manualConsumptionRaw.toFixed(3))
        : null;
      const manualEfficiency = Number.isFinite(manualEfficiencyRaw)
        ? Number(manualEfficiencyRaw.toFixed(3))
        : null;

      if (!vehicleId) return window.alert("Please select a vehicle.");
      if (!Number.isFinite(currentMileage))
        return window.alert("Please enter a valid current mileage.");
      if (!Number.isFinite(liters) || liters <= 0)
        return window.alert(
          "Please enter a valid fuel amount (up to 3 decimal places).",
        );
      if (!Number.isFinite(pricePerLitre) || pricePerLitre < 0)
        return window.alert("Please enter a valid price per litre.");

      const distanceSinceLastFill =
        Number.isFinite(mileageLastFill) && mileageLastFill !== null
          ? Math.max(0, currentMileage - Number(mileageLastFill))
          : null;

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
        const derived = computeFromLitresAndDistance(
          liters,
          distanceSinceLastFill,
        );
        lPer100 = derived.lPer100;
        kmPerL = derived.kmPerL;
      }

      const totalCost = Number((liters * pricePerLitre).toFixed(2));

      // Normalize location: if user pasted coordinates but didn't reverse-geocode, try to parse and reverse now
      let locationToStore = locationRaw;
      if (locationRaw) {
        const coords = parseCoordinates(locationRaw);
        if (coords) {
          try {
            const [lon, lat] = coords;
            const resolved = await reverseGeocode(lat, lon);
            if (resolved) locationToStore = resolved;
          } catch (err) {
            console.warn("Failed to reverse geocode on submit:", err);
          }
        }
      }

      try {
        const { data: insertData, error: insertErr } = await supabase
          .from("car_logbook")
          .insert({
            vehicle_id: vehicleId,
            entry_type: "refuel",
            mileage_last_fill: mileageLastFill,
            current_mileage: currentMileage,
            fuel_price: pricePerLitre,
            fuel_amount_liters: liters,
            fuel_location: locationToStore,
            total_cost: totalCost,
            fuel_type: fuelType,
            fuel_consumption_l_per_100km: lPer100,
            fuel_efficiency_km_per_l: kmPerL,
            created_at: new Date(date),
          })
          .select()
          .single();

        if (insertErr) {
          console.error("Insert fuel log error:", insertErr);
          return window.alert(
            insertErr.message ||
              "Failed to save fill-up. Check console for details.",
          );
        }

        const { error: updateErr } = await supabase
          .from("vehicles")
          .update({
            current_mileage: currentMileage,
          })
          .eq("id", vehicleId)
          .eq("user_id", user.id);

        if (updateErr) {
          console.error("Update vehicle mileage error (logbook):", updateErr);
          window.alert(
            "Fill-up saved but failed to update vehicle mileage. Check console for details.",
          );
        } else {
          successEl.hidden = false;
          const consumptionText = lPer100 === null ? "—" : `${lPer100} L/100km`;
          const efficiencyText = kmPerL === null ? "—" : `${kmPerL} km/L`;
          successEl.textContent = `Fill-up saved. Total: ${formatMoney(totalCost)}. Consumption: ${consumptionText} · ${efficiencyText}.`;
          litersInput.value = "";
          priceInput.value = "";
          currentInput.value = "";
          consumptionManualInput.value = "";
          efficiencyManualInput.value = "";
          previousInput.value = currentMileage;
          const opt = vehicleSelect.querySelector(
            `option[value="${vehicleId}"]`,
          );
          if (opt) opt.dataset.currentMileage = currentMileage;
          setTimeout(() => {
            successEl.hidden = true;
          }, 4000);
        }
      } catch (err) {
        console.error("Unexpected error saving fill-up:", err);
        window.alert("An unexpected error occurred. See console for details.");
      }
    });
}

// small helper used in template
function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
