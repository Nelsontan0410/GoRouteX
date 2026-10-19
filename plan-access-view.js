/**
 * Plan page view helpers (presentation only): labels, the one-line status, usage rows with their warning level,
 * and whether the Upgrade / Manage links are shown. Pure functions: no DOM, no network, no storage. All numbers
 * come from the existing usage and billing code; this file only decides how they are shown.
 * Exposes window.GoRouteXPlanAccess.
 */
(function (root) {
  const PLAN_NAMES = { basic: 'Basic', goplan: 'Go', proplan: 'Pro' };
  const planName = (key) => PLAN_NAMES[String(key || '').toLowerCase()] || 'Basic';

  function toMillis(value) {
    if (value === null || value === undefined || value === '') return null;
    const date = typeof value?.toDate === 'function' ? value.toDate() : value instanceof Date ? value : new Date(value);
    const ms = date.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  /** Whole days left until `expiry` (0 when it is today or past); null when there is no usable date. */
  function daysLeft(expiry, now = Date.now()) {
    const end = toMillis(expiry);
    if (end === null) return null;
    return Math.max(0, Math.ceil((end - now) / 86400000));
  }

  /** The single status shown next to the plan name. */
  function statusInfo(billingState = {}, expiry = null, now = Date.now()) {
    switch (billingState.key) {
      case 'developer': return { text: 'Developer access', tone: 'developer' };
      case 'trialing': {
        const days = daysLeft(expiry, now);
        return { text: days === null ? 'Trial' : `Trial · ${days} day${days === 1 ? '' : 's'} left`, tone: 'trial' };
      }
      case 'grace': return { text: 'Payment issue', tone: 'warn' };
      case 'expired': return { text: 'Subscription ended', tone: 'warn' };
      default:
        return { text: billingState.label === 'Cancellation scheduled' ? billingState.label : 'Active', tone: 'ok' };
    }
  }

  /** Upgrade is hidden on the highest plan and for developer access; subscribers keep a Manage link. */
  function upgradeInfo(planKey, billingState = {}, hasSubscription = false) {
    const developer = billingState.key === 'developer';
    const highest = String(planKey).toLowerCase() === 'proplan' && billingState.key !== 'expired';
    return { showUpgrade: !developer && !highest, showManage: !developer && Boolean(hasSubscription) };
  }

  /**
   * One usage row. Warning only from 80%: amber below the limit, red at or over it. Under 80% there is no
   * helper text at all. limit may be Infinity (no cap).
   */
  function usageRow({ label, noun, used, limit }) {
    const usedCount = Number(used) || 0;
    const capped = Number.isFinite(limit) && limit > 0;
    const percent = capped ? Math.min(100, Math.floor((usedCount / limit) * 100)) : 0;
    const level = !capped ? 'ok' : usedCount >= limit ? 'red' : percent >= 80 ? 'amber' : 'ok';
    const warning = level === 'red' ? `${noun} limit reached.` : level === 'amber' ? `Approaching your ${noun.toLowerCase()} limit.` : '';
    return { label, valueText: capped ? `${usedCount} / ${limit}` : String(usedCount), used: usedCount, limit: capped ? limit : null, percent, level, warning };
  }

  /** "Max 10 stops per route." from the existing display string (for example "10 stops/route"). */
  function maxStopsLine(stopsPerRouteText) {
    const match = /\d+/.exec(String(stopsPerRouteText || ''));
    return match ? `Max ${match[0]} stops per route.` : '';
  }

  root.GoRouteXPlanAccess = { PLAN_NAMES, planName, daysLeft, statusInfo, upgradeInfo, usageRow, maxStopsLine };
})(typeof window !== 'undefined' ? window : globalThis);
