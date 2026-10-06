import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../delivery-constraints.js', import.meta.url), 'utf8'), context);
vm.runInContext(readFileSync(new URL('../route-time-windows.js', import.meta.url), 'utf8'), context);
const C = context.GoRouteXDeliveryConstraints;
const T = context.GoRouteXTimeWindows;

const depot = { lat: 1.30, lng: 103.80 };
const near = (dLat, dLng) => ({ lat: depot.lat + dLat, lng: depot.lng + dLng });
const morningOnly = () => {
  const s = C.defaultSchedule();
  s.monday = { open: true, windows: [{ start: '09:00', end: '09:40' }], breaks: [] };
  return s;
};
const legs = [{ distance: { value: 12000 }, duration: { value: 1200 }, start_location: depot, end_location: near(0.08, 0) }];
const monday9 = new Date(2026, 9, 5, 9, 0);
const stop = (id, location, schedule = C.defaultSchedule(), serviceMinutes = 15) => ({ id, location, schedule, serviceMinutes });

test('calibration reads average speed and road ratio from real Google legs', () => {
  const model = T.calibrate(legs);
  assert.ok(Math.abs(model.kmh - 36) < 0.01, `kmh ${model.kmh}`);
  assert.ok(model.ratio >= 1 && model.ratio <= 3);
  assert.deepEqual(JSON.parse(JSON.stringify(T.calibrate([]))), { kmh: 30, ratio: 1.4 });
});

test("when Google's order breaks a window, the route is reordered so the customer is served in time", () => {
  const far = stop('far', near(0.06, 0.02));
  const early = stop('early', near(0.05, 0.05), morningOnly());
  const routes = [{ stops: [{ id: 'far' }, { id: 'early' }] }];
  const lookup = { far, early };
  const result = T.applyToPackedRoutes(routes, { origin: depot, end: depot, startDate: monday9, legs, resolveStop: (s) => lookup[s.id] });
  assert.deepEqual([...result.routes[0].stops.map((s) => s.id)], ['early', 'far']);
  assert.deepEqual([...result.changedRouteIndexes], [0]);
  assert.equal(result.remainingViolations.length, 0);
  assert.equal(result.routes[0].timeWindowOrdered, true);
});

test("Google's order is kept when it already respects every window", () => {
  const a = stop('a', near(0.01, 0));
  const b = stop('b', near(0.02, 0));
  const routes = [{ stops: [{ id: 'a' }, { id: 'b' }] }];
  const result = T.applyToPackedRoutes(routes, { origin: depot, end: depot, startDate: monday9, legs, resolveStop: (s) => ({ a, b })[s.id] });
  assert.equal(result.routes[0], routes[0]);
  assert.equal(result.changedRouteIndexes.length, 0);
});

test('impossible windows (closed day) remain as violations to show the planner, not silently accepted', () => {
  const saturday = new Date(2026, 9, 10, 9, 0);
  const a = stop('a', near(0.01, 0));
  const result = T.applyToPackedRoutes([{ stops: [{ id: 'a' }] }], { origin: depot, end: depot, startDate: saturday, legs, resolveStop: () => a });
  assert.equal(result.remainingViolations.length, 1);
  assert.equal(result.remainingViolations[0].reason, 'closed');
});

test('waiting for opening and the lunch break is part of the simulated duration', () => {
  const model = T.calibrate(legs);
  const a = stop('a', near(0.001, 0), C.defaultSchedule(), 20);
  const atLunch = T.simulate([a], { origin: depot, end: null, startMinutes: C.toMinutes('12:25'), day: 'monday', model });
  assert.equal(atLunch.violations.length, 0);
  assert.ok(atLunch.endMinutes >= C.toMinutes('13:20'), 'served after the break, 20 minutes of service');
});

test('routes run in parallel: every route leaves at the planning start time', () => {
  const late = C.defaultSchedule();
  late.monday = { open: true, windows: [{ start: '09:00', end: '09:30' }], breaks: [] };
  const r1 = stop('r1', near(0.05, 0), C.defaultSchedule(), 60);
  const r2 = stop('r2', near(0.001, 0), late, 15);
  const result = T.applyToPackedRoutes([{ stops: [{ id: 'r1' }] }, { stops: [{ id: 'r2' }] }], { origin: depot, end: depot, startDate: monday9, legs, resolveStop: (s) => ({ r1, r2 })[s.id] });
  assert.equal(result.remainingViolations.length, 0, 'route 2 does not wait for route 1');
});

test('routes larger than 8 stops are improved with local search', () => {
  const stops = Array.from({ length: 10 }, (_, i) => stop(`s${i}`, near(0.004 * (i + 1), 0)));
  stops[9].schedule = morningOnly(); // the farthest stop only receives before 09:40
  const order = [...stops].reverse().reverse(); // Google-like nearest-first order puts it last
  const result = T.applyToPackedRoutes([{ stops: order.map((s) => ({ id: s.id })) }], { origin: depot, end: depot, startDate: monday9, legs, resolveStop: (s) => stops.find((x) => x.id === s.id) });
  assert.equal(result.remainingViolations.length, 0);
  assert.ok(result.routes[0].stops.findIndex((s) => s.id === 's9') < 4, 'the morning-only customer moves early');
});

test('without a usable start location or time nothing is reordered', () => {
  const routes = [{ stops: [{ id: 'a' }] }];
  const result = T.applyToPackedRoutes(routes, { origin: null, startDate: monday9, legs, resolveStop: () => stop('a', near(0.01, 0)) });
  assert.equal(result.routes, routes);
  assert.match(result.skipped, /unavailable/);
});
