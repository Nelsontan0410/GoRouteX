import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildMasterIndex } from '../orders/customer-matcher.js';
import { resolveOrder, deliveryOverrideOf } from '../orders/order-readiness.js';
import { enrichPlannedRoutes } from '../driver/route-enrichment.js';

const customer = { id: 'customer-1', name: 'Kong Hwa School' };
const jurong = { id: 'stop-jurong', customerId: customer.id, name: 'Kong Hwa School', address: '1 Jurong East', lat: 1.333, lng: 103.742 };
const tuas = { address: '10 Tuas South Ave', lat: 1.297, lng: 103.632 };
const order = { internalId: 'ord-1', orderId: 'DO1', customerName: 'Kong Hwa School', customerId: customer.id, savedStopId: jurong.id, status: 'READY', deliveryDate: '2026-10-22', baseValidationIssues: [] };
const index = stops => buildMasterIndex({ customers: [customer], stops, contacts: [] });

async function loadPlan() {
  const values = new Map();
  const window = { sessionStorage: { setItem: (k, v) => values.set(k, v), getItem: k => values.get(k) || null, removeItem: k => values.delete(k) } };
  const source = await readFile(new URL('../orders/route-plan-selection.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { window, Date, Error, Map, Set, Number, String, JSON, Math });
  return window.GoRouteXOrderPlan;
}

test('a confirmed one-time address is used for the order; the saved stop is unchanged', () => {
  const row = resolveOrder({ ...order, deliveryOverride: tuas }, index([jurong])).order;
  assert.equal(row.status, 'READY');
  assert.equal(row.savedStopId, jurong.id);
  assert.equal(row.deliveryAddress, tuas.address);
  assert.equal(row.latitude, tuas.lat);
  assert.equal(jurong.address, '1 Jurong East');
});

test('a one-time address is planned even when the saved stop has no map position', () => {
  const noMap = { ...jurong, lat: 0, lng: 0 };
  assert.equal(resolveOrder(order, index([noMap])).order.status, 'NEEDS_REVIEW');
  assert.equal(resolveOrder({ ...order, deliveryOverride: tuas }, index([noMap])).order.status, 'READY');
});

test('a one-time address without a confirmed map position is ignored', () => {
  for (const bad of [{ address: 'Tuas' }, { address: 'Tuas', lat: 0, lng: 0 }, { address: '', lat: 1.3, lng: 103.6 }]) {
    assert.equal(deliveryOverrideOf({ deliveryOverride: bad }), null, JSON.stringify(bad));
  }
  const row = resolveOrder({ ...order, deliveryOverride: { address: 'Tuas' } }, index([jurong])).order;
  assert.equal(row.deliveryAddress, jurong.address);
});

test('resolving a saved order again does not repeat issues, and a deleted stop falls back to the one strong match', () => {
  const noMap = { ...jurong, lat: null, lng: null };
  const first = resolveOrder({ ...order, baseValidationIssues: undefined, validationIssues: [] }, index([noMap])).order;
  const second = resolveOrder(first, index([noMap])).order;
  assert.deepEqual(second.validationIssues, first.validationIssues);
  const reimported = { ...jurong, id: 'stop-new' };
  const relinked = resolveOrder({ ...order, savedStopId: 'stop-deleted' }, index([reimported])).order;
  assert.equal(relinked.savedStopId, 'stop-new');
  assert.equal(relinked.status, 'READY');
});

test('planning sends a one-time address as its own stop and links the order back to it', async () => {
  const plan = await loadPlan();
  const moved = { ...order, deliveryOverride: tuas, timeWindowStart: '09:00', timeWindowEnd: '12:00' };
  const other = { ...order, internalId: 'ord-2', orderId: 'DO2' };
  const selection = plan.prepare([moved, other], [jurong], 10);
  assert.deepEqual(Array.from(selection.stopIds), ['order-address-ord-1', jurong.id]);
  assert.deepEqual(Array.from(selection.selectedAddresses), [tuas.address, jurong.address]);
  assert.equal(selection.oneTimeStops[0].savedStopId, jurong.id);
  assert.equal(selection.oneTimeStops[0].lat, tuas.lat);
  assert.equal(selection.stopConstraints['order-address-ord-1'].windowStart, '09:00');
  plan.save('owner-1', selection);
  assert.equal(plan.read('owner-1').oneTimeStops.length, 1);

  const routes = [{ id: 1, customerStops: [{ id: 'order-address-ord-1', uniqueId: 'order-address-ord-1' }, { id: jurong.id, uniqueId: jurong.id }] }];
  const { plannedRoutes, linkedCount } = enrichPlannedRoutes(routes, [moved, other], '2026-10-22', { selectedOrderIds: ['ord-1', 'ord-2'] });
  assert.equal(linkedCount, 2);
  assert.deepEqual(plannedRoutes[0].customerStops[0].orderIds, ['ord-1']);
  assert.deepEqual(plannedRoutes[0].customerStops[1].orderIds, ['ord-2']);
});

test('customer import: rows that need attention are skipped, not blocking', async () => {
  const app = await readFile(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /runBtn\.disabled = !canConfirmImport \|\| readyCount === 0;/);
  assert.doesNotMatch(app, /Some rows still need attention\. Fix the highlighted addresses and click Recheck Preview before confirming import/);
  assert.match(app, /id="downloadFailedImportRowsBtn"/);
  assert.match(app, /parsedImportPreview = \{ \.\.\.parsedImportPreview, rows: unresolvedRows, skipped: \[\] \};/);
});

test('customer import keeps existing stop ids and replaces a 0,0 position', async () => {
  const app = await readFile(new URL('../app.html', import.meta.url), 'utf8');
  const pick = name => { const start = app.indexOf(`    function ${name}(`); const end = app.indexOf('\n    }\n', start); return app.slice(start, end + 7); };
  const context = { Map, Number, Array };
  vm.runInNewContext(`${pick('getImportDedupKey')}\n${pick('buildFinalImportedStops')}\nthis.build = buildFinalImportedStops;`, context);
  const existing = [{ id: 'stop-1', customerId: 'c1', name: 'Acme', phone: '1', address: '1 Road', lat: 0, lng: 0 }];
  const row = { name: 'Acme', phone: '1', address: '1 Road', unit: '', note: '', lat: 1.3, lng: 103.8 };
  const merged = context.build(existing, [row], 'merge');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'stop-1');
  assert.equal(merged[0].lat, 1.3);
  const replaced = context.build(existing, [row, { ...row, name: 'New' }], 'overwrite');
  assert.equal(replaced[0].id, 'stop-1');
  assert.equal(replaced[0].customerId, 'c1');
  assert.equal(replaced[1].id, undefined);
});
