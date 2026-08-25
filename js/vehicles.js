import "./app.js";

const user = await requireAuth();
if (user) {
  const [{ data: vehicleRows }, { data: logRows }] = await Promise.all([
    supabase
      .from("vehicles")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("car_logbook")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);
  const currentVehicles = vehicleRows || [],
    currentLogs = logRows || [];
  const total = currentLogs.reduce(
    (sum, log) => sum + Number(log.total_cost),
    0,
  );
  const liters = currentLogs.reduce(
    (sum, log) => sum + Number(log.fuel_amount_liters),
    0,
  );
  const distance = currentLogs.reduce(
    (sum, log) =>
      sum +
      Math.max(
        0,
        Number(log.current_mileage) -
          Number(log.mileage_last_fill || log.current_mileage),
      ),
    0,
  );
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  await shell(
    "home",
    `<header class="topbar"><div><div class="eyebrow">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div><h1>${greeting}.</h1></div><div class="top-date"><strong>PERSONAL LOGBOOK</strong>All systems up to date</div></header><section class="grid stats-grid"><div class="card stat"><div class="stat-label">Active vehicles</div><div class="stat-value">${currentVehicles.length}</div><div class="stat-note">Across your account</div></div><div class="card stat"><div class="stat-label">Fuel logged</div><div class="stat-value">${liters.toFixed(1)} L</div><div class="stat-note">Across all vehicles</div></div><div class="card stat"><div class="stat-label">Distance logged</div><div class="stat-value">${distance.toLocaleString()} km</div><div class="stat-note">From recorded fill-ups</div></div><div class="card stat"><div class="stat-label">Total spend</div><div class="stat-value">${money(total).replace("KES ", "")}</div><div class="stat-note">All recorded time</div></div></section><section class="grid two-col"><div class="card" id="vehicles"><div class="card-head"><h2>Your vehicles</h2><a class="text-link" href="logbook.html">＋ Log a fill-up</a></div>${currentVehicles.length ? currentVehicles.map((item) => `<div class="vehicle-row"><div class="car-icon">⌁</div><div class="row-main"><div class="row-title">${item.make || "Vehicle make not specified"} ${item.model || ""}</div><div class="row-sub">${item.number_plate || "Number plate not specified"} · ${item.year || "Year not specified"}</div></div><div class="row-actions"><span class="status">ACTIVE</span><button class="icon-button" type="button" data-delete-vehicle="${item.id}" aria-label="Remove ${item.number_plate}" title="Remove vehicle">×</button></div></div>`).join("") : '<div class="empty">No vehicles yet. Add a vehicle to begin.</div>'}</div><div class="card"><div class="card-head"><h2>Recent activity</h2><a class="text-link" href="report.html">View report</a></div>${
      currentLogs
        .slice(0, 3)
        .map(
          (item) =>
            `<div class="log-row"><div class="car-icon">＋</div><div class="row-main"><div class="row-title">${currentVehicles.find((entry) => entry.id === item.vehicle_id)?.number_plate || "Vehicle not specified"}</div><div class="row-sub">${dateText(item.created_at)} · ${item.fuel_location || "Location not specified"}</div></div><div class="row-value">${money(item.total_cost)}</div></div>`,
        )
        .join("") || '<div class="empty">No fill-ups recorded yet. Add an entry to begin.</div>'
    }</div></section><section class="card" style="margin-top:20px"><div class="card-head"><div><div class="eyebrow">Fleet manager</div><h2>Add another vehicle</h2></div></div><form id="vehicle-form" class="form-grid"><div class="field"><label for="plate">Number plate</label><input id="plate" placeholder="Enter number plate" required></div><div class="field"><label for="make">Make</label><input id="make" placeholder="Enter vehicle make" required></div><div class="field"><label for="model">Model</label><input id="model" placeholder="Enter vehicle model" required></div><div class="field"><label for="year">Year</label><input id="year" type="number" min="1886" max="2200" placeholder="Enter vehicle year"></div><div class="form-actions field full"><button class="btn btn-primary" type="submit">Add vehicle →</button></div></form></section>`,
  );
  document.querySelectorAll("[data-delete-vehicle]").forEach((button) =>
    button.addEventListener("click", async () => {
      const item = currentVehicles.find(
        (entry) => entry.id === button.dataset.deleteVehicle,
      );
      if (
        !item ||
        !window.confirm(
          `Remove ${item.number_plate}? Its fuel logs will also be removed.`,
        )
      )
        return;
      const { error } = await supabase
        .from("vehicles")
        .delete()
        .eq("id", item.id);
      if (error) return window.alert(error.message);
      window.location.reload();
    }),
  );
  document.querySelectorAll("[data-delete-vehicle]").forEach((button) => {
    const editButton = document.createElement("button");
    editButton.className = "icon-button";
    editButton.type = "button";
    editButton.textContent = "✎";
    editButton.title = "Edit vehicle";
    editButton.setAttribute(
      "aria-label",
      `Edit ${button.getAttribute("aria-label").replace("Remove ", "")}`,
    );
    button.before(editButton);
    editButton.addEventListener("click", () => {
      const item = currentVehicles.find(
        (entry) => entry.id === button.dataset.deleteVehicle,
      );
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div class="modal-head"><h2 id="edit-title">Edit vehicle</h2><button class="modal-close" type="button" aria-label="Close">×</button></div><form class="form-grid" id="edit-vehicle-form"><div class="field"><label for="edit-plate">Number plate</label><input id="edit-plate" value="${item.number_plate}" required></div><div class="field"><label for="edit-make">Make</label><input id="edit-make" value="${item.make || ""}" required></div><div class="field"><label for="edit-model">Model</label><input id="edit-model" value="${item.model || ""}" required></div><div class="field"><label for="edit-year">Year</label><input id="edit-year" type="number" min="1886" max="2200" value="${item.year || ""}"></div><div class="field full"><label for="edit-mileage">Current mileage (km)</label><input id="edit-mileage" type="number" min="0" step="1" value="${item.current_mileage || 0}" required></div><div class="form-actions field full"><button class="btn btn-secondary modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save changes →</button></div></form></div>`;
      document.body.append(backdrop);
      const close = () => backdrop.remove();
      backdrop.querySelector(".modal-close").addEventListener("click", close);
      backdrop.querySelector(".modal-cancel").addEventListener("click", close);
      backdrop
        .querySelector("#edit-vehicle-form")
        .addEventListener("submit", async (event) => {
          event.preventDefault();
          const { error } = await supabase
            .from("vehicles")
            .update({
              number_plate: backdrop
                .querySelector("#edit-plate")
                .value.trim()
                .toUpperCase(),
              make: backdrop.querySelector("#edit-make").value.trim(),
              model: backdrop.querySelector("#edit-model").value.trim(),
              year: backdrop.querySelector("#edit-year").value || null,
              current_mileage: Number(
                backdrop.querySelector("#edit-mileage").value,
              ),
            })
            .eq("id", item.id);
          if (error) return window.alert(error.message);
          window.location.reload();
        });
    });
  });
  const mileageField = document.createElement("div");
  mileageField.className = "field";
  mileageField.innerHTML =
    '<label for="mileage">Current mileage (km)</label><input id="mileage" type="number" min="0" step="1" placeholder="Enter current mileage" required>';
  document.querySelector("#year").closest(".field").after(mileageField);
  document
    .querySelector("#vehicle-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const { error } = await supabase
        .from("vehicles")
        .insert({
          user_id: user.id,
          number_plate: document
            .querySelector("#plate")
            .value.trim()
            .toUpperCase(),
          make: document.querySelector("#make").value.trim(),
          model: document.querySelector("#model").value.trim(),
          year: document.querySelector("#year").value || null,
          current_mileage: Number(document.querySelector("#mileage").value),
        });
      if (error) return window.alert(error.message);
      window.location.reload();
    });
}
