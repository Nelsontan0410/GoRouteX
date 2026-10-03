import {
  BILLING_CURRENCIES,
  BILLING_OFFERS,
  hasAbnormalRateMove,
  isFreshTimestamp,
  quoteOffer
} from './billing-domain.js';
import { stripeRequest, validateStripePrice } from './stripe-api.js';
import { DRIVER_LIMITS } from './driver-domain.js';

function getEnv(name) {
  return Netlify.env.get(name) || '';
}

function timestampToIso(value) {
  if (!value) return '';
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function getFxMaxAgeHours() {
  return Math.max(1, Number(getEnv('BILLING_FX_MAX_AGE_HOURS') || 30));
}

export function getFxMaxChangePercent() {
  return Math.max(1, Number(getEnv('BILLING_FX_MAX_CHANGE_PERCENT') || 20));
}

export function isCatalogUsable(catalog, now = Date.now()) {
  if (!catalog || !catalog.version || !catalog.rates) return false;
  return isFreshTimestamp(timestampToIso(catalog.fxUpdatedAt), now, getFxMaxAgeHours());
}

export function publicCatalog(catalog) {
  const offers = Object.values(BILLING_OFFERS).flatMap((intervals) => Object.values(intervals));
  return {
    version: catalog?.version || '',
    configured: Boolean(getEnv('STRIPE_SECRET_KEY') && getEnv('STRIPE_WEBHOOK_SECRET')),
    updatedAt: timestampToIso(catalog?.fxUpdatedAt),
    isFresh: isCatalogUsable(catalog),
    currencies: BILLING_CURRENCIES,
    driverLimits: DRIVER_LIMITS,
    offers: offers.map((offer) => BILLING_CURRENCIES.map((currency) => {
      const stored = catalog?.offers?.[offer.plan]?.[offer.interval]?.[currency] || {};
      return {
        ...quoteOffer(offer.plan, offer.interval, currency, catalog?.rates || {}),
        amount: Number.isFinite(Number(stored.amount)) ? Number(stored.amount) : null,
        priceId: stored.priceId || '',
        available: Boolean(stored.priceId && Number(stored.amount) > 0 && getEnv('STRIPE_SECRET_KEY') && getEnv('STRIPE_WEBHOOK_SECRET')) && (currency === 'SGD' || isCatalogUsable(catalog))
      };
    }))
  };
}

const configuredPriceNames = Object.freeze({
  goplan: { month: 'STRIPE_PRICE_GO_MONTHLY' },
  proplan: { month: 'STRIPE_PRICE_PRO_MONTHLY', year: 'STRIPE_PRICE_PRO_YEARLY' }
});
let configuredCatalogCache = null;
let configuredCatalogCachedAt = 0;

export async function getBillingCatalog(db) {
  const snapshot = await db.collection('billingCatalog').doc('current').get();
  const hasConfiguredPrices = Object.values(configuredPriceNames).some((intervals) =>
    Object.values(intervals).some((name) => Boolean(getEnv(name))));
  if (!hasConfiguredPrices) return snapshot.exists ? snapshot.data() || {} : {};
  if (!getEnv('STRIPE_SECRET_KEY')) return {};
  if (configuredCatalogCache && Date.now() - configuredCatalogCachedAt < 5 * 60 * 1000) return configuredCatalogCache;
  const offers = {};
  for (const [plan, intervals] of Object.entries(configuredPriceNames)) {
    for (const [interval, name] of Object.entries(intervals)) {
      const priceId = getEnv(name);
      if (!priceId) continue;
      const price = await validateStripePrice(priceId, { currency: 'SGD', interval });
      offers[plan] ||= {};
      offers[plan][interval] = { SGD: { amount: price.unit_amount / 100, priceId: price.id } };
    }
  }
  configuredCatalogCache = { version: 'configured', rates: { SGD: 1 }, offers, fxUpdatedAt: new Date() };
  configuredCatalogCachedAt = Date.now();
  return configuredCatalogCache;
}

export async function getOrCreateStripeCustomer({ db, userRef, profile, uid, email, name }) {
  const customerId = profile.stripeCustomerId || (await stripeRequest('/customers', {
    method: 'POST',
    data: {
      email: email || undefined,
      name: name || undefined,
      metadata: { goroutex_uid: uid }
    },
    idempotencyKey: `goroutex-customer-${uid}`
  })).id;
  const mappingRef = db.collection('billingCustomers').doc(customerId);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(mappingRef);
    if (existing.exists && existing.data()?.uid !== uid) throw new Error('Stripe customer belongs to another workspace.');
    transaction.set(mappingRef, { uid, updatedAt: new Date() }, { merge: true });
    transaction.set(userRef, { stripeCustomerId: customerId, updatedAt: new Date() }, { merge: true });
  });
  return customerId;
}

export async function resolveUserIdFromStripeObject(db, object = {}) {
  const metadataUid = String(object?.metadata?.goroutex_uid || object?.client_reference_id || '').trim();
  const customerId = String(object?.customer || '').trim();
  if (!customerId) return '';
  const snapshot = await db.collection('billingCustomers').doc(customerId).get();
  const mappedUid = snapshot.exists ? String(snapshot.data()?.uid || '') : '';
  if (!mappedUid || (metadataUid && metadataUid !== mappedUid)) {
    throw new Error('Stripe customer does not match the workspace billing account.');
  }
  return mappedUid;
}

export async function fetchTrustedFxRates() {
  const url = getEnv('BILLING_FX_RATE_URL');
  if (!url) throw new Error('BILLING_FX_RATE_URL is not configured.');
  const apiKey = getEnv('BILLING_FX_API_KEY');
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.rates) throw new Error('The configured FX provider did not return rates.');
  const rates = { SGD: 1, MYR: Number(payload.rates.MYR), USD: Number(payload.rates.USD) };
  if (!Number.isFinite(rates.MYR) || rates.MYR <= 0 || !Number.isFinite(rates.USD) || rates.USD <= 0) {
    throw new Error('The configured FX provider returned invalid MYR or USD rates.');
  }
  return rates;
}

function stripeProductForPlan(plan) {
  return getEnv(plan === 'goplan' ? 'STRIPE_PRODUCT_GOPLAN' : 'STRIPE_PRODUCT_PROPLAN');
}

export async function createCatalogVersion({ db, now = new Date(), allowAbnormalMove = false } = {}) {
  const previous = await getBillingCatalog(db);
  const rates = await fetchTrustedFxRates();
  if (!allowAbnormalMove && previous?.rates && hasAbnormalRateMove(previous.rates, rates, getFxMaxChangePercent())) {
    throw new Error('FX rates moved beyond the configured safety threshold. No new Stripe prices were created.');
  }

  const version = `fx-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const offers = {};
  for (const [plan, intervals] of Object.entries(BILLING_OFFERS)) {
    const product = stripeProductForPlan(plan);
    if (!product) throw new Error(`Missing Stripe product configuration for ${plan}.`);
    offers[plan] = {};
    for (const [interval, offer] of Object.entries(intervals)) {
      offers[plan][interval] = {};
      for (const currency of BILLING_CURRENCIES) {
        const quote = quoteOffer(plan, interval, currency, rates);
        const price = await stripeRequest('/prices', {
          method: 'POST',
          data: {
            product,
            currency: currency.toLowerCase(),
            unit_amount: quote.amount * 100,
            recurring: { interval },
            metadata: {
              goroutex_plan: plan,
              goroutex_interval: interval,
              goroutex_currency: currency,
              goroutex_price_version: version,
              goroutex_sgd_base: offer.sgdAmount
            }
          },
          idempotencyKey: `goroutex-${version}-${plan}-${interval}-${currency}`
        });
        offers[plan][interval][currency] = { amount: quote.amount, priceId: price.id };
      }
    }
  }

  const catalog = { version, rates, offers, fxUpdatedAt: now, createdAt: now };
  await db.collection('billingCatalog').doc('current').set(catalog, { merge: true });
  await db.collection('billingCatalog').doc(version).set(catalog, { merge: true });
  return catalog;
}
