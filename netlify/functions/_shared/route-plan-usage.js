import { driverEntitlement } from './driver-domain.js';

// Must match maxSavedRoutesPerDay in route-planner-product.js (a test checks they stay in sync).
export const ROUTE_PLAN_LIMITS = Object.freeze({ basic: 1, goplan: 10, proplan: 50 });
// Customers are in Singapore/Malaysia (UTC+8); "today" follows their calendar day.
const USAGE_TIME_ZONE = 'Asia/Singapore';

export function usageDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: USAGE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function routePlanLimit(profile = {}) {
  return ROUTE_PLAN_LIMITS[driverEntitlement(profile).plan] ?? ROUTE_PLAN_LIMITS.basic;
}

// Counts one route plan per (user, day). Re-consuming the same route ID is free, so a retried save
// is not charged twice. Stored in a top-level collection that clients cannot read or write.
export async function consumeRoutePlan(db, uid, profile, routeId, now = new Date()) {
  const limit = routePlanLimit(profile);
  const ref = db.collection('routePlanUsage').doc(`${uid}_${usageDateKey(now)}`);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const data = doc.exists ? doc.data() || {} : {};
    const routeIds = Array.isArray(data.routeIds) ? data.routeIds : [];
    const used = Number(data.count) || 0;
    if (routeIds.includes(routeId)) return { allowed: true, used, limit };
    if (used >= limit) return { allowed: false, used, limit };
    tx.set(ref, { uid, date: usageDateKey(now), count: used + 1, routeIds: [...routeIds, routeId], updatedAt: now.toISOString() });
    return { allowed: true, used: used + 1, limit };
  });
}
