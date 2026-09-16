const getBackgroundGeolocation = () => {
  const capacitor = window.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  if (typeof capacitor.registerPlugin === "function") {
    return capacitor.registerPlugin("BackgroundGeolocation");
  }
  return capacitor.Plugins?.BackgroundGeolocation || null;
};

export const isNativeBackgroundLocationAvailable = () => Boolean(getBackgroundGeolocation());

export async function startNativeBackgroundWatcher(onLocation, onError) {
  const plugin = getBackgroundGeolocation();
  if (!plugin) return null;

  return plugin.addWatcher(
    {
      backgroundMessage: "LogMate is tracking your trip in the background.",
      backgroundTitle: "LogMate Smart Trips",
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
    },
    (location, error) => {
      if (error) {
        onError?.(error);
        return;
      }
      if (location) onLocation(location);
    },
  );
}

export async function stopNativeBackgroundWatcher(watcherId) {
  const plugin = getBackgroundGeolocation();
  if (!plugin || watcherId === null || watcherId === undefined) return;
  await plugin.removeWatcher({ id: watcherId });
}
