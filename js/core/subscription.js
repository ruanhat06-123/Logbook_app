// subscription.js
// Client-side subscription state: offline-first cache of the Supabase
// `users` row (subscription_tier / subscription_expiry_date / payment_status)
// plus feature-gating helpers used across pages.
import { supabase } from "./supabaseClient.js";
import { getLocalStore, setLocalStore } from "./localStore.js";

const CACHE_KEY = "subscriptionState";
const GRACE_PERIOD_DAYS = 7;
export const FREE_TRIP_LIMIT = 30;

const TIER_LABELS = {
  free: "Free",
  premium: "Premium",
  fleet_starter: "Fleet Starter",
  fleet_pro: "Fleet Pro",
};

const DEFAULT_STATE = () => ({
  tier: "free",
  expiryDate: null,
  paymentStatus: "pending",
  syncedAt: null,
});

/** Read the last-known subscription state from the offline cache. */
export async function getCachedSubscription() {
  const cached = await getLocalStore(CACHE_KEY);
  return cached || DEFAULT_STATE();
}

/**
 * Fetch the current subscription row from Supabase and refresh the local
 * cache. Falls back to the cached value when offline or on error.
 */
export async function syncSubscription(userId) {
  if (!userId || !navigator.onLine) return getCachedSubscription();
  try {
    const { data, error } = await supabase
      .from("users")
      .select("subscription_tier, subscription_expiry_date, payment_status, export_credits")
      .eq("id", userId)
      .single();
    if (error || !data) return getCachedSubscription();

    const state = {
      tier: data.subscription_tier || "free",
      expiryDate: data.subscription_expiry_date || null,
      paymentStatus: data.payment_status || "pending",
      exportCredits: Number(data.export_credits || 0),
      syncedAt: new Date().toISOString(),
    };
    await setLocalStore(CACHE_KEY, state);
    return state;
  } catch (err) {
    console.warn("Subscription sync failed, using cached state:", err);
    return getCachedSubscription();
  }
}

/**
 * Authoritative accessor: when online, waits for a fresh read from Supabase
 * so a tier change takes effect on the very next page load/reload. Falls
 * back to the offline cache when there's no connection.
 */
export async function getSubscriptionState(userId) {
  if (userId && navigator.onLine) return syncSubscription(userId);
  return getCachedSubscription();
}

/** True once the cached expiry date is more than the grace period in the past. */
function isPastGracePeriod(state) {
  if (!state?.expiryDate) return false;
  const expiry = new Date(state.expiryDate);
  expiry.setDate(expiry.getDate() + GRACE_PERIOD_DAYS);
  return new Date() > expiry;
}

/**
 * The tier that should actually gate features right now: expired or failed
 * subscriptions are treated as `free` on the client even before the server
 * has run its downgrade job.
 */
export function effectiveTier(state) {
  if (!state) return "free";
  if (state.paymentStatus === "failed" && isPastGracePeriod(state)) return "free";
  if (state.paymentStatus !== "active" && state.tier !== "free" && !state.expiryDate) return "free";
  if (isPastGracePeriod(state) && state.paymentStatus !== "active") return "free";
  return state.tier || "free";
}

export function tierLabel(state) {
  return TIER_LABELS[effectiveTier(state)] || "Free";
}

export function isPremiumTier(state) {
  return ["premium", "fleet_starter", "fleet_pro"].includes(effectiveTier(state));
}

export function isFleetTier(state) {
  return ["fleet_starter", "fleet_pro"].includes(effectiveTier(state));
}

export function canExportSarsPdf(state) {
  return isPremiumTier(state) || Number(state?.exportCredits || 0) > 0;
}

/** Days until expiry (negative once past), or null when there's no expiry. */
export function daysUntilExpiry(state) {
  if (!state?.expiryDate) return null;
  const diffMs = new Date(state.expiryDate).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diffMs / 86400000);
}

/** Count this-calendar-month trips for the free-tier 30 trips/month cap. */
export async function tripsThisMonth() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { count, error } = await supabase
    .from("trips")
    .select("id", { count: "exact", head: true })
    .gte("created_at", monthStart);
  if (error) {
    console.warn("trip count fetch failed:", error);
    return 0;
  }
  return count || 0;
}

export async function isFreeTripLimitReached(userId) {
  const state = await getSubscriptionState(userId);
  if (isPremiumTier(state)) return false;
  if (!navigator.onLine) return false; // can't verify offline; server trigger is the safety net
  return (await tripsThisMonth()) >= FREE_TRIP_LIMIT;
}

/** Markup for an in-app expiry/payment-failure warning banner, or "" when none is due. */
export function subscriptionBannerMarkup(state) {
  if (!state) return "";
  if (state.paymentStatus === "failed") {
    return `<div class="subscription-banner subscription-banner-warning">
      <div><strong>Payment failed</strong><span>Update your billing details within ${GRACE_PERIOD_DAYS} days to keep your ${tierLabel(state)} features.</span></div>
      <a class="btn btn-secondary" href="settings.html#billing">Manage billing →</a>
    </div>`;
  }
  const days = daysUntilExpiry(state);
  if (isPremiumTier(state) && days !== null && days <= 7 && days >= 0) {
    return `<div class="subscription-banner">
      <div><strong>Your ${tierLabel(state)} plan expires in ${days} day${days === 1 ? "" : "s"}</strong><span>Renew to keep SARS export and smart analytics.</span></div>
      <a class="btn btn-secondary" href="settings.html#billing">Renew now →</a>
    </div>`;
  }
  return "";
}
