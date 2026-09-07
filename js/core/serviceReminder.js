// serviceReminder.js
import { supabase } from "./supabaseClient.js";

const REMINDER_THRESHOLD = 1000;

const reminderThreshold = (vehicleItem) => {
  const next = Number(vehicleItem.next_service_mileage);
  if (!Number.isFinite(next)) return null;
  return REMINDER_THRESHOLD;
};

export const isServiceDue = (vehicleItem) => {
  const threshold = reminderThreshold(vehicleItem);
  if (!threshold) return false;
  const next = Number(vehicleItem.next_service_mileage);
  const current = Number(vehicleItem.current_mileage || 0);
  if (!Number.isFinite(next)) return false;
  const remaining = next - current;
  return remaining <= threshold;
};

export const serviceReminderMarkup = (vehicleItem) => {
  if (!isServiceDue(vehicleItem)) return "";
  const label = `${vehicleItem.make || "Vehicle"} ${vehicleItem.model || ""}`.trim();
  const threshold = reminderThreshold(vehicleItem);
  const remaining = Math.max(0, Number(vehicleItem.next_service_mileage) - Number(vehicleItem.current_mileage || 0));
  return `<div class="service-reminder" data-service-reminder="${escapeHtml(vehicleItem.id)}">
    <div>
      <strong>Service reminder for ${escapeHtml(label)}</strong>
      <span>${remaining.toLocaleString()} km remaining · Reminder threshold ${threshold.toLocaleString()} km</span>
    </div>
    <button class="btn btn-secondary" type="button" data-confirm-service="${escapeHtml(vehicleItem.id)}">Confirm serviced</button>
  </div>`;
};

export const notifyServiceDue = async (vehicleItem) => {
  if (localStorage.getItem("serviceNotifications") === "off") return;
  if (!isServiceDue(vehicleItem) || !("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission !== "granted") return;

  const options = {
    body: `${vehicleItem.number_plate || "Your vehicle"} has ${Math.max(0, Number(vehicleItem.next_service_mileage) - Number(vehicleItem.current_mileage || 0)).toLocaleString()} km until service. Tap to open LogMate and confirm the service.`,
    tag: `service-${vehicleItem.id}`,
    icon: "/assets/logo.svg",
    badge: "/assets/logo.svg",
    requireInteraction: true,
    data: { url: "/html/vehicles.html" },
  };

  try {
    const registration =
      "serviceWorker" in navigator
        ? await navigator.serviceWorker.ready.catch(() => null)
        : null;
    if (registration?.showNotification) {
      await registration.showNotification("Vehicle service due", options);
    } else {
      new Notification("Vehicle service due", options);
    }
  } catch (err) {
    console.warn("Failed to show service notification:", err);
  }
};

export const requestServiceNotifications = async () => {
  if (localStorage.getItem("serviceNotifications") === "off") return;
  if ("Notification" in window && Notification.permission === "default")
    await Notification.requestPermission();
};

/* Delegated click handler so confirm works for dynamically inserted buttons.
   Clicking "Confirm serviced" opens a form that writes the service details to
   the service history (service_records). The reminder banner and the
   notification are ONLY cleared after that history entry has been saved. */
const handleConfirmClick = async (event) => {
  const btn = event.target.closest("[data-confirm-service]");
  if (!btn) return;

  event.preventDefault();
  const vehicleId = btn.dataset.confirmService;
  if (!vehicleId) return;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      window.alert("You must be signed in to confirm service.");
      return;
    }

    const { data: vehicle, error: fetchErr } = await supabase
      .from("vehicles")
      .select("id, number_plate, make, model, current_mileage, next_service_mileage, user_id")
      .eq("id", vehicleId)
      .single();

    if (fetchErr || !vehicle) {
      console.error("Fetch vehicle error:", fetchErr);
      window.alert(fetchErr?.message || "Unable to fetch vehicle details.");
      return;
    }

    // Mark this vehicle as mid-confirmation so the reminder can be re-shown
    // if the page is closed before the history entry is saved.
    markPendingService(vehicle.id);

    showServiceRecordForm(vehicle, sessionData.session.user.id);
  } catch (err) {
    console.error("Unexpected error in service confirm handler:", err);
    window.alert("An unexpected error occurred. See console for details.");
  }
};

/**
 * Track vehicles whose service confirmation is in progress, so the reminder
 * can be re-shown if the flow is interrupted before the history entry saves.
 */
const PENDING_SERVICE_KEY = "pendingServiceConfirmations";

function markPendingService(vehicleId) {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_SERVICE_KEY) || "[]");
    if (!pending.includes(vehicleId)) {
      pending.push(vehicleId);
      localStorage.setItem(PENDING_SERVICE_KEY, JSON.stringify(pending));
    }
  } catch (err) {
    console.warn("Failed to persist pending service state:", err);
  }
}

function clearPendingService(vehicleId) {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_SERVICE_KEY) || "[]");
    localStorage.setItem(
      PENDING_SERVICE_KEY,
      JSON.stringify(pending.filter((id) => id !== vehicleId)),
    );
  } catch (err) {
    console.warn("Failed to clear pending service state:", err);
  }
}

/**
 * Re-show reminder banners for any vehicles that were mid-confirmation when
 * the page was last closed. Call after the page has rendered its reminders.
 */
export const restorePendingServiceReminders = (vehicleItems = []) => {
  let pending = [];
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_SERVICE_KEY) || "[]");
  } catch {
    return;
  }
  if (!pending.length) return;

  pending.forEach((vehicleId) => {
    if (document.querySelector(`[data-service-reminder="${vehicleId}"]`)) return;
    const vehicle = vehicleItems.find((item) => String(item.id) === String(vehicleId));
    if (!vehicle) return;
    const markup = serviceReminderMarkup(vehicle);
    if (!markup) return;
    const anchor =
      document.querySelector(".topbar") || document.querySelector("main") || document.body.firstElementChild;
    anchor?.insertAdjacentHTML("afterend", markup);
  });
};

/**
 * Close the persistent service notification for a vehicle.
 */
async function closeServiceNotification(vehicleId) {
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      const notifications = await registration?.getNotifications?.({
        tag: `service-${vehicleId}`,
      });
      notifications?.forEach((n) => n.close());
    }
  } catch (err) {
    console.warn("Failed to close service notification:", err);
  }
}

/**
 * Show a modal form that records the service into the service history.
 * The reminder (banner + notification) is cleared ONLY after the
 * service_records insert succeeds.
 */
function showServiceRecordForm(vehicle, userId) {
  const currentOdo = Number(vehicle.current_mileage || 0);
  const label = `${vehicle.make || "Vehicle"} ${vehicle.model || ""}`.trim();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="service-confirm-title">
      <div class="modal-head">
        <div>
          <h2 id="service-confirm-title">Confirm service for ${escapeHtml(vehicle.number_plate || "vehicle")}</h2>
          <div class="row-sub">${escapeHtml(label)} · Current odometer: ${currentOdo.toLocaleString()} km</div>
        </div>
        <button class="modal-close" type="button" aria-label="Close">×</button>
      </div>
      <form id="service-confirm-form" class="form-grid">
        <div class="field">
          <label for="service-confirm-title-input">Service title</label>
          <input id="service-confirm-title-input" placeholder="Annual service" value="Service completed" required>
        </div>
        <div class="field">
          <label for="service-confirm-date">Date</label>
          <input id="service-confirm-date" type="date" required>
        </div>
        <div class="field">
          <label for="service-confirm-mileage">Mileage at service (km)</label>
          <input id="service-confirm-mileage" type="number" min="0" value="${currentOdo}">
        </div>
        <div class="field">
          <label for="service-confirm-next">Next service mileage (km)</label>
          <input id="service-confirm-next" type="number" min="0" placeholder="e.g. ${currentOdo + 15000}" required>
        </div>
        <div class="field full">
          <label for="service-confirm-notes">Notes</label>
          <textarea id="service-confirm-notes" rows="3" placeholder="Work completed, parts replaced, or warranty details"></textarea>
        </div>
        <div class="form-actions field full">
          <button class="btn btn-secondary modal-cancel" type="button">Cancel</button>
          <button class="btn btn-primary" type="submit">Save service →</button>
        </div>
      </form>
    </div>`;
  document.body.append(backdrop);

  backdrop.querySelector("#service-confirm-date").value = new Date().toISOString().slice(0, 10);

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);

  backdrop.querySelector("#service-confirm-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    try {
      const mileage = form.querySelector("#service-confirm-mileage").value
        ? Number(form.querySelector("#service-confirm-mileage").value)
        : currentOdo;
      const nextService = Number(form.querySelector("#service-confirm-next").value);

      if (!Number.isFinite(nextService) || nextService <= mileage) {
        window.alert("Please enter a valid next service mileage greater than the service mileage.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Save service →";
        return;
      }

      // 1) Write the service history entry first — the reminder only goes
      //    away once this record exists.
      const { error: historyError } = await supabase.from("service_records").insert({
        user_id: userId,
        vehicle_id: vehicle.id,
        title: form.querySelector("#service-confirm-title-input").value.trim() || "Service completed",
        service_date: form.querySelector("#service-confirm-date").value,
        mileage,
        notes: form.querySelector("#service-confirm-notes").value.trim() || null,
      });
      if (historyError) {
        window.alert(historyError.message || "Failed to save service history. See console for details.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Save service →";
        return;
      }

      // 2) Update the vehicle's service schedule.
      const { error: updateErr } = await supabase
        .from("vehicles")
        .update({
          last_service_mileage: mileage,
          next_service_mileage: nextService,
        })
        .eq("id", vehicle.id);
      if (updateErr) {
        console.error("Update vehicle service schedule error:", updateErr);
        window.alert("Service saved to history, but failed to update the vehicle's next service mileage.");
      }

      // 3) History entry exists — now the reminder can go away.
      clearPendingService(vehicle.id);
      await closeServiceNotification(vehicle.id);
      document.querySelector(`[data-service-reminder="${vehicle.id}"]`)?.remove();
      backdrop.remove();

      document.dispatchEvent(
        new CustomEvent("vehicle:serviceConfirmed", { detail: { vehicleId: vehicle.id } }),
      );
    } catch (err) {
      console.error("Unexpected error saving service record:", err);
      window.alert("An unexpected error occurred. See console for details.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Save service →";
    }
  });
}

if (typeof window !== "undefined" && !window.__serviceReminderHandlerAttached) {
  document.addEventListener("click", handleConfirmClick);
  window.__serviceReminderHandlerAttached = true;
}

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ],
  );
