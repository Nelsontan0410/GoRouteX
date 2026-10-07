import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ctx = vm.createContext({ sessionStorage: { setItem() {}, getItem: () => null } });
ctx.window = ctx;
vm.runInContext(read('delivery-constraints.js'), ctx);
vm.runInContext(read('orders/route-plan-selection.js'), ctx);
const C = ctx.GoRouteXDeliveryConstraints;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('an order window narrows every day of the customer schedule; lunch is kept only if still inside', () => {
  const s = plain(C.restrictSchedule(C.defaultSchedule(), '10:00', '12:30'));
  assert.deepEqual(s.monday, { open: true, windows: [{ start: '10:00', end: '12:30' }], breaks: [] });
  const wide = plain(C.restrictSchedule(C.defaultSchedule(), '08:00', '20:00'));
  assert.deepEqual(wide.friday, { open: true, windows: [{ start: '09:00', end: '18:00' }], breaks: [{ start: '12:00', end: '13:00' }] });
  const none = plain(C.restrictSchedule(C.defaultSchedule(), '19:00', '20:00'));
  assert.equal(none.monday.open, false, 'no overlap: closed for that order');
  assert.equal(C.validateSchedule(none).valid, true);
});

test('Order Hub hand-off carries per-stop windows (overlap) and service minutes (longest)', () => {
  const orders = [
    { internalId: 'o1', savedStopId: 's1', status: 'READY', deliveryDate: '2026-10-05', deliveryTime: '09:00', timeWindowStart: '09:00', timeWindowEnd: '12:00', serviceTimeMinutes: 10 },
    { internalId: 'o2', savedStopId: 's1', status: 'READY', deliveryDate: '2026-10-05', deliveryTime: '09:00', timeWindowStart: '10:00', timeWindowEnd: '14:00', serviceTimeMinutes: 25 },
    { internalId: 'o3', savedStopId: 's2', status: 'READY', deliveryDate: '2026-10-05', deliveryTime: '09:00', timeWindowStart: '09:00' }
  ];
  const stops = [{ id: 's1', address: 'A' }, { id: 's2', address: 'B' }];
  const prepared = plain(ctx.GoRouteXOrderPlan.prepare(orders, stops, 50));
  assert.deepEqual(prepared.stopConstraints, { s1: { windowStart: '10:00', windowEnd: '12:00', serviceMinutes: 25 } });
});

test('the effective customer rules include the order window and service time (planner and confirmation check)', () => {
  const app = read('app.html');
  const fn = app.slice(app.indexOf('function getCustomerDeliveryConstraints('), app.indexOf('function getDefaultStayMinutesForStop('));
  assert.match(fn, /orderPlan\?\.stopConstraints\?\.\[String\(customerId\)\]/);
  assert.match(fn, /C\.restrictSchedule\(resolved\.schedule, fromOrders\.windowStart, fromOrders\.windowEnd\)/);
  assert.match(fn, /if \(fromOrders\.serviceMinutes\) resolved\.serviceMinutes = fromOrders\.serviceMinutes;/);
});
