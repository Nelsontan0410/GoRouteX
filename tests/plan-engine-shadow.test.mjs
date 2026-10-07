import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sanitizeBaselineRoutes, sanitizeCalibrationLegs } from '../netlify/functions/_shared/planner-validation.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

function load({ enabled = false } = {}) {
  const sent = [];
  const ctx = vm.createContext({ console, AbortController, setTimeout, clearTimeout, Promise, Map });
  ctx.window = ctx;
  ctx.localStorage = { getItem: (k) => (k === 'goroutexPlanner' && enabled ? 'on' : null) };
  ctx.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: false, json: async () => ({ success: false, code: 'planner-unavailable' }) }; };
  ctx.getCurrentUserIdToken = async () => 'token';
  ctx.getCurrentProductPlan = () => 'proplan';
  ctx.currentLocationOrigin = 'origin';
  ctx.getRouteStartDateTime = () => new Date(2026, 9, 5, 9, 0);
  ctx.getLocationInput = () => ({ lat: 1.33, lng: 103.74 });
  ctx.getPackedRouteStopId = (s) => s.id;
  ctx.GoRouteXSettings = { getCachedSettings: () => ({ drivers: { workingEnd: '17:00', breakMinutes: 60, maxStops: 20 } }) };
  vm.runInContext(read('delivery-constraints.js'), ctx);
  vm.runInContext(read('planner-problem.js'), ctx);
  ctx.getCustomerDeliveryConstraints = () => ({ schedule: ctx.GoRouteXDeliveryConstraints.defaultSchedule(), serviceMinutes: 15 });
  vm.runInContext(read('planning/plan-engine-client.js') + '\nthis.shadow = runPlanEngineShadow; this.calibrate = sendPlanEngineCalibration;', ctx);
  return { ctx, sent };
}
const stops = [{ id: 'a', lat: 1.30, lng: 103.80 }, { id: 'b', lat: 1.31, lng: 103.82 }, { id: 'c', lat: 1.35, lng: 103.94 }];
const tick = () => new Promise((r) => setTimeout(r, 5));

test('shadow mode sends the plan actually used as job-ID routes, only while the engine is not shown', async () => {
  const { ctx, sent } = load();
  ctx.shadow(stops, 'end', 'session-aaa1', [{ stopIds: ['b', 'a'] }, { stopIds: ['c'] }]);
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, 'shadow');
  assert.deepEqual(sent[0].baselineRoutes, [[2, 1], [3]]);
  assert.equal(sent[0].problem.jobs.length, 3);
  const on = load({ enabled: true });
  on.ctx.shadow(stops, 'end', 'session-aaa1', [{ stopIds: ['a'] }]);
  await tick();
  assert.equal(on.sent.length, 0, 'no shadow when the engine is the plan');
  const outside = load();
  outside.ctx.shadow([{ id: 'x', lat: 1.49, lng: 103.76 }], 'end', 'session-aaa1', []);
  await tick();
  assert.equal(outside.sent.length, 0, 'outside Singapore: skipped');
});

test('calibration sends Google leg durations with endpoints, never network (OSRM) results', async () => {
  const { ctx, sent } = load();
  const leg = (from, to, seconds) => ({ start_location: { lat: () => from[0], lng: () => from[1] }, end_location: { lat: () => to[0], lng: () => to[1] }, duration: { value: seconds } });
  ctx.calibrate([
    { directionsResult: { routes: [{ legs: [leg([1.33, 103.74], [1.35, 103.94], 1900), leg([1.35, 103.94], [1.49, 103.76], 900)] }] } },
    { directionsResult: { _source: 'osrm', routes: [{ legs: [leg([1.3, 103.8], [1.31, 103.82], 300)] }] } }
  ], new Date(2026, 9, 5, 8, 0));
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, 'calibrate');
  assert.equal(sent[0].hour, 8);
  assert.deepEqual(sent[0].legs, [{ from: [103.74, 1.33], to: [103.94, 1.35], google: 1900 }], 'Johor leg and OSRM results excluded');
});

test('server validation for shadow baselines and calibration legs', () => {
  const problem = { jobs: [{ id: 1 }, { id: 2 }] };
  assert.deepEqual(sanitizeBaselineRoutes([[2, 1, 99], 'x'], problem), [[2, 1], []]);
  assert.equal(sanitizeBaselineRoutes('x', problem), null);
  assert.equal(sanitizeCalibrationLegs([{ from: [103.74, 1.33], to: [103.94, 1.35], google: 1900 }]).ok, true);
  assert.equal(sanitizeCalibrationLegs([{ from: [103.74, 1.33], to: [103.76, 1.49], google: 900 }]).ok, false);
  assert.equal(sanitizeCalibrationLegs([]).ok, false);
  const fn = read('netlify/functions/plan-routes.js');
  assert.match(fn, /collection\('planEngineShadow'\)\.add\(/);
  assert.match(fn, /collection\('planEngineCalibration'\)\.add\(\{ uid: user\.uid, hour, legs, edits,/);
  assert.ok(fn.indexOf("body.action === 'shadow'") > fn.indexOf('isActiveSession('), 'shadow runs only for an active session');
});

test('shadow runs only on the existing-planner path; calibration after a successful save', () => {
  const app = read('app.html');
  assert.match(app, /if \(engine\.fallback === 'disabled' && typeof runPlanEngineShadow === 'function'\) runPlanEngineShadow\(/);
  const persistence = read('planning/planning-persistence.js');
  const save = persistence.slice(persistence.indexOf('appLog("Route saved:"'));
  assert.match(save.slice(0, 300), /sendPlanEngineCalibration\(AppState\.plannedRoutes, getRouteStartDateTime\(\), historyEntry\.planEngine\)/);
  const rules = read('firestore.rules');
  assert.doesNotMatch(rules, /planEngineShadow|planEngineCalibration/, 'server-only collections');
});
