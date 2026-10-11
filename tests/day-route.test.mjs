import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../dispatch/day-route.js', import.meta.url), 'utf8'), ctx);
const D = ctx.GoRouteXDayRoute;
const plain = (v) => JSON.parse(JSON.stringify(v));
const stop = (id) => ({ id, savedStopId: id, customerName: id });

const routes = [
  { id: 1, customerStops: ['a', 'b', 'c'].map(stop), optimizedStops: ['wh', 'a', 'b', 'c'], estimatedDistanceMeters: 30000, estimatedDurationSeconds: 3600,
    manualWaypoints: [{ lat: 1.3, lng: 103.8, legIndex: 1 }],
    detailedStopTimes: [{ stopId: 'wh', departureTime: '2026-10-12T01:00:00.000Z' }, { stopId: 'a', arrivalTimeStr: '9:20 AM' }] },
  { id: 2, customerStops: ['d', 'e'].map(stop), optimizedStops: ['c', 'd', 'e', '__dispatch_base__'], endLocationId: '__dispatch_base__',
    directionsResult: { routes: [{ legs: [{ distance: { value: 5000 }, duration: { value: 600 } }, { distance: { value: 4000 }, duration: { value: 500 } }, { distance: { value: 6000 }, duration: { value: 900 } }] }] },
    safetyWaypoints: [{ lat: 1.31, lng: 103.81, legIndex: 2 }],
    detailedStopTimes: [{ stopId: 'c', departureTime: '2026-10-12T03:00:00.000Z' }, { stopId: '__dispatch_base__', arrivalTime: '2026-10-12T09:50:00.000Z', arrivalTimeStr: '5:50 PM' }] }
];

test('the planned 10-stop groups become one All stops route in driving order', () => {
  const day = plain(D.mergeDayRoute(routes));
  assert.equal(day.id, 'day');
  assert.deepEqual(day.routeIds, ['1', '2']);
  assert.deepEqual(day.customerStops.map((s) => s.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(day.optimizedStops, ['wh', 'a', 'b', 'c', 'd', 'e', '__dispatch_base__'], 'Route 2 starts at c, which is not repeated');
  assert.equal(day.endLocationId, '__dispatch_base__');
  assert.equal(day.estimatedDistanceMeters, 45000);
  assert.equal(day.estimatedDurationSeconds, 5600);
});

test('detour and safety points keep their place in the merged route', () => {
  const day = plain(D.mergeDayRoute(routes));
  assert.equal(day.manualWaypoints[0].legIndex, 1, 'Route 1 leg 1 stays leg 1');
  assert.equal(day.safetyWaypoints[0].legIndex, 5, 'Route 2 leg 2 comes after Route 1’s 3 legs');
});

test('total time from leaving the start to the end of the day includes service and waiting', () => {
  assert.equal(D.dayElapsedSeconds(routes), 8 * 3600 + 50 * 60, '09:00 to 17:50');
  assert.equal(D.mergeDayRoute([]), null);
  assert.equal(D.dayElapsedSeconds([{ detailedStopTimes: [] }]), null);
});

test('Dispatch shows one All stops card with total distance and total time incl. service', () => {
  const board = readFileSync(new URL('../dispatch/dispatch-board.js', import.meta.url), 'utf8');
  assert.match(board, /routes: day \? \[day\] : groups,/);
  assert.match(board, /Total distance \$\{distance\(route\)\} · Driving \$\{duration\(route\)\} · Total time incl\. service \$\{formatSeconds\(route\.dayElapsedSeconds\)\}/);
  const html = readFileSync(new URL('../dispatch.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('dispatch/day-route.js') < html.indexOf('dispatch/dispatch-board.js'));
  const fn = readFileSync(new URL('../netlify/functions/dispatch.js', import.meta.url), 'utf8');
  assert.match(fn, /routeId === DayRoute\.DAY_ROUTE_ID \? DayRoute\.mergeDayRoute\(plan\.plannedRoutes\)/);
  assert.match(fn, /This plan was already dispatched in another way/);
});
