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

export const notifyServiceDue = (vehicleItem) => {
  if (!isServiceDue(vehicleItem) || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification("Vehicle service due", {
      body: `${vehicleItem.number_plate || "Your vehicle"} has ${Math.max(0, Number(vehicleItem.next_service_mileage) - Number(vehicleItem.current_mileage || 0)).toLocaleString()} km until service.`,
      tag: `service-${vehicleItem.id}-${vehicleItem.next_service_mileage}`,
    });
  }
};

export const requestServiceNotifications = async () => {
  if ("Notification" in window && Notification.permission === "default")
    await Notification.requestPermission();
};

/* Delegated click handler so confirm works for dynamically inserted buttons.
   This handler prompts for next service mileage and updates only next_service_mileage.
   No "confirmed" flag is written to the database. */
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
      .select("id, number_plate, current_mileage, next_service_mileage, user_id")
      .eq("id", vehicleId)
      .single();

    if (fetchErr || !vehicle) {
      console.error("Fetch vehicle error:", fetchErr);
      window.alert(fetchErr?.message || "Unable to fetch vehicle details.");
      return;
    }

    const currentOdo = Number(vehicle.current_mileage || 0);
    const raw = window.prompt(
      `Confirm service for ${vehicle.number_plate || "vehicle"}.\nCurrent odometer: ${currentOdo.toLocaleString()} km.\nEnter the next service mileage (km):`,
      ""
    );

    if (raw === null) return;

    const cleaned = String(raw).replace(/,/g, "").trim();
    const nextService = Number(cleaned);

    if (!Number.isFinite(nextService) || nextService <= currentOdo) {
      window.alert("Please enter a valid next service mileage greater than the current odometer reading.");
      return;
    }

    // Update only next_service_mileage (do not write any "confirmed" flag)
    const updateResp = await supabase
      .from("vehicles")
      .update({
        next_service_mileage: nextService,
      })
      .eq("id", vehicleId)
      // .eq("user_id", sessionData.session.user.id) // uncomment if your RLS requires ownership
      .select()
      .single();

    console.group("service confirm update response");
    console.log("request:", { id: vehicleId, next_service_mileage: nextService });
    console.log("response data:", updateResp.data);
    console.log("response error:", updateResp.error);
    console.log("response status:", updateResp.status);
    console.groupEnd();

    if (updateResp.error) {
      window.alert(updateResp.error.message || "Failed to update vehicle. See console for details.");
      return;
    }

    const reminderEl = document.querySelector(`[data-service-reminder="${vehicleId}"]`);
    if (reminderEl) reminderEl.remove();

    document.dispatchEvent(new CustomEvent("vehicle:serviceConfirmed", { detail: { vehicleId, updated: updateResp.data } }));
  } catch (err) {
    console.error("Unexpected error in service confirm handler:", err);
    window.alert("An unexpected error occurred. See console for details.");
  }
};

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
