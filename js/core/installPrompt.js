const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

const platformInstruction = () => {
  const userAgent = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
    return "To install LogMate, tap Share, then Add to Home Screen.";
  }
  if (/Android/i.test(userAgent)) {
    return "To install LogMate, open your browser menu and choose Install app or Add to Home screen.";
  }
  if (/Macintosh|Windows|Linux/i.test(userAgent)) {
    return "To install LogMate, use the install icon in the address bar or your browser menu.";
  }
  return "Use your browser menu and choose Install app or Add to Home screen.";
};

export function setupInstallPrompt({ button, help }) {
  if (!button || isStandalone()) return;

  let deferredPrompt = null;
  let promptReceived = false;
  const showHelp = (message = platformInstruction()) => {
    help.hidden = false;
    help.textContent = message;
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    promptReceived = true;
    button.hidden = false;
    help.hidden = true;
  });

  button.addEventListener("click", async () => {
    if (!deferredPrompt) {
      showHelp();
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    button.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    button.hidden = true;
    help.hidden = true;
  });

  window.setTimeout(() => {
    if (!promptReceived && !isStandalone()) {
      button.hidden = true;
      showHelp();
    }
  }, 1500);
}
