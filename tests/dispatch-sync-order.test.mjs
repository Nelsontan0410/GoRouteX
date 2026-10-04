import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchedOrderIds } from '../netlify/functions/dispatch.js';
import { snapshotRouteStops } from '../driver/route-model.js';

const dispatchData = {
  id: 'owner_plan_1', assignedDriverUid: 'drv_1',
  plannedRoutes: [{
    id: '1',
    customerStops: [
      { id: 'stop-a', name: 'A', address: 'A Street', lat: 1.3, lng: 103.8, orderIds: ['order-1', 'order-2'] },
      { id: 'stop-b', name: 'B', address: 'B Street', lat: 1.31, lng: 103.81, orderIds: ['order-3'] }
    ]
  }]
};

test('sync-order uses order IDs from the dispatched snapshot for that stop only', () => {
  const [stopA, stopB] = snapshotRouteStops(dispatchData);
  assert.deepEqual(dispatchedOrderIds(dispatchData, stopA.id), ['order-1', 'order-2']);
  assert.deepEqual(dispatchedOrderIds(dispatchData, stopB.id), ['order-3']);
});

test('sync-order rejects stops that are not in the dispatched route', () => {
  assert.equal(dispatchedOrderIds(dispatchData, 'forged-stop'), null);
});

test('sync-order no longer reads order IDs from the driver execution doc', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../netlify/functions/dispatch.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Array\.isArray\(stop\.orderIds\) \? stop\.orderIds/);
  assert.match(source, /const orderIds = dispatchedOrderIds\(dispatchDoc\.data\(\), stopId\);/);
});
