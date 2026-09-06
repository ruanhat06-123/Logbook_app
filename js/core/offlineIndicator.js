/**
 * Offline Detection & Indicator Module
 * Provides offline status detection, indicators, and graceful degradation
 * for a seamless offline-first PWA experience
 */

const log = (...args) => console.log("[Offline Indicator]", ...args);

// State
let isOnline = navigator.onLine;
let offlineIndicator = null;

/**
 * Initialize offline detection
 * Shows/hides offline indicator and triggers callbacks
 */
export function initializeOfflineDetection() {
  log("Initializing offline detection");

  // Check initial state
  if (!isOnline) {
    showOfflineIndicator();
  }

  // Listen for online/offline events
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Also poll periodically to catch network transitions
  setInterval(checkConnectivity, 5000);

  log("Offline detection initialized");
}

/**
 * Handle transition to online
 */
function handleOnline() {
  isOnline = true;
  log("Device is now ONLINE");
  hideOfflineIndicator();

  // Dispatch event for app to respond
  window.dispatchEvent(new CustomEvent("app-online", { detail: { timestamp: Date.now() } }));

  // Trigger any pending syncs
  window.dispatchEvent(new CustomEvent("network-restored", { detail: { timestamp: Date.now() } }));
}

/**
 * Handle transition to offline
 */
function handleOffline() {
  isOnline = false;
  log("Device is now OFFLINE");
  showOfflineIndicator();

  // Dispatch event for app to respond
  window.dispatchEvent(new CustomEvent("app-offline", { detail: { timestamp: Date.now() } }));
}

/**
 * Periodically verify connectivity
 * Detects network transitions that events might miss
 */
async function checkConnectivity() {
  try {
    // Try a lightweight HEAD request
    const response = await fetch("/manifest.json", { method: "HEAD", cache: "no-store" });
    const wouldBeOnline = response.ok;

    if (wouldBeOnline && !isOnline) {
      handleOnline();
    } else if (!wouldBeOnline && isOnline) {
      handleOffline();
    }
  } catch (err) {
    if (isOnline) {
      handleOffline();
    }
  }
}

/**
 * Show offline indicator in UI
 */
function showOfflineIndicator() {
  // Remove old indicator if exists
  if (offlineIndicator) {
    offlineIndicator.remove();
  }

  // Create indicator
  offlineIndicator = document.createElement("div");
  offlineIndicator.id = "logmate-offline-indicator";
  offlineIndicator.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: white;
    padding: 12px 16px;
    text-align: center;
    font-weight: 600;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.15);
    animation: slideUp 0.3s ease-out;
  `;

  offlineIndicator.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
      <span style="font-size: 16px;">📡</span>
      <span>You're offline · All changes are saved locally and will sync when online</span>
    </div>
  `;

  // Add animation
  if (!document.querySelector("style#offline-animations")) {
    const style = document.createElement("style");
    style.id = "offline-animations";
    style.textContent = `
      @keyframes slideUp {
        from {
          transform: translateY(100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      @keyframes slideDown {
        from {
          transform: translateY(0);
          opacity: 1;
        }
        to {
          transform: translateY(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(offlineIndicator);
  log("Offline indicator shown");
}

/**
 * Hide offline indicator
 */
function hideOfflineIndicator() {
  if (!offlineIndicator) return;

  offlineIndicator.style.animation = "slideDown 0.3s ease-out";
  setTimeout(() => {
    if (offlineIndicator && offlineIndicator.parentNode) {
      offlineIndicator.remove();
    }
    offlineIndicator = null;
  }, 300);

  log("Offline indicator hidden");
}

/**
 * Get current online status
 */
export function getOnlineStatus() {
  return isOnline;
}

/**
 * Listen for offline status changes
 */
export function onOfflineStatusChange(callback) {
  window.addEventListener("app-offline", () => callback(false));
  window.addEventListener("app-online", () => callback(true));
  // Call immediately with current status
  callback(isOnline);
}

/**
 * Show user-friendly offline message with tips
 */
export function showOfflineMessage(title = "You're Offline", message = "", tips = []) {
  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  `;

  const content = document.createElement("div");
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    width: 100%;
    box-shadow: 0 20px 25px rgba(0, 0, 0, 0.15);
  `;

  let tipsHTML = "";
  if (tips.length > 0) {
    tipsHTML = `
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin-top: 16px;">
        <strong style="display: block; margin-bottom: 8px;">💡 Tips:</strong>
        <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
          ${tips.map((tip) => `<li style="margin: 4px 0;">${tip}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  content.innerHTML = `
    <div style="text-align: center;">
      <div style="font-size: 48px; margin-bottom: 16px;">📡</div>
      <h2 style="margin: 0 0 12px 0; font-size: 24px;">${title}</h2>
      ${message ? `<p style="color: #666; margin: 0 0 16px 0; font-size: 15px;">${message}</p>` : ""}
      ${tipsHTML}
    </div>
    <button onclick="this.closest('div').remove()" style="
      display: block;
      margin-top: 20px;
      width: 100%;
      padding: 12px 16px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    ">Got it</button>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  return modal;
}

/**
 * Gracefully handle fetch failures with offline fallback
 */
export async function fetchWithOfflineFallback(url, options = {}) {
  try {
    const response = await fetch(url, options);
    if (!response.ok && !isOnline) {
      return {
        ok: false,
        status: 0,
        statusText: "Offline",
        error: "No internet connection",
        json: async () => ({ error: "offline" }),
        text: async () => "Offline",
      };
    }
    return response;
  } catch (err) {
    if (!isOnline) {
      return {
        ok: false,
        status: 0,
        statusText: "Offline",
        error: err.message,
        json: async () => ({ error: "offline" }),
        text: async () => `Offline: ${err.message}`,
      };
    }
    throw err;
  }
}

export default {
  initializeOfflineDetection,
  getOnlineStatus,
  onOfflineStatusChange,
  showOfflineMessage,
  fetchWithOfflineFallback,
};
