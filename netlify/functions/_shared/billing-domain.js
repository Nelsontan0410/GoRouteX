export const BILLING_CURRENCIES = ['SGD', 'MYR', 'USD'];
export const BILLING_OFFERS = Object.freeze({
  goplan: Object.freeze({
    month: Object.freeze({ plan: 'goplan', interval: 'month', sgdAmount: 5 })
  }),
  proplan: Object.freeze({
    month: Object.freeze({ plan: 'proplan', interval: 'month', sgdAmount: 20 }),
    year: Object.freeze({ plan: 'proplan', interval: 'year', sgdAmount: 200 })
  })
});

export const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
export const GRACE_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

export function normalizePlan(value) {
  const plan = String(value || '').trim().toLowerCase();
  return plan === 'goplan' || plan === 'proplan' ? plan : '';
}

export function normalizeInterval(value) {
  const interval = String(value || '').trim().toLowerCase();
  return interval === 'month' || interval === 'year' ? interval : '';
}

export function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return BILLING_CURRENCIES.includes(currency) ? currency : '';
}

export function getOffer(planValue, intervalValue) {
  const plan = normalizePlan(planValue);
  const interval = normalizeInterval(intervalValue);
  return BILLING_OFFERS[plan]?.[interval] || null;
}

export function isSupportedOffer(planValue, intervalValue) {
  return Boolean(getOffer(planValue, intervalValue));
}

export function isValidPositiveRate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

export function quoteInWholeMajorUnits(sgdAmount, currencyValue, rates = {}) {
  const currency = normalizeCurrency(currencyValue);
  const baseAmount = Number(sgdAmount);
  if (!currency || !Number.isFinite(baseAmount) || baseAmount <= 0) return null;

  const rate = currency === 'SGD' ? 1 : Number(rates[currency]);
  if (!isValidPositiveRate(rate)) return null;

  // The product decision is to round every converted price upward to a whole
  // major currency unit. SGD prices are already whole units and remain exact.
  return Math.ceil(baseAmount * rate);
}

export function quoteOffer(plan, interval, currency, rates = {}) {
  const offer = getOffer(plan, interval);
  const amount = offer ? quoteInWholeMajorUnits(offer.sgdAmount, currency, rates) : null;
  if (!offer || amount === null) return null;
  return {
    ...offer,
    currency: normalizeCurrency(currency),
    amount
  };
}

export function isFreshTimestamp(value, nowMs = Date.now(), maxAgeHours = 30) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value || '').getTime();
  const maxAgeMs = Math.max(1, Number(maxAgeHours) || 30) * 60 * 60 * 1000;
  return Number.isFinite(timestamp) && timestamp <= nowMs && nowMs - timestamp <= maxAgeMs;
}

export function hasAbnormalRateMove(previousRates = {}, nextRates = {}, maxPercent = 20) {
  const limit = Math.max(1, Number(maxPercent) || 20) / 100;
  return ['MYR', 'USD'].some((currency) => {
    const previous = Number(previousRates[currency]);
    const next = Number(nextRates[currency]);
    if (!isValidPositiveRate(previous) || !isValidPositiveRate(next)) return false;
    return Math.abs(next - previous) / previous > limit;
  });
}

export function isDeveloperBillingExempt(profile = {}) {
  // These fields are server-protected in Firestore rules and are never read
  // from checkout input. Existing developer/permanent access remains intact.
  return profile?.permanentPlan === true || profile?.developerBillingExempt === true;
}

export function getGraceEndsAt({ existingGraceEndsAt, now = new Date() } = {}) {
  const existing = new Date(existingGraceEndsAt || '').getTime();
  if (Number.isFinite(existing)) {
    return new Date(existing);
  }
  return new Date(now.getTime() + GRACE_DURATION_MS);
}

export function formatMoney(amount, currency, locale = 'en-SG') {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  } catch (error) {
    return `${currency} ${amount}`;
  }
}
