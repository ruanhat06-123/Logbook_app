import "./app.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

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
      <div class="field"><label for="plate">Number plate</label><input name="plate" id="plate" required></div>
      <div class="field"><label for="make">Make</label><input name="make" id="make" required></div>
      <div class="field"><label for="model">Model</label><input name="model" id="model" required></div>
      <div class="field"><label for="year">Year</label><input name="year" id="year" type="number" min="1886" max="2200"></div>
      <div class="field"><label for="last-service">Last service mileage (km)</label><input name="last-service" id="last-service" type="number" min="0"></div>
      <div class="field"><label for="next-service">Next service mileage (km)</label><input name="next-service" id="next-service" type="number" min="0"></div>
      <div class="field"><label for="mileage">Current mileage (km)</label><input name="mileage" id="mileage" type="number" min="0" required></div>
      <div class="form-actions field full"><a href="vehicles.html" class="btn btn-secondary">Cancel</a><button class="btn btn-primary" type="submit">Add vehicle →</button></div>
    </form>
    <div id="vehicle-notice" class="notice" hidden></div>
  </div>
`);

document.querySelector("#vehicle-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const { error } = await supabase.from("vehicles").insert({
    user_id: user.id,
    number_plate: form.plate.value.trim().toUpperCase(),
    make: form.make.value.trim(),
    model: form.model.value.trim(),
    year: form.year.value || null,
    last_service_mileage: form["last-service"].value ? Number(form["last-service"].value) : null,
    current_mileage: Number(form.mileage.value),
    next_service_mileage: form["next-service"].value ? Number(form["next-service"].value) : null,
  });
  if (error) {
    const notice = document.querySelector("#vehicle-notice");
    notice.hidden = false;
    notice.textContent = error.message;
    return;
  }
  window.location.href = "vehicles.html";
});
