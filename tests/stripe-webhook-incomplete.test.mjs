import test from 'node:test';
import assert from 'node:assert/strict';
import { applySubscription } from '../netlify/functions/stripe-webhook.js';

const SERVER_TIME = 'server-time';
const firebaseAdmin = {
  firestore: {
    FieldValue: { serverTimestamp: () => SERVER_TIME },
    Timestamp: { fromDate: (date) => date, fromMillis: (ms) => new Date(ms) }
  }
};

function fakeDb(profile) {
  const state = { profile: { ...profile }, events: [] };
  const userRef = {
    async get() { return { exists: true, data: () => state.profile }; },
    async set(data) { state.profile = { ...state.profile, ...data }; },
    collection: () => ({ doc: () => ({ async set(event) { state.events.push(event); } }), add: async (event) => { state.events.push(event); } })
  };
  return { db: { collection: () => ({ doc: () => userRef }) }, state };
}

const subscription = (status) => ({
  id: 'sub_1', customer: 'cus_1', status, currency: 'sgd',
  current_period_end: 1893456000, metadata: { goroutex_plan: 'pro' }, items: { data: [{ price: { id: 'price_1' } }] }
});

test('incomplete subscription links the subscription but grants no paid plan', async () => {
  const { db, state } = fakeDb({ productPlanKey: 'basic', productPlan: 'basic', planStatus: 'trial', billingStatus: 'basic' });
  await applySubscription(db, firebaseAdmin, 'u1', subscription('incomplete'), 'customer.subscription.created', 'evt_1');
  assert.equal(state.profile.productPlanKey, 'basic');
  assert.equal(state.profile.planStatus, 'trial');
  assert.equal(state.profile.billingStatus, 'incomplete');
  assert.equal(state.profile.stripeSubscriptionId, 'sub_1');
  assert.equal('planExpiresAt' in state.profile, false);
});

test('incomplete_expired releases the link without touching the plan', async () => {
  const { db, state } = fakeDb({ productPlanKey: 'basic', planStatus: 'trial', billingStatus: 'incomplete', stripeSubscriptionId: 'sub_1' });
  await applySubscription(db, firebaseAdmin, 'u1', subscription('incomplete_expired'), 'customer.subscription.updated', 'evt_2');
  assert.equal(state.profile.stripeSubscriptionId, '');
  assert.equal(state.profile.billingStatus, 'basic');
  assert.equal(state.profile.planStatus, 'trial');
});

test('incomplete_expired after access was granted downgrades to basic', async () => {
  const { db, state } = fakeDb({ productPlanKey: 'pro', planStatus: 'active', billingStatus: 'grace', stripeSubscriptionId: 'sub_1' });
  await applySubscription(db, firebaseAdmin, 'u1', subscription('incomplete_expired'), 'customer.subscription.updated', 'evt_3');
  assert.equal(state.profile.productPlanKey, 'basic');
  assert.equal(state.profile.planStatus, 'expired');
});
