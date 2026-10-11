import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRoute, improveSolution, solveWithRetries } from '../services/planner/improve.mjs';

// Locations: 0 depot, 1..3 customers. Symmetric 10-minute legs except where noted.
const M = (n, fill = 600) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : fill)));
const vehicle = (id, extra = {}) => ({ id, start_index: 0, end_index: 0, time_window: [32400, 64800], max_tasks: 8, costs: { fixed: 3600 }, ...extra });
const job = (id, index, windows, service = 600) => ({ id, location_index: index, service, time_windows: windows });
const ctxOf = (jobs, durations) => ({ durations, jobs: new Map(jobs.map((j) => [j.id, j])) });

test('simulation waits for opening, enforces windows and the shift end', () => {
  const jobs = [job(1, 1, [[36000, 40000]])]; // opens 10:00
  const sim = simulateRoute(vehicle(1), [1], ctxOf(jobs, M(2)));
  const step = sim.steps.find((s) => s.type === 'job');
  assert.equal(step.arrival, 33000);
  assert.equal(step.waiting_time, 3000);
  assert.equal(sim.duration, 36000 + 600 + 600 - 32400);
  assert.equal(simulateRoute(vehicle(1), [1], ctxOf([job(1, 1, [[32400, 32500]])], M(2))), null, 'arrives after the last start time');
  assert.equal(simulateRoute(vehicle(1, { time_window: [32400, 33500] }), [1], ctxOf([job(1, 1, [[32400, 40000]])], M(2))), null, 'cannot return before the shift ends');
});

test('the driver break is taken during a long wait instead of adding time', () => {
  const brk = { id: 1, time_windows: [[41400, 52200]], service: 3600 }; // 11:30-14:30, 1 h
  const jobs = [job(1, 1, [[46800, 60000]])]; // opens 13:00
  const sim = simulateRoute(vehicle(1, { time_window: [41400, 64800], breaks: [brk] }), [1], ctxOf(jobs, M(2)));
  const kinds = sim.steps.map((s) => s.type);
  assert.deepEqual(kinds, ['start', 'break', 'job', 'end']);
  assert.equal(sim.duration, 46800 + 600 + 600 - 41400, 'no extra hour for the break');
});

test('improvement reorders to cut waiting and moves a stop to another route; never makes it worse', () => {
  // VROOM-like baseline: vehicle 1 serves an afternoon-only stop (2) early in the morning order and waits.
  const jobs = [job(1, 1, [[32400, 60000]]), job(2, 2, [[50400, 60000]]), job(3, 3, [[32400, 60000]])];
  const problem = { jobs, vehicles: [vehicle(1), vehicle(2)], matrices: { car: { durations: M(4) } } };
  const solution = { code: 0, summary: {}, unassigned: [], routes: [{ vehicle: 1, steps: [{ type: 'start' }, { type: 'job', id: 2 }, { type: 'job', id: 1 }, { type: 'job', id: 3 }, { type: 'end' }] }] };
  const improved = improveSolution(problem, solution);
  assert.equal(improved.improvedBy, 'goroutex');
  const waiting = improved.routes.reduce((sum, r) => sum + r.waiting_time, 0);
  assert.ok(waiting < 50400 - 33000, `waiting reduced (${waiting}s)`);
  for (const route of improved.routes) {
    for (const step of route.steps.filter((s) => s.type === 'job')) {
      const start = step.arrival + step.waiting_time;
      assert.ok(jobs.find((j) => j.id === step.id).time_windows.some(([a, b]) => start >= a && start <= b));
    }
  }
  const served = improved.routes.flatMap((r) => r.steps.filter((s) => s.type === 'job').map((s) => s.id)).sort();
  assert.deepEqual(served, [1, 2, 3], 'no stop lost or duplicated');
});

test('an infeasible or failed baseline is returned unchanged', () => {
  const problem = { jobs: [job(1, 1, [[32400, 32500]])], vehicles: [vehicle(1)], matrices: { car: { durations: M(2) } } };
  const solution = { code: 0, routes: [{ vehicle: 1, steps: [{ type: 'job', id: 1 }] }] };
  assert.equal(improveSolution(problem, solution), solution);
  const failed = { code: 2, error: 'x' };
  assert.equal(improveSolution(problem, failed), failed);
});

test('a given assignment is scored with violations counted instead of rejected', async () => {
  const { evaluateAssignment, evaluateSolution } = await import('../services/planner/improve.mjs');
  const jobs = [job(1, 1, [[32400, 33000]]), job(2, 2, [[50400, 60000]])];
  const problem = { jobs, vehicles: [vehicle(1)], matrices: { car: { durations: M(3) } } };
  const late = evaluateAssignment(problem, [[2, 1]]); // job 1 reached far too late
  assert.equal(late.violations, 1);
  assert.equal(late.stops, 2);
  assert.ok(late.waiting > 0);
  const good = evaluateAssignment(problem, [[1, 2]]);
  assert.equal(good.violations, 0);
  const sol = evaluateSolution(problem, { routes: [{ vehicle: 1, steps: [{ type: 'job', id: 1 }, { type: 'job', id: 2 }] }], unassigned: [{ id: 9 }] });
  assert.equal(sol.violations, 0);
  assert.equal(sol.unassigned, 1);
});

test('the second pass never overloads a vehicle', () => {
  const jobs = [{ ...job(1, 1, [[32400, 60000]]), delivery: [60] }, { ...job(2, 2, [[32400, 60000]]), delivery: [60] }];
  const v = { ...vehicle(1), capacity: [100] };
  assert.equal(simulateRoute(v, [1, 2], ctxOf(jobs, M(3))), null);
  assert.ok(simulateRoute(v, [1], ctxOf(jobs, M(3))));
});

test('a stop VROOM left out is inserted when it fits somewhere in the day', () => {
  const jobs = [job(1, 1, [[32400, 60000]]), job(2, 2, [[32400, 60000]])];
  const problem = { jobs, vehicles: [vehicle(1, { max_tasks: 30, costs: { fixed: 0 } })], matrices: { car: { durations: M(3) } } };
  const solution = { code: 0, summary: { cost: 1200 }, unassigned: [{ id: 2 }],
    routes: [{ vehicle: 1, steps: [{ type: 'start', arrival: 32400 }, { type: 'job', id: 1, arrival: 33000, waiting_time: 0, service: 600 }, { type: 'end', arrival: 34200 }] }] };
  const out = improveSolution(problem, solution);
  assert.deepEqual(out.unassigned, []);
  assert.deepEqual(out.routes[0].steps.filter((s) => s.type === 'job').map((s) => s.id).sort(), [1, 2]);
  const full = { ...problem, vehicles: [vehicle(1, { max_tasks: 30, costs: { fixed: 0 }, time_window: [32400, 34300] })] };
  assert.deepEqual(improveSolution(full, solution).unassigned, [{ id: 2 }], 'no room: stays unassigned');
});

test('when stops are left out, solving again with them at top priority is kept only if it serves more', async () => {
  const runs = [];
  const left = { code: 0, summary: { cost: 100 }, unassigned: [{ id: 13 }], routes: [] };
  const all = { code: 0, summary: { cost: 150 }, unassigned: [], routes: [] };
  const run = async (input, seconds) => { runs.push({ priority: input.jobs.find((j) => j.id === 13)?.priority, seconds }); return runs.length === 1 ? left : all; };
  const input = { jobs: [{ id: 1 }, { id: 13 }] };
  const out = await solveWithRetries(input, run, { improve: (_, s) => s, retrySeconds: 2 });
  assert.deepEqual(out.unassigned, []);
  assert.equal(out.retriedForUnassigned, 1);
  assert.deepEqual(runs, [{ priority: undefined, seconds: undefined }, { priority: 100, seconds: 2 }]);
  const worse = await solveWithRetries(input, async () => left, { improve: (_, s) => s });
  assert.equal(worse.retriedForUnassigned, undefined, 'no gain: the first answer is kept');
  let calls = 0;
  await solveWithRetries(input, async () => { calls++; return all; }, { improve: (_, s) => s });
  assert.equal(calls, 1, 'nothing left out: no retry');
});
