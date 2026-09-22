import { supabase } from "./supabaseClient.js";
import { effectiveTier } from "./subscription.js";

const FLEET_CONTEXT_KEY = "logmateFleetContext";

const readCachedContext = () => {
  try {
    return JSON.parse(sessionStorage.getItem(FLEET_CONTEXT_KEY) || "null");
  } catch {
    return null;
  }
};

const cacheContext = (context) => {
  try {
    sessionStorage.setItem(FLEET_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // Session storage is optional; the database remains authoritative.
  }
  return context;
};

export async function getFleetContext(user) {
  if (!user?.id) return { role: "standard", fleetId: null, driver: null, vehicleLimit: 0 };

  const cached = readCachedContext();
  if (cached?.userId === user.id && !navigator.onLine) return cached;

  const { data: subscription } = await supabase
    .from("users")
    .select("subscription_tier, subscription_expiry_date, payment_status")
    .eq("id", user.id)
    .maybeSingle();
  const subscriptionState = {
    tier: subscription?.subscription_tier || "free",
    expiryDate: subscription?.subscription_expiry_date || null,
    paymentStatus: subscription?.payment_status || "pending",
  };
  const fleetPlan = ["fleet_starter", "fleet_pro"].includes(effectiveTier(subscriptionState));

  const { data: driver, error: driverError } = await supabase
    .from("fleet_drivers")
    .select("id, fleet_id, user_id, first_name, last_name, email, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!driverError && driver?.status === "active") {
    return cacheContext({
      userId: user.id,
      role: "fleet_driver",
      fleetId: driver.fleet_id,
      driver,
      vehicleLimit: 0,
      driverLimit: 0,
    });
  }

  const { data: fleet, error: fleetError } = await supabase
    .from("fleets")
    .select("id, owner_id, vehicle_limit")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!fleetError && fleet && fleetPlan) {
    const vehicleLimit = Number(fleet.vehicle_limit || 0);
    return cacheContext({
      userId: user.id,
      role: "fleet_admin",
      fleetId: fleet.id,
      driver: null,
      vehicleLimit,
      driverLimit: vehicleLimit * 2,
    });
  }

  return cacheContext({
    userId: user.id,
    role: "standard",
    fleetId: null,
    driver: null,
    vehicleLimit: 0,
    driverLimit: 0,
  });
}

export const isFleetDriver = (context) => context?.role === "fleet_driver";
export const isFleetAdmin = (context) => context?.role === "fleet_admin";
export const canManageFleet = (context) => isFleetAdmin(context);

export function auditIdentity(user, context) {
  const driver = context?.driver;
  const metadata = user?.user_metadata || {};
  return {
    driver_id: driver?.id || null,
    driver_name: driver
      ? `${driver.first_name || ""} ${driver.last_name || ""}`.trim()
      : metadata.full_name || metadata.name || user?.email || null,
    driver_email: driver?.email || user?.email || null,
    fleet_id: context?.fleetId || null,
  };
}