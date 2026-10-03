import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { requireBillingOwner } from '../netlify/functions/_shared/driver-domain.js';
import { getBillingCatalog, publicCatalog, resolveUserIdFromStripeObject } from '../netlify/functions/_shared/billing-store.js';
import { validateStripePrice, verifyStripeWebhookSignature } from '../netlify/functions/_shared/stripe-api.js';

test('billing permissions exclude Drivers, managers, dispatchers and another workspace', () => {
  assert.equal(requireBillingOwner({ uid: 'owner-a' }, { role: 'owner' }), 'owner-a');
  assert.equal(requireBillingOwner({ uid: 'owner-a' }, { role: 'admin', tenantId: 'owner-a' }), 'owner-a');
  for (const profile of [{ role: 'manager' }, { role: 'dispatcher' }, { role: 'admin', tenantId: 'owner-b' }]) {
    assert.throws(() => requireBillingOwner({ uid: 'owner-a' }, profile), /Billing requires/);
  }
  assert.throws(() => requireBillingOwner({ uid: 'drv_123', role: 'driver' }, { role: 'owner' }));
});

test('Stripe Price is server-selected, recurring, active and in the secret-key mode', async () => {
  const previousNetlify = globalThis.Netlify;
  const previousFetch = globalThis.fetch;
  globalThis.Netlify = { env: { get: (name) => name === 'STRIPE_SECRET_KEY' ? 'sk_test_example' : '' } };
  let price = { id: 'price_Go123', active: true, type: 'recurring', recurring: { interval: 'month' }, currency: 'sgd', livemode: false, unit_amount: 500 };
  globalThis.fetch = async () => ({ ok: true, json: async () => price });
  try {
    assert.equal((await validateStripePrice('price_Go123', { currency: 'SGD', interval: 'month' })).unit_amount, 500);
    await assert.rejects(validateStripePrice('customer_unapproved', { currency: 'SGD', interval: 'month' }), /Price ID/);
    price = { ...price, livemode: true };
    await assert.rejects(validateStripePrice('price_Go123', { currency: 'SGD', interval: 'month' }), /key mode/);
    price = { ...price, livemode: false, recurring: { interval: 'year' } };
    await assert.rejects(validateStripePrice('price_Go123', { currency: 'SGD', interval: 'month' }), /recurring offer/);
  } finally {
    globalThis.Netlify = previousNetlify;
    globalThis.fetch = previousFetch;
  }
});

test('configured Stripe prices are read from Stripe rather than displayed from guessed amounts', async () => {
  const previousNetlify = globalThis.Netlify;
  const previousFetch = globalThis.fetch;
  const env = {
    STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example',
    STRIPE_PRICE_GO_MONTHLY: 'price_Go123', STRIPE_PRICE_PRO_MONTHLY: 'price_Pro123'
  };
  globalThis.Netlify = { env: { get: (name) => env[name] || '' } };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => ({ id: url.endsWith('price_Go123') ? 'price_Go123' : 'price_Pro123', active: true, type: 'recurring', recurring: { interval: 'month' }, currency: 'sgd', livemode: false, unit_amount: url.endsWith('price_Go123') ? 700 : 2900 })
  });
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ version: 'stale', offers: { goplan: { month: { SGD: { priceId: 'price_Stale', amount: 99 } } } } }) }) }) }) };
  try {
    const catalog = publicCatalog(await getBillingCatalog(db));
    assert.equal(catalog.configured, true);
    assert.deepEqual(catalog.driverLimits, { basic: 1, goplan: 3, proplan: 10 });
    assert.equal(catalog.offers.flat().find((offer) => offer.plan === 'goplan' && offer.currency === 'SGD').amount, 7);
    assert.equal(catalog.offers.flat().find((offer) => offer.plan === 'proplan' && offer.currency === 'SGD').amount, 29);
  } finally {
    globalThis.Netlify = previousNetlify;
    globalThis.fetch = previousFetch;
  }
});

test('signed events are accepted only with a valid timestamp and signature', () => {
  const payload = JSON.stringify({ id: 'evt_123', type: 'customer.subscription.updated' });
  const timestamp = 1700000000;
  const signature = createHmac('sha256', 'whsec_example').update(`${timestamp}.${payload}`).digest('hex');
  assert.equal(verifyStripeWebhookSignature(payload, `t=${timestamp},v1=${signature}`, 'whsec_example', timestamp), true);
  assert.equal(verifyStripeWebhookSignature(payload, `t=${timestamp},v1=${signature}`, 'wrong_secret', timestamp), false);
  assert.equal(verifyStripeWebhookSignature(payload, `t=${timestamp},v1=${signature}`, 'whsec_example', timestamp + 301), false);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const currentSignature = createHmac('sha256', 'whsec_example').update(`${currentTimestamp}.${payload}`).digest('hex');
  const stripe = new Stripe('sk_test_example');
  assert.equal(stripe.webhooks.constructEvent(payload, `t=${currentTimestamp},v1=${currentSignature}`, 'whsec_example').id, 'evt_123');
  assert.throws(() => stripe.webhooks.constructEvent(payload, `t=${currentTimestamp},v1=${currentSignature}`, 'wrong_secret'));
});

test('webhook customer mapping rejects cross-workspace metadata', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ uid: 'owner-a' }) }) }) }) };
  assert.equal(await resolveUserIdFromStripeObject(db, { customer: 'cus_123', metadata: { goroutex_uid: 'owner-a' } }), 'owner-a');
  await assert.rejects(resolveUserIdFromStripeObject(db, { customer: 'cus_123', metadata: { goroutex_uid: 'owner-b' } }), /does not match/);
  assert.equal(await resolveUserIdFromStripeObject(db, { metadata: { goroutex_uid: 'owner-a' } }), '');
});
