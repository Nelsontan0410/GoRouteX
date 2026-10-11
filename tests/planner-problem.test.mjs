import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../delivery-constraints.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(readFileSync(new URL('../planner-problem.js', import.meta.url), 'utf8'), ctx);
const C = ctx.GoRouteXDeliveryConstraints;
const P = ctx.GoRouteXPlannerProblem;
const plain = (v) => JSON.parse(JSON.stringify(v));
const depot = { lat: 1.33, lng: 103.74 };
const monday9 = new Date(2026, 9, 5, 9, 0);
const stop = (id, extra = {}) => ({ id, lat: 1.3 + id.length / 1000, lng: 103.8, serviceMinutes: 20, schedule: C.defaultSchedule(), ...extra });
const rules = { workingStart: '08:00', workingEnd: '17:00', breakMinutes: 60, maxStops: 20 };
const input = (stops, extra = {}) => ({ startDate: monday9, origin: depot, end: depot, stops, driverRules: rules, maxDurationMinutes: 480, availableDrivers: 0, ...extra });

test('service must start AND finish inside an allowed period, so windows end service-time early', () => {
  const built = P.buildProblem(input([stop('a')]));
  // Mon 09:00-18:00 minus 12:00-13:00, 20 min service -> start 09:00-11:40 or 13:00-17:40
  assert.deepEqual(plain(built.problem.jobs[0].time_windows), [[32400, 42000], [46800, 63600]]);
  assert.equal(built.problem.jobs[0].service, 1200);
  assert.deepEqual(plain(built.problem.jobs[0].location), [103.8, 1.301]);
});

test('closed days and services longer than any period never reach the solver; they are reported', () => {
  const saturday = new Date(2026, 9, 10, 9, 0);
  const closed = P.buildProblem(input([stop('a')], { startDate: saturday }));
  assert.equal(closed.problem.jobs.length, 0);
  assert.deepEqual(plain(closed.preUnassigned), [{ id: 'a', reason: 'closed', message: 'Closed on Saturday.' }]);
  const long = P.buildProblem(input([stop('a', { serviceMinutes: 400 })]));
  assert.equal(long.preUnassigned[0].reason, 'service-too-long');
});

test('parallel mode (several drivers): all leave at the start time, 10 stops max, fixed cost, company driver rules', () => {
  const stops = Array.from({ length: 21 }, (_, i) => stop(`s${i}`));
  const parallel = (extra = {}) => input(stops, { mode: 'parallel', ...extra });
  const built = P.buildProblem(parallel());
  assert.equal(built.problem.vehicles.length, 3, 'enough vehicles for 21 stops at 10 each');
  const v = built.problem.vehicles[0];
  assert.deepEqual(plain(v.time_window), [32400, 61200], '09:00 until 17:00 working end');
  assert.equal(v.max_tasks, 10);
  assert.equal(v.costs.fixed, P.DEFAULT_ROUTE_FIXED_COST);
  assert.deepEqual(plain(v.breaks[0]), { id: 1, time_windows: [[41400, 52200]], service: 3600 });
  assert.deepEqual(plain(v.start), [103.74, 1.33]);
  assert.equal(P.buildProblem(parallel({ availableDrivers: 5 })).problem.vehicles.length, 5, 'up to the active drivers; the fixed cost decides how many are used');
  assert.equal(P.buildProblem(input([stop('a')], { mode: 'parallel', driverRules: { ...rules, maxStops: 5 } })).problem.vehicles[0].max_tasks, 5);
  assert.equal('end' in P.buildProblem(input([stop('a')], { end: null })).problem.vehicles[0], false, 'open route without an end');
});

test('a plan starting after working hours still gets the maximum route duration', () => {
  const evening = new Date(2026, 9, 5, 18, 0);
  const v = P.buildProblem(input([stop('a')], { startDate: evening })).problem.vehicles[0];
  assert.deepEqual(plain(v.time_window), [64800, 64800 + 480 * 60]);
  assert.equal('breaks' in v, false, 'no break band left');
});

test('the planner is used only for Singapore points with coordinates and a planning time', () => {
  assert.equal(P.unsupportedReason(input([stop('a')])), null);
  assert.match(P.unsupportedReason(input([{ ...stop('a'), lat: 1.49, lng: 103.76 }])), /outside Singapore/, 'Johor Bahru');
  assert.match(P.unsupportedReason(input([{ ...stop('a'), lat: null }])), /no coordinates/);
  assert.match(P.unsupportedReason(input([stop('a')], { origin: { lat: 1.46, lng: 103.76 + 0.5 } })), /start location/);
  assert.match(P.unsupportedReason(input([])), /No stops/);
});

test('the solution maps back to stop IDs per route, with arrival, service start and waiting', () => {
  const built = P.buildProblem(input([stop('a'), stop('bb'), stop('ccc', { schedule: { ...C.defaultSchedule(), monday: { open: false, windows: [], breaks: [] } } })], { mode: 'parallel' }));
  const solution = {
    routes: [
      { vehicle: 2, steps: [{ type: 'start', arrival: 32400 }, { type: 'job', id: 1, arrival: 33000, waiting_time: 0 }, { type: 'end', arrival: 34000 }] },
      { vehicle: 1, steps: [{ type: 'start' }, { type: 'job', id: 2, arrival: 31800, waiting_time: 600 }, { type: 'break', id: 1 }, { type: 'end' }] }
    ],
    unassigned: []
  };
  const mapped = plain(P.mapSolution(solution, built));
  assert.deepEqual(mapped.routes.map((r) => r.stopIds), [['bb'], ['a']], 'vehicle order');
  assert.deepEqual(mapped.routes[0].stops[0], { id: 'bb', arrival: '08:50', serviceStart: '09:00', waitMinutes: 10 });
  assert.deepEqual(mapped.unassigned.map((u) => [u.id, u.reason]), [['ccc', 'closed']]);
  const withUnassigned = plain(P.mapSolution({ routes: [], unassigned: [{ id: 1 }] }, built));
  assert.equal(withUnassigned.unassigned.find((u) => u.id === 'a').reason, 'no-feasible-route');
});

test('capacity: one vehicle per active vehicle with a capacity, loads on jobs, clearer unassigned reason', () => {
  const built = P.buildProblem(input([stop('a', { demand: 120.4 }), stop('bb', { demand: null })], { mode: 'parallel', capacity: { vehicles: [500, 300.9] } }));
  assert.equal(built.problem.vehicles.length, 2);
  assert.deepEqual(plain(built.problem.vehicles.map((v) => v.capacity)), [[500], [300]]);
  assert.deepEqual(plain(built.problem.jobs.map((j) => j.delivery)), [[121], [0]], 'rounded up; unknown load counts as 0');
  assert.match(P.mapSolution({ routes: [], unassigned: [{ id: 1 }] }, built).unassigned[0].message, /capacity/);
  const none = P.buildProblem(input([stop('a')]));
  assert.equal('capacity' in none.problem.vehicles[0], false);
  assert.equal('delivery' in none.problem.jobs[0], false);
});


test('sequential (one driver): one vehicle for the whole day, no fixed cost, daily stop limit, largest vehicle capacity', () => {
  const stops = Array.from({ length: 25 }, (_, i) => stop(`s${i}`));
  const built = P.buildProblem(input(stops, { driverRules: { ...rules, maxStops: 30 }, capacity: { vehicles: [500, 800] } }));
  assert.equal(built.mode, 'sequential');
  assert.equal(built.problem.vehicles.length, 1);
  const v = built.problem.vehicles[0];
  assert.equal(v.max_tasks, 30, 'the driver daily limit, not 10');
  assert.equal(v.costs.fixed, 0);
  assert.deepEqual(plain(v.capacity), [800]);
  assert.deepEqual(plain(v.end), [103.74, 1.33], 'the day ends at the configured end');
  assert.equal(P.buildProblem(input(stops, { driverRules: { ...rules, maxStops: 0 } })).problem.vehicles[0].max_tasks, P.LIMITS.maxStops);
});

test('sequential: the visit order is cut into routes of 10 in order, keeping each stop timing', () => {
  const stops = Array.from({ length: 23 }, (_, i) => stop(`s${i}`));
  const built = P.buildProblem(input(stops, { driverRules: { ...rules, maxStops: 50 } }));
  const steps = [{ type: 'start', arrival: 32400 }];
  for (let i = 23; i >= 1; i--) steps.push({ type: 'job', id: i, arrival: 32400 + (24 - i) * 600, waiting_time: 0 });
  steps.push({ type: 'end', arrival: 50000 });
  const mapped = plain(P.mapSolution({ routes: [{ vehicle: 1, steps }], unassigned: [] }, built));
  assert.deepEqual(mapped.routes.map((r) => r.stopIds.length), [10, 10, 3]);
  assert.equal(mapped.routes[0].stopIds[0], 's22', 'visit order kept: the first visited stop opens Route 1');
  assert.equal(mapped.routes[1].stopIds[0], 's12', 'Route 2 continues where Route 1 ended');
  assert.equal(mapped.routes[0].stops[0].arrival, '09:10');
  assert.equal(mapped.routes[2].stops[2].arrival, '12:50');
  assert.deepEqual(plain(P.splitIntoRoutes([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)).map((r) => r.stopIds), [['a', 'b'], ['c']]);
  assert.deepEqual(plain(P.splitIntoRoutes([])), []);
});

test('sequential: unassigned stops say whether the day ran out or the daily stop limit was reached', () => {
  const stops = Array.from({ length: 3 }, (_, i) => stop(`s${i}`));
  const limited = P.buildProblem(input(stops, { driverRules: { ...rules, maxStops: 2 } }));
  const full = { routes: [{ vehicle: 1, steps: [{ type: 'job', id: 1, arrival: 33000 }, { type: 'job', id: 2, arrival: 34000 }] }], unassigned: [{ id: 3 }] };
  const a = plain(P.mapSolution(full, limited)).unassigned[0];
  assert.equal(a.reason, 'daily-limit');
  assert.match(a.message, /daily stop limit \(2, Settings > Drivers\)/);
  const roomy = P.buildProblem(input(stops, { driverRules: { ...rules, maxStops: 20 } }));
  const b = plain(P.mapSolution(full, roomy)).unassigned[0];
  assert.equal(b.reason, 'no-feasible-route');
  assert.match(b.message, /remaining working time/);
});
