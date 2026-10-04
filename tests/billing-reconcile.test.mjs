import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Netlify = { env: { get: (name) => (name === 'STRIPE_SECRET_KEY' ? 'sk_test_example' : '') } };
const { reconcileGrace } = await import('../netlify/functions/billing-reconcile.js');

const admin = {
  firestore: {
    FieldValue: { serverTimestamp: () => 'server-time' },
    Timestamp: { fromDate: (date) => date }
  }
};

function graceProfiles(count, { throwOn = new Set() } = {}) {
  const writes = new Map();
  const docs = Array.from({ length: count }, (_, index) => {
    const id = `user_${String(index).padStart(4, '0')}`;
    const data = { billingStatus: 'grace', graceEndsAt: new Date('2026-01-01'), stripeSubscriptionId: `sub_${id}`, stripeCustomerId: `cus_${id}` };
    return { id, data: () => data, ref: { id, collection: () => ({ doc: () => ({ id: `${id}_event` }) }) } };
  });
  const query = (start = 0, size = Infinity) => ({
    limit: (n) => query(start, n),
    startAfter: (doc) => query(docs.indexOf(doc) + 1, size),
    get: async () => ({ docs: docs.slice(start, start + size) })
  });
  const db = {
    collection: () => ({ where: () => query() }),
    async runTransaction(fn) {
      return fn({
        get: async (ref) => {
          if (throwOn.has(ref.id)) throw new Error('boom');
          return { data: () => ({ billingStatus: 'grace' }) };
        },
        set: (ref, data) => { writes.set(ref.id, data); }
      });
    }
  };
  return { db, writes };
}

test('one failing profile does not abort the run, and every page is processed', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const id = String(url).split('/subscriptions/')[1];
    return new Response(JSON.stringify({ id, status: 'past_due', customer: id.replace('sub_', 'cus_') }), { status: 200 });
  });
  t.mock.method(console, 'error', () => {});
  const { db, writes } = graceProfiles(260, { throwOn: new Set(['user_0003']) });

  const counts = await reconcileGrace(db, admin, new Date('2026-10-04'));

  assert.equal(counts.failed, 1);
  assert.equal(counts.downgraded, 259);
  assert.equal(writes.get('user_0259')?.billingStatus, 'expired', 'second page reached');
  assert.equal(writes.has('user_0003'), false);
});
