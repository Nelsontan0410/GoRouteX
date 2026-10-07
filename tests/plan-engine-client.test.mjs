import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = read('app.html');

function client({ enabled = true, fetchImpl, plan = 'proplan' } = {}) {
  const ctx = ({
    window: { localStorage: { getItem: (k) => (k === 'goroutexPlanner' && enabled ? 'on' : null) }, GoRouteXSettings: { getCachedSettings: () => ({ drivers: { workingStart: '08:00', workingEnd: '17:00', breakMinutes: 60, maxStops: 20 }, routePlanning: { maxDurationMinutes: 480 } }) } },
    AbortController, setTimeout, clearTimeout, console,
    fetch: fetchImpl || (async () => { throw new Error('no fetch'); }),
    currentLocationOrigin: 'origin',
    getRouteStartDateTime: () => new Date(2026, 9, 5, 9, 0),
    getLocationInput: () => ({ lat: () => 1.33, lng: () => 103.74 }),
    getCurrentUserIdToken: async () => 'token',
    getPackedRouteStopId: (s) => s.id,
    getCurrentProductPlan: () => plan
  });
  return ctx;
}

function load(options) {
  const ctx = vm.createContext({});
  const base = client(options);
  Object.assign(ctx, base);
  ctx.window = ctx;
  ctx.localStorage = base.window.localStorage;
  ctx.GoRouteXSettings = base.window.GoRouteXSettings;
  vm.runInContext(read('delivery-constraints.js'), ctx);
  vm.runInContext(read('planner-problem.js'), ctx);
  ctx.getCustomerDeliveryConstraints = (id) => ({ schedule: ctx.GoRouteXDeliveryConstraints.defaultSchedule(), serviceMinutes: 15, scheduleMode: 'default', serviceMode: 'default' });
  vm.runInContext(read('planning/plan-engine-client.js') + '\nthis.plan = planWithPlanEngine; this.enabled = isPlanEngineEnabled;', ctx);
  return ctx;
}
const stops = [{ id: 'a', lat: 1.30, lng: 103.80 }, { id: 'b', lat: 1.31, lng: 103.82 }];
const plain = (v) => JSON.parse(JSON.stringify(v));

test('off by default: the switch is false and nothing is sent', async () => {
  assert.match(read('planning/plan-engine-client.js'), /const PLAN_ENGINE_ENABLED = false;/);
  let called = 0;
  const ctx = load({ enabled: false, fetchImpl: async () => { called++; } });
  assert.equal((await ctx.plan(stops, 'end', 'session-aaa1')).fallback, 'disabled');
  assert.equal(called, 0);
});

test('a solution becomes routes of the original stop objects, with unassigned stops and reasons', async () => {
  let sent;
  const ctx = load({ fetchImpl: async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ success: true, solution: { routes: [{ vehicle: 1, steps: [{ type: 'job', id: 2, arrival: 33000, waiting_time: 0 }] }], unassigned: [{ id: 1 }] } }) };
  } });
  const result = plain(await ctx.plan(stops, 'end', 'session-aaa1'));
  assert.equal(sent.action, 'solve');
  assert.equal(sent.sessionId, 'session-aaa1');
  assert.equal(sent.problem.jobs.length, 2);
  assert.deepEqual(result.routes.map((r) => r.stops.map((s) => s.id)), [['b']]);
  assert.equal(result.unassigned[0].id, 'a');
  assert.equal(result.unassigned[0].reason, 'no-feasible-route');
});

test('service unavailable, timeout or stops outside Singapore fall back to the existing planner', async () => {
  const down = load({ fetchImpl: async () => ({ ok: false, json: async () => ({ success: false, code: 'planner-unavailable' }) }) });
  assert.equal((await down.plan(stops, 'end', 'session-aaa1')).fallback, 'planner-unavailable');
  const offline = load({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal((await offline.plan(stops, 'end', 'session-aaa1')).fallback, 'network');
  const jb = load({ fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.match((await jb.plan([{ id: 'x', lat: 1.49, lng: 103.76 }], 'end', 'session-aaa1')).fallback, /outside Singapore/);
  assert.equal((await jb.plan(stops, 'end', null)).fallback, 'no-session');
});

test('route generation tries the Plan Engine first; Basic never falls back to paid Google optimisation', () => {
  const generator = app.slice(app.indexOf('async function generateOptimizedActiveRoutesFromSelection('), app.indexOf('validatePackedActiveRoutes(window._activeRoutes, maxPerRoute);', app.indexOf('async function generateOptimizedActiveRoutesFromSelection(')));
  assert.ok(generator.indexOf('planWithPlanEngine(safeStops, destinationId, window._autoPlanSessionId)') < generator.indexOf('optimizeWaypoints: true'));
  assert.match(generator, /getCurrentProductPlan\(\) === 'basic' && \['planner-failed', 'planner-unavailable', 'planner-timeout', 'timeout', 'network'\]\.includes\(engine\.fallback\)/);
  const entry = read('planning/manual-assignment-page.js');
  assert.match(entry, /window\._autoPlanSessionId = autoPlan\.sessionId;/);
  assert.match(entry, /unassignedStops = Array\.isArray\(window\._plannerUnassignedIds\) \? \[\.\.\.window\._plannerUnassignedIds\] : \[\];/);
  assert.match(app, /pageId === 'page-select-stops'\) \{\s*refreshAutoPlanStatus\(\);\s*warmPlanEngine\(\);/);
  const order = ['planner-problem.js', 'planning/plan-engine-client.js'].map((f) => app.indexOf(`<script src="${f}"></script>`));
  assert.ok(order[0] > app.indexOf('<script src="delivery-constraints.js"></script>') && order[1] > order[0]);
});
