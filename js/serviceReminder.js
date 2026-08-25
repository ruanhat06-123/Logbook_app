const reminderThreshold = (vehicleItem) => {
  const remaining =
    Number(vehicleItem.next_service_mileage) -
    Number(vehicleItem.current_mileage);
  if (remaining <= 100) return 100;
  if (remaining <= 500) return 500;
  if (remaining <= 1000) return 1000;
  return null;
};

export const serviceReminderKey = (vehicleItem) => {
  const threshold = reminderThreshold(vehicleItem);
  return threshold ? `${vehicleItem.next_service_mileage}:${threshold}` : null;
};

export const isServiceDue = (vehicleItem) => {
  const key = serviceReminderKey(vehicleItem);
  return Boolean(
    key &&
    Number.isFinite(Number(vehicleItem.next_service_mileage)) &&
    vehicleItem.service_reminder_confirmed_for !== key,
  );
};

export const serviceReminderMarkup = (vehicleItem) => {
  if (!isServiceDue(vehicleItem)) return "";
  const label =
    `${vehicleItem.make || "Vehicle"} ${vehicleItem.model || ""}`.trim();
  const threshold = reminderThreshold(vehicleItem);
  const remaining = Math.max(
    0,
    Number(vehicleItem.next_service_mileage) -
      Number(vehicleItem.current_mileage),
  );
  return `<div class="service-reminder" data-service-reminder="${vehicleItem.id}"><div><strong>Service reminder for ${escapeHtml(label)}</strong><span>${remaining.toLocaleString()} km remaining · Reminder at ${threshold.toLocaleString()} km</span></div><button class="btn btn-secondary" type="button" data-confirm-service="${vehicleItem.id}">Confirm serviced</button></div>`;
};

export const notifyServiceDue = (vehicleItem) => {
  if (!isServiceDue(vehicleItem) || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification("Vehicle service due", {
      body: `${vehicleItem.number_plate || "Your vehicle"} has ${Math.max(0, Number(vehicleItem.next_service_mileage) - Number(vehicleItem.current_mileage)).toLocaleString()} km until service.`,
      tag: `service-${vehicleItem.id}-${serviceReminderKey(vehicleItem)}`,
    });
  }
};

export const requestServiceNotifications = async () => {
  if ("Notification" in window && Notification.permission === "default")
    await Notification.requestPermission();
};

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ],
  );
