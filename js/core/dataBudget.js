const DATA_BUDGET_KEY = "dataBudgetMode";

export function isDataBudgetModeEnabled() {
  return localStorage.getItem(DATA_BUDGET_KEY) === "wifi-only";
}

export function setDataBudgetMode(enabled) {
  if (enabled) localStorage.setItem(DATA_BUDGET_KEY, "wifi-only");
  else localStorage.removeItem(DATA_BUDGET_KEY);
}

export function hasUnmeteredConnection() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return false;
  if (connection.type) return ["wifi", "ethernet"].includes(connection.type);
  return connection.saveData === false && !["slow-2g", "2g"].includes(connection.effectiveType);
}

export function shouldDeferNetwork() {
  return isDataBudgetModeEnabled() && !hasUnmeteredConnection();
}

export function dataBudgetMessage(action = "This action") {
  return `${action} is paused while Data budgeting mode is on. Connect to Wi-Fi or Ethernet, or turn off the setting.`;
}
