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

test('vehicles: parallel, all leave at the start time, 8 stops max, fixed cost, company driver rules', () => {
  const stops = Array.from({ length: 17 }, (_, i) => stop(`s${i}`));
  const built = P.buildProblem(input(stops));
  assert.equal(built.problem.vehicles.length, 3, 'enough vehicles for 17 stops at 8 each');
  const v = built.problem.vehicles[0];
  assert.deepEqual(plain(v.time_window), [32400, 61200], '09:00 until 17:00 working end');
  assert.equal(v.max_tasks, 8);
  assert.equal(v.costs.fixed, P.DEFAULT_ROUTE_FIXED_COST);
  assert.deepEqual(plain(v.breaks[0]), { id: 1, time_windows: [[41400, 52200]], service: 3600 });
  assert.deepEqual(plain(v.start), [103.74, 1.33]);
  assert.equal(P.buildProblem(input(stops, { availableDrivers: 5 })).problem.vehicles.length, 5, 'up to the active drivers; the fixed cost decides how many are used');
  assert.equal(P.buildProblem(input([stop('a')], { driverRules: { ...rules, maxStops: 5 } })).problem.vehicles[0].max_tasks, 5);
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
  const built = P.buildProblem(input([stop('a'), stop('bb'), stop('ccc', { schedule: { ...C.defaultSchedule(), monday: { open: false, windows: [], breaks: [] } } })]));
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
