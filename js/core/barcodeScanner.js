const normalizeKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseComplianceBarcode(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { raw: text };
  } catch {
    return Object.fromEntries(
      text
        .split(/[\n;|]/)
        .map((part) => part.split(/[:=]/))
        .filter(([key, value]) => key && value)
        .map(([key, value]) => [normalizeKey(key), value.trim()]),
    );
  }
}

export async function scanComplianceBarcode(video, onDetect) {
  if (!("BarcodeDetector" in window)) {
    throw new Error("Barcode scanning is not supported on this device. Enter the details manually.");
  }
  const detector = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  video.srcObject = stream;
  video.hidden = false;
  await video.play();

  let active = true;
  const stop = () => {
    active = false;
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    video.hidden = true;
  };
  const detect = async () => {
    if (!active) return;
    try {
      const results = await detector.detect(video);
      if (results.length) {
        onDetect(parseComplianceBarcode(results[0].rawValue), results[0].rawValue);
        stop();
        return;
      }
    } catch {
      // Keep scanning until the user closes the camera or a code is found.
    }
    requestAnimationFrame(detect);
  };
  requestAnimationFrame(detect);
  return stop;
}
