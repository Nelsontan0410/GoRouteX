import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GRACE_DURATION_MS,
  getGraceEndsAt,
  getOffer,
  hasAbnormalRateMove,
  isDeveloperBillingExempt,
  isFreshTimestamp,
  quoteInWholeMajorUnits,
  quoteOffer
} from '../netlify/functions/_shared/billing-domain.js';

test('billing offers exactly match the approved plan and interval matrix', () => {
  assert.deepEqual(getOffer('goplan', 'month'), { plan: 'goplan', interval: 'month', sgdAmount: 5 });
  assert.deepEqual(getOffer('proplan', 'month'), { plan: 'proplan', interval: 'month', sgdAmount: 20 });
  assert.deepEqual(getOffer('proplan', 'year'), { plan: 'proplan', interval: 'year', sgdAmount: 200 });
  assert.equal(getOffer('goplan', 'year'), null);
  assert.equal(getOffer('basic', 'month'), null);
});

test('foreign-currency prices are converted from SGD and always rounded upward', () => {
  assert.equal(quoteInWholeMajorUnits(5, 'SGD', {}), 5);
  assert.equal(quoteInWholeMajorUnits(5, 'MYR', { MYR: 3.011 }), 16);
  assert.equal(quoteInWholeMajorUnits(20, 'USD', { USD: 0.743 }), 15);
  assert.equal(quoteInWholeMajorUnits(200, 'USD', { USD: 0.743 }), 149);
  assert.deepEqual(quoteOffer('proplan', 'year', 'MYR', { MYR: 3.011 }), {
    plan: 'proplan', interval: 'year', sgdAmount: 200, currency: 'MYR', amount: 603
  });
});

test('stale FX data and abnormal moves are rejected before a new price version is used', () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  assert.equal(isFreshTimestamp(new Date(now - 29 * 60 * 60 * 1000), now, 30), true);
  assert.equal(isFreshTimestamp(new Date(now - 31 * 60 * 60 * 1000), now, 30), false);
  assert.equal(hasAbnormalRateMove({ MYR: 3.1, USD: 0.74 }, { MYR: 3.2, USD: 0.75 }, 20), false);
  assert.equal(hasAbnormalRateMove({ MYR: 3.1, USD: 0.74 }, { MYR: 4.0, USD: 0.75 }, 20), true);
});

test('a payment grace period is fixed at 72 hours and is never extended by retries', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');
  const initial = getGraceEndsAt({ now });
  assert.equal(initial.getTime(), now.getTime() + GRACE_DURATION_MS);
  const retry = getGraceEndsAt({ existingGraceEndsAt: initial, now: new Date(now.getTime() + 60 * 60 * 1000) });
  assert.equal(retry.getTime(), initial.getTime());
  const afterExpiry = getGraceEndsAt({ existingGraceEndsAt: initial, now: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000) });
  assert.equal(afterExpiry.getTime(), initial.getTime());
});

test('only server-stored developer/permanent flags exempt an account from billing', () => {
  assert.equal(isDeveloperBillingExempt({ permanentPlan: true }), true);
  assert.equal(isDeveloperBillingExempt({ developerBillingExempt: true }), true);
  assert.equal(isDeveloperBillingExempt({ developer: true }), false);
  assert.equal(isDeveloperBillingExempt({}), false);
});

test('payment implementation uses Stripe endpoints and removes the legacy manual payment path', () => {
  const checkout = readFileSync(new URL('../netlify/functions/create-stripe-checkout.js', import.meta.url), 'utf8');
  const webhook = readFileSync(new URL('../netlify/functions/stripe-webhook.js', import.meta.url), 'utf8');
  const cancellation = readFileSync(new URL('../netlify/functions/billing-cancel-subscription.js', import.meta.url), 'utf8');
  const portal = readFileSync(new URL('../netlify/functions/billing-customer-portal.js', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(checkout, /payment_method_collection: 'always'/);
  assert.match(checkout, /trial_period_days: 3/);
  assert.match(webhook, /verifyStripeWebhookSignature/);
  assert.match(webhook, /stripeWebhookEvents/);
  assert.match(cancellation, /cancel_at_period_end: true/);
  assert.match(cancellation, /otherReason.length < 3/);
  assert.match(portal, /subscription_update\?\.enabled/);
  assert.match(checkout, /stripeCheckoutPendingAt/);
  assert.match(rules, /!\('developerBillingExempt' in data\)/);
  assert.match(app, /create-stripe-checkout/);
  assert.doesNotMatch(app, /create-pro-checkout/);
  assert.doesNotMatch(app, /requestProPlanUpgrade/);
  const marketing = readFileSync(new URL('../marketing-site.js', import.meta.url), 'utf8');
  const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(marketing, /billing-catalog/);
  assert.doesNotMatch(marketing, /price:'5'|price:'20'/);
  assert.doesNotMatch(homepage, /SGD 5\/month|SGD 20\/month|SGD 200\/year/);
});
