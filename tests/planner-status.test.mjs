import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
function load() {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(read('planning/planner-status.js'), ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('a new plan clears the previous flags, reasons and notice', () => {
  const ctx = load();
  const S = ctx.GoRouteXPlannerStatus;
  const first = S.begin();
  S.finish(first, { optimizer: 'plan-engine', roadRouting: 'google', unassigned: [{ id: 's9', message: 'Closed on Sunday.' }] });
  ctx._timeWindowPlanningNotice = 'old notice';
  assert.equal(ctx._plannerUsedEngine, true);
  assert.deepEqual(plain(ctx._plannerUnassignedIds), ['s9']);
  S.begin();
  assert.equal(ctx._plannerUsedEngine, false);
  assert.deepEqual(plain(ctx._plannerUnassignedIds), []);
  assert.equal(ctx._timeWindowPlanningNotice, '');
  assert.equal(S.reasonFor('s9'), '');
});

test('a result from an older plan is ignored', () => {
  const ctx = load();
  const S = ctx.GoRouteXPlannerStatus;
  const older = S.begin();
  const newer = S.begin();
  assert.equal(S.finish(older, { optimizer: 'plan-engine', unassigned: [{ id: 'a', message: 'x' }] }), false);
  assert.equal(S.current().state, 'running');
  assert.equal(ctx._plannerUsedEngine, false);
  assert.equal(S.fail(older, 'boom'), false);
  assert.equal(S.finish(newer, { optimizer: 'google', reason: 'disabled' }), true);
  assert.equal(S.current().optimizer, 'google');
});

test('unassigned reasons are kept by stop ID (numbers and strings alike)', () => {
  const S = load().GoRouteXPlannerStatus;
  const id = S.begin();
  S.finish(id, { optimizer: 'plan-engine', unassigned: [{ id: 42, message: 'Closed on Sunday.' }, { id: 'tuas', reason: 'service-too-long' }, { id: '' }] });
  assert.equal(S.reasonFor('42'), 'Closed on Sunday.');
  assert.equal(S.reasonFor(42), 'Closed on Sunday.');
  assert.equal(S.reasonFor('tuas'), 'service-too-long');
  assert.equal(S.current().unassigned.size, 2);
});

test('the status line names the planner that was actually used, and why the Plan Engine was not', () => {
  const S = load().GoRouteXPlannerStatus;
  let id = S.begin();
  assert.equal(S.line({ testSwitchOn: true }), '', 'nothing while running');
  S.finish(id, { optimizer: 'plan-engine', roadRouting: 'osrm' });
  assert.equal(S.line({ testSwitchOn: true }), 'Planner: Plan Engine · roads: OSRM.');
  assert.equal(S.line({ testSwitchOn: false }), '', 'hidden for users when nothing went wrong');
  id = S.begin();
  S.finish(id, { optimizer: 'google', roadRouting: 'google', reason: 'The start location has no verified coordinates.' });
  assert.equal(S.line(), 'Planner: Google · roads: Google (Plan Engine not used: The start location has no verified coordinates.).');
  id = S.begin();
  S.finish(id, { optimizer: 'google', roadRouting: 'google', reason: 'disabled' });
  assert.equal(S.line(), '', 'switched off is not a problem worth showing');
  assert.equal(S.line({ testSwitchOn: true }), 'Planner: Google · roads: Google.');
  id = S.begin();
  S.finish(id, { optimizer: 'none', reason: 'No selected stop can be served on this date' });
  assert.equal(S.line(), 'Planner: no route was planned (No selected stop can be served on this date).');
  assert.doesNotMatch(S.line(), /Plan Engine/, 'never implies the cloud service solved it');
  id = S.begin();
  S.fail(id, 'Direction order failed');
  assert.equal(S.line(), 'Planner: failed (Direction order failed).');
});

test('route generation records the status and drops results of a replaced plan', () => {
  const app = read('app.html');
  const gen = app.slice(app.indexOf('async function generateOptimizedActiveRoutesFromSelection('), app.indexOf('return window._activeRoutes;\n    }\n', app.indexOf("Status.finish(planId, { optimizer: 'google'")));
  assert.match(gen, /const planId = options\.planId \|\| Status\.begin\(\);/);
  const engineCall = gen.indexOf('await planWithPlanEngine(');
  assert.ok(gen.indexOf('assertCurrentPlan(planId);', engineCall) > engineCall, 'checked after the engine answers');
  const googleCall = gen.indexOf('await MapHandler.route(directionsService');
  assert.ok(gen.indexOf('assertCurrentPlan(planId);', googleCall) > googleCall, 'checked after Google answers');
  assert.match(gen, /optimizer: solved \? 'plan-engine' : 'none'/);
  assert.match(gen, /optimizer: 'direction-return'/);
  assert.match(read('planning/plan-engine-client.js'), /return \{ routes: \[\], unassigned: built\.preUnassigned, solved: false \};/);
  const order = ['planning/plan-engine-client.js', 'planning/planner-status.js', 'planning/manual-assignment-page.js'].map((f) => app.search(new RegExp(`<script src="${f.replace(/[./]/g, '\\$&')}`)));
  assert.ok(order[0] > 0 && order[1] > order[0] && order[2] > order[1]);
});

test('Review & Assign: one plan id per entry; a replaced entry refunds and stops; fallbacks are labelled', () => {
  const page = read('planning/manual-assignment-page.js');
  const entry = page.slice(page.indexOf('async function handleGoToManualAssignPageLegacy('), page.indexOf('function populateManualAssignmentListsLegacy('));
  assert.ok(entry.indexOf('const planId = Status.begin();') < entry.indexOf('await startAutoPlanSession()'));
  assert.match(entry, /if \(!Status\.isCurrent\(planId\)\) \{ await refundAutoPlanSession\(autoPlan\.sessionId\); return; \}/);
  assert.match(entry, /generateOptimizedActiveRoutesFromSelection\(selectedStops, MAX_WAYPOINTS_PER_ROUTE, \{ planId \}\)/);
  assert.match(entry, /if \(error\?\.name === 'StalePlanError' \|\| !Status\.isCurrent\(planId\)\) return;/);
  assert.match(entry, /optimizer: 'local-clustering'/);
  assert.match(entry, /optimizer: 'manual'/);
  const renderer = page.slice(page.indexOf('function renderDraggableListLegacy('), page.indexOf('function renderRouteSlotsLegacy('));
  assert.doesNotMatch(renderer, /unassigned-reason|unassignedReason/, 'the explanation lines under unassigned stops are gone');
  assert.match(renderer, /'<em>All stops assigned!<\/em>'/);
  assert.ok(renderer.indexOf("if (itemsArray.length === 0)") < renderer.indexOf('All stops assigned!'), 'shown only when nothing is unassigned');
});
