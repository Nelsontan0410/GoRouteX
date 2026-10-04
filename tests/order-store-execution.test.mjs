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

test('deleteOrders commits in batches of at most 500', async () => {
  const commits = [];
  installFirestore(new Map());
  globalThis.firebase.firestore = Object.assign(() => ({
    collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}`, collection: (sub) => ({ doc: (orderId) => ({ path: `${name}/${id}/${sub}/${orderId}` }) }) }) }),
    batch() { const deletes = []; return { delete: (ref) => deletes.push(ref.path), commit: async () => { commits.push(deletes.length); } }; }
  }), {});
  const ids = Array.from({ length: 1201 }, (_, index) => `o${index}`);
  assert.equal(await new OrderStore({ uid: 'u1' }).deleteOrders(ids), 1201);
  assert.deepEqual(commits, [500, 500, 201]);
});

test('saveImport runs rows with bounded concurrency and skips exact duplicates', async () => {
  const docs = new Map();
  installFirestore(docs);
  let active = 0, peak = 0;
  const fs = globalThis.firebase.firestore;
  globalThis.firebase.firestore = Object.assign(() => {
    const base = fs();
    return { ...base, async runTransaction(fn) { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 2)); try { return await base.runTransaction(fn); } finally { active--; } } };
  }, {});
  const store = new OrderStore({ uid: 'u1' });
  const batches = new Map();
  store.batches = () => ({ doc: (id) => ({ set: async (v) => batches.set(id, v), update: async (v) => batches.set(id, { ...batches.get(id), ...v }) }) });
  const rows = Array.from({ length: 30 }, (_, index) => ({ internalId: `r${index}`, orderId: `DO-${index}`, customerName: 'C', address: `Street ${index}`, deliveryDate: '2026-10-05', duplicateKind: index === 0 ? 'EXACT' : null }));
  const result = await store.saveImport(rows, {});
  assert.equal(result.saved, 29);
  assert.ok(peak > 1 && peak <= 10, `peak concurrency ${peak}`);
  assert.equal([...batches.values()][0].state, 'COMPLETE');
});
