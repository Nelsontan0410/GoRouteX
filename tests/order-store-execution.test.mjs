import test from 'node:test';
import assert from 'node:assert/strict';

function installFirestore(docs) {
  const ref = (path) => ({
    path,
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) })
  });
  globalThis.firebase = {
    firestore: Object.assign(() => ({
      collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
      async runTransaction(fn) {
        return fn({
          get: async (target) => ({ exists: docs.has(target.path), data: () => docs.get(target.path) }),
          set: (target, data) => { docs.set(target.path, structuredClone(data)); }
        });
      }
    }), {})
  };
}

const { OrderStore } = await import('../orders/order-store.js');

test('editing an existing order keeps the server-written execution outcome', async () => {
  const path = 'users/u1/orders/o1';
  const docs = new Map([[path, {
    internalId: 'o1', createdAt: '2026-10-01T00:00:00.000Z', customerName: 'Old',
    executionStatus: 'DELIVERED', driverRouteId: 'd1', executionUpdatedAt: '2026-10-02T00:00:00.000Z'
  }]]);
  installFirestore(docs);

  // Stale copy loaded before the driver delivered: no execution fields.
  await new OrderStore({ uid: 'u1' }).saveOrder({ internalId: 'o1', createdAt: '2026-10-01T00:00:00.000Z', customerName: 'New' });

  const saved = docs.get(path);
  assert.equal(saved.customerName, 'New');
  assert.equal(saved.executionStatus, 'DELIVERED');
  assert.equal(saved.driverRouteId, 'd1');
  assert.equal(saved.executionUpdatedAt, '2026-10-02T00:00:00.000Z');
});

test('a stale execution status in the edit does not overwrite a missing server value', async () => {
  const path = 'users/u1/orders/o2';
  const docs = new Map([[path, { internalId: 'o2', createdAt: '2026-10-01T00:00:00.000Z' }]]);
  installFirestore(docs);

  await new OrderStore({ uid: 'u1' }).saveOrder({ internalId: 'o2', createdAt: '2026-10-01T00:00:00.000Z', executionStatus: 'FAILED' });

  assert.equal('executionStatus' in docs.get(path), false);
});
