import { driverEntitlement } from './driver-domain.js';

// Daily automatic-planning allowance. One unit = one entry into Review & Assign (automatic grouping and
// ordering). Saving a route does not use the allowance. When it is used up, planning continues in manual
// mode without the automatic planner.
// Must match maxSavedRoutesPerDay in route-planner-product.js (a test checks they stay in sync).
export const ROUTE_PLAN_LIMITS = Object.freeze({ basic: 2, goplan: 10, proplan: 50 });
// A Stripe trial gets Pro features with a smaller daily allowance.
export const TRIAL_ROUTE_PLAN_LIMIT = 5;
// Customers are in Singapore/Malaysia (UTC+8); "today" follows their calendar day.
const USAGE_TIME_ZONE = 'Asia/Singapore';
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function usageDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: USAGE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isStripeTrial(profile = {}) {
  return String(profile.billingStatus || '').toLowerCase() === 'trialing'
    || String(profile.paymentStatus || '').toLowerCase() === 'trialing';
}

export function routePlanLimit(profile = {}) {
  const plan = driverEntitlement(profile).plan;
  if (plan !== 'basic' && isStripeTrial(profile)) return TRIAL_ROUTE_PLAN_LIMIT;
  return ROUTE_PLAN_LIMITS[plan] ?? ROUTE_PLAN_LIMITS.basic;
}

export function isValidSessionId(value) {
  return SESSION_ID_PATTERN.test(String(value || ''));
}

function usageRef(db, uid, now) {
  return db.collection('routePlanUsage').doc(`${uid}_${usageDateKey(now)}`);
}

function readUsage(doc) {
  const data = doc.exists ? doc.data() || {} : {};
  return {
    used: Number(data.count) || 0,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    refunded: Array.isArray(data.refunded) ? data.refunded : []
  };
}

export async function getRoutePlanStatus(db, uid, profile, now = new Date()) {
  const limit = routePlanLimit(profile);
  const { used } = readUsage(await usageRef(db, uid, now).get());
  return { used, limit, remaining: Math.max(limit - used, 0) };
}

// Uses one automatic plan for this Review & Assign session. The same session ID is never charged twice
// (a retried request is free). Stored in a top-level collection that clients cannot read or write.
export async function consumeRoutePlan(db, uid, profile, sessionId, now = new Date()) {
  const limit = routePlanLimit(profile);
  const ref = usageRef(db, uid, now);
  return db.runTransaction(async (tx) => {
    const usage = readUsage(await tx.get(ref));
    const result = (allowed, used) => ({ allowed, used, limit, remaining: Math.max(limit - used, 0) });
    if (usage.sessions.includes(sessionId)) return result(true, usage.used);
    if (usage.used >= limit) return result(false, usage.used);
    tx.set(ref, { uid, date: usageDateKey(now), count: usage.used + 1, sessions: [...usage.sessions, sessionId], refunded: usage.refunded, updatedAt: now.toISOString() });
    return result(true, usage.used + 1);
  });
}

// Gives back the allowance when the automatic planner could not produce a plan for that session.
export async function refundRoutePlan(db, uid, profile, sessionId, now = new Date()) {
  const limit = routePlanLimit(profile);
  const ref = usageRef(db, uid, now);
  return db.runTransaction(async (tx) => {
    const usage = readUsage(await tx.get(ref));
    const result = (refunded, used) => ({ refunded, used, limit, remaining: Math.max(limit - used, 0) });
    if (!usage.sessions.includes(sessionId) || usage.refunded.includes(sessionId)) return result(false, usage.used);
    const used = Math.max(usage.used - 1, 0);
    tx.set(ref, { uid, date: usageDateKey(now), count: used, sessions: usage.sessions, refunded: [...usage.refunded, sessionId], updatedAt: now.toISOString() });
    return result(true, used);
  });
}

// True when this Review & Assign session used an automatic plan today and was not refunded. The planner
// only runs for such sessions, so the daily allowance cannot be bypassed by calling it directly.
export async function isActiveSession(db, uid, sessionId, now = new Date()) {
  const usage = readUsage(await usageRef(db, uid, now).get());
  return usage.sessions.includes(sessionId) && !usage.refunded.includes(sessionId);
}
