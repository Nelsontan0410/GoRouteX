import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sanitizePlannerProblem } from '../netlify/functions/_shared/planner-validation.js';
import { consumeRoutePlan, refundRoutePlan, isActiveSession } from '../netlify/functions/_shared/route-plan-usage.js';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../delivery-constraints.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(readFileSync(new URL('../planner-problem.js', import.meta.url), 'utf8'), ctx);
const C = ctx.GoRouteXDeliveryConstraints;
const P = ctx.GoRouteXPlannerProblem;
const sg = { lat: 1.33, lng: 103.74 };
const built = () => JSON.parse(JSON.stringify(P.buildProblem({
  startDate: new Date(2026, 9, 5, 9, 0), origin: sg, end: sg, availableDrivers: 2, maxDurationMinutes: 480,
  driverRules: { workingStart: '08:00', workingEnd: '17:00', breakMinutes: 60, maxStops: 20 },
  stops: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, lat: 1.3 + i / 100, lng: 103.8, serviceMinutes: 15, schedule: C.defaultSchedule() }))
}).problem));

test('every problem the browser builds passes server validation unchanged', () => {
  const problem = built();
  const checked = sanitizePlannerProblem(problem);
  assert.equal(checked.ok, true, checked.error);
  assert.deepEqual(checked.problem, problem);
});

test('validation rejects points outside Singapore, too many stops, routes over 8 stops and bad windows', () => {
  const outside = built(); outside.jobs[0].location = [103.76, 1.49];
  assert.match(sanitizePlannerProblem(outside).error, /outside the service area/);
  const many = built(); many.jobs = Array.from({ length: 101 }, (_, i) => ({ ...many.jobs[0], id: i + 1 }));
  assert.match(sanitizePlannerProblem(many).error, /1-100 stops/);
  const big = built(); big.vehicles[0].max_tasks = 9;
  assert.match(sanitizePlannerProblem(big).error, /out of range/);
  const backwards = built(); backwards.jobs[0].time_windows = [[50000, 40000]];
  assert.match(sanitizePlannerProblem(backwards).error, /ends before it starts/);
  const dup = built(); dup.jobs[1].id = dup.jobs[0].id;
  assert.match(sanitizePlannerProblem(dup).error, /Duplicate/);
});

test('only whitelisted fields are forwarded', () => {
  const problem = built();
  problem.jobs[0].skills = [1]; problem.jobs[0].description = '<script>'; problem.vehicles[0].profile = 'truck'; problem.extra = 'x';
  const clean = sanitizePlannerProblem(problem).problem;
  assert.equal('skills' in clean.jobs[0], false);
  assert.equal('description' in clean.jobs[0], false);
  assert.equal(clean.vehicles[0].profile, 'car');
  assert.equal('extra' in clean, false);
});

test('the planner only runs for a session that used an automatic plan today and was not refunded', async () => {
  const data = new Map();
  const ref = (path) => ({ path, get: async () => ({ exists: data.has(path), data: () => structuredClone(data.get(path)) }) });
  const db = {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(fn) {
      const writes = [];
      const result = await fn({ get: async (t) => ({ exists: data.has(t.path), data: () => structuredClone(data.get(t.path)) }), set: (t, v) => writes.push(() => data.set(t.path, structuredClone(v))) });
      writes.forEach((w) => w());
      return result;
    }
  };
  const now = new Date('2026-10-06T02:00:00Z');
  assert.equal(await isActiveSession(db, 'u1', 'session-aaa1', now), false);
  await consumeRoutePlan(db, 'u1', { productPlanKey: 'basic' }, 'session-aaa1', now);
  assert.equal(await isActiveSession(db, 'u1', 'session-aaa1', now), true);
  assert.equal(await isActiveSession(db, 'u2', 'session-aaa1', now), false, 'per user');
  await refundRoutePlan(db, 'u1', { productPlanKey: 'basic' }, 'session-aaa1', now);
  assert.equal(await isActiveSession(db, 'u1', 'session-aaa1', now), false);
});

test('plan-routes requires login, an active session and configuration, and times out', () => {
  const source = readFileSync(new URL('../netlify/functions/plan-routes.js', import.meta.url), 'utf8');
  const order = ['verifyFirebaseUser(req)', 'const config = plannerConfig()', 'isActiveSession(db, user.uid, sessionId)', 'sanitizePlannerProblem(body.problem)', "callPlanner(config, '/solve'"].map((s) => source.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), String(order));
  assert.match(source, /code: 'planner-unavailable'/);
  assert.match(source, /const SOLVE_TIMEOUT_MS = 15000;/);
});
