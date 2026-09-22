import "../core/app.js";
import { getFleetContext, isFleetAdmin } from "../core/fleetAccess.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");
const context = await getFleetContext(user);

if (!isFleetAdmin(context)) {
  await shell("drivers", `<section class="card"><div class="card-head"><h2>Fleet administrator access required</h2></div><p class="row-sub">Only fleet owners can manage driver accounts.</p></section>`);
} else {
  const [{ data: drivers = [], error }, { data: availableVehicles = [], error: vehicleError }] = await Promise.all([
    supabase.from("fleet_drivers").select("id, first_name, last_name, email, status, created_at").eq("fleet_id", context.fleetId).order("created_at", { ascending: false }),
    supabase.from("vehicles").select("id, number_plate, make, model").eq("fleet_id", context.fleetId).order("number_plate"),
  ]);
  const driverIds = (drivers || []).map((driver) => driver.id);
  const { data: assignments = [], error: assignmentError } = driverIds.length
    ? await supabase.from("fleet_driver_vehicles").select("driver_id, vehicle_id").in("driver_id", driverIds)
    : { data: [], error: null };
  const rows = drivers || [];
  const assignmentMap = new Map();
  assignments.forEach((assignment) => {
    if (!assignmentMap.has(assignment.driver_id)) assignmentMap.set(assignment.driver_id, new Set());
    assignmentMap.get(assignment.driver_id).add(String(assignment.vehicle_id));
  });
  await shell("drivers", `
    <header class="topbar"><div><div class="eyebrow">Fleet management</div><h1>Drivers</h1></div><div class="top-date"><strong>${rows.length}/${context.driverLimit}</strong> accounts</div></header>
    <section class="card" style="max-width:760px"><div class="card-head"><h2>Add driver</h2></div>
      <form id="driver-form" class="form-grid">
        <div class="field"><label for="first-name">First name</label><input id="first-name" required></div>
        <div class="field"><label for="last-name">Last name</label><input id="last-name" required></div>
        <div class="field"><label for="driver-email">Email address</label><input id="driver-email" type="email" required></div>
        <div class="field"><label for="driver-password">Password</label><input id="driver-password" type="password" minlength="8" required></div>
        <div class="field"><label for="driver-status">Status</label><select id="driver-status"><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
        <div class="form-actions field full"><button class="btn btn-primary" type="submit">Create driver</button></div>
      </form><div id="driver-notice" class="notice" hidden></div>
    </section>
    ${error ? `<section class="card"><div class="card-head"><h2>Driver accounts unavailable</h2></div><p class="row-sub">${escapeHtml(error.message || "The driver accounts could not be loaded. Check the fleet RLS migration.")}</p></section>` : ""}
    ${(vehicleError || assignmentError) ? `<section class="card"><div class="card-head"><h2>Vehicle assignments unavailable</h2></div><p class="row-sub">${escapeHtml((vehicleError || assignmentError).message || "Run the fleet driver RLS migration to manage vehicle access.")}</p></section>` : ""}
    <section class="card"><div class="card-head"><h2>Driver accounts</h2><a class="text-link" href="fleet.html">Fleet dashboard</a></div>
      ${rows.length ? `<div class="table-responsive"><table class="table"><thead><tr><th>Driver details</th><th>Status</th><th>Available vehicles</th><th>Created</th></tr></thead><tbody>${rows.map((driver) => `<tr><td><form class="driver-edit-form" data-driver-id="${escapeHtml(driver.id)}"><div style="display:grid;gap:6px;min-width:240px"><input name="firstName" value="${escapeHtml(driver.first_name)}" aria-label="First name"><input name="lastName" value="${escapeHtml(driver.last_name)}" aria-label="Last name"><input name="email" type="email" value="${escapeHtml(driver.email)}" aria-label="Email"><input name="password" type="password" minlength="8" placeholder="New password (optional)" aria-label="New password"><select name="status" aria-label="Status"><option value="active"${driver.status === "active" ? " selected" : ""}>Active</option><option value="suspended"${driver.status === "suspended" ? " selected" : ""}>Suspended</option></select><button class="btn btn-small" type="submit">Save driver</button></div></form></td><td>${escapeHtml(driver.status)}</td><td><select multiple size="3" data-driver-vehicles="${escapeHtml(driver.id)}" aria-label="Vehicles available to ${escapeHtml(`${driver.first_name} ${driver.last_name}`)}">${availableVehicles.map((vehicle) => `<option value="${escapeHtml(vehicle.id)}"${assignmentMap.get(driver.id)?.has(String(vehicle.id)) ? " selected" : ""}>${escapeHtml(vehicle.number_plate || "Vehicle")} · ${escapeHtml(`${vehicle.make || ""} ${vehicle.model || ""}`.trim())}</option>`).join("")}</select><button class="btn btn-small" type="button" data-save-driver-vehicles="${escapeHtml(driver.id)}">Save vehicles</button></td><td>${escapeHtml(new Date(driver.created_at).toLocaleDateString("en-GB"))}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No driver accounts yet.</div>'}
    </section>
  `);
  document.querySelector("#driver-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const notice = document.querySelector("#driver-notice");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    notice.hidden = false;
    notice.textContent = "Creating driver account...";
    try {
        const apiBase = String(window.__ENV?.VITE_API_URL || "").replace(/\/$/, "");
        const requestDriverCreation = async (accessToken) => fetch(`${apiBase}/api/fleet/drivers`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ firstName: form.querySelector("#first-name").value.trim(), lastName: form.querySelector("#last-name").value.trim(), email: form.querySelector("#driver-email").value.trim(), password: form.querySelector("#driver-password").value, status: form.querySelector("#driver-status").value }),
        });

        let { data: sessionData } = await supabase.auth.refreshSession();
        if (!sessionData.session?.access_token) {
          sessionData = (await supabase.auth.getSession()).data;
        }
        if (!sessionData.session?.access_token) throw new Error("Your session has expired. Please sign in again.");

        let response = await requestDriverCreation(sessionData.session.access_token);
        if (response.status === 401) {
          const refreshed = await supabase.auth.refreshSession();
          if (refreshed.data.session?.access_token) response = await requestDriverCreation(refreshed.data.session.access_token);
        }
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || `Driver service returned HTTP ${response.status}.`);
        notice.textContent = "Driver added successfully.";
        notice.classList.add("app-status-success");
        form.reset();
        setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      console.error("Driver account creation failed:", error);
      notice.textContent = error.message || "Unable to create driver account.";
      button.disabled = false;
    }
  });
  document.querySelectorAll("[data-save-driver-vehicles]").forEach((button) => {
    button.addEventListener("click", async () => {
      const driverId = button.dataset.saveDriverVehicles;
      const select = document.querySelector(`[data-driver-vehicles="${CSS.escape(driverId)}"]`);
      const vehicleIds = [...(select?.selectedOptions || [])].map((option) => option.value);
      button.disabled = true;
      const { error: deleteError } = await supabase.from("fleet_driver_vehicles").delete().eq("driver_id", driverId);
      const { error: insertError } = deleteError || !vehicleIds.length ? { error: deleteError } : await supabase.from("fleet_driver_vehicles").insert(vehicleIds.map((vehicleId) => ({ driver_id: driverId, vehicle_id: vehicleId })));
      button.disabled = false;
      if (deleteError || insertError) return window.alert((deleteError || insertError).message);
      button.textContent = "Saved";
      setTimeout(() => { button.textContent = "Save vehicles"; }, 1200);
    });
  });
  document.querySelectorAll(".driver-edit-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const session = (await supabase.auth.refreshSession()).data.session;
        if (!session?.access_token) throw new Error("Your session has expired. Please sign in again.");
        const apiBase = String(window.__ENV?.VITE_API_URL || "").replace(/\/$/, "");
        const response = await fetch(`${apiBase}/api/fleet/drivers/${encodeURIComponent(form.dataset.driverId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || `Driver service returned HTTP ${response.status}.`);
        const notice = document.querySelector("#driver-notice");
        notice.hidden = false;
        notice.textContent = "Driver updated successfully.";
        setTimeout(() => window.location.reload(), 700);
      } catch (error) {
        window.alert(error.message || "Unable to update driver.");
        button.disabled = false;
      }
    });
  });
}