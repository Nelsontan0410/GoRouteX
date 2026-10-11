import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(read('planning/plan-edits.js'), ctx);
const compare = (a, b) => JSON.parse(JSON.stringify(ctx.GoRouteXPlanEdits.comparePlans(a, b)));

test('an automatic plan saved unchanged counts as unchanged', () => {
  assert.deepEqual(compare([['a', 'b'], ['c']], [['a', 'b'], ['c']]), { moved: 0, removed: 0, added: 0, reordered: 0, unchanged: true });
});

test('moves between routes, reorders, removals and additions are counted', () => {
  assert.deepEqual(compare([['a', 'b', 'c'], ['d']], [['b', 'a'], ['d', 'c', 'e']]), { moved: 1, removed: 0, added: 1, reordered: 1, unchanged: false });
  assert.deepEqual(compare([['a', 'b']], [['a']]), { moved: 0, removed: 1, added: 0, reordered: 0, unchanged: false });
});

test('the saved plan carries the automatic plan and the edit counts', () => {
  const entry = read('planning/manual-assignment-page.js');
  assert.match(entry, /window\._autoPlanRecord = \{\s*source: window\._plannerUsedEngine \? 'plan-engine' : \(Status\.current\(\)\?\.optimizer \|\| 'google'\),/);
  assert.match(entry, /window\._autoPlanRecord = \{ source: 'manual'/);
  const persistence = read('planning/planning-persistence.js');
  assert.match(persistence, /planEngine: buildPlanEngineRecord\(driverPlannedRoutes\),/);
  assert.match(persistence, /return \{ source: record\.source, plannedAt: record\.at, automaticRoutes, unassignedByPlanner: record\.unassigned, edits \};/);
});

test('the saved plan never holds a list inside a list (Firestore refuses it)', () => {
  const src = readFileSync(new URL('../planning/planning-persistence.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(src.indexOf('function buildPlanEngineRecord('), src.indexOf('// Selection saves are serialized')) + '\nthis.build = buildPlanEngineRecord; this.find = findNestedArrayPath;', ctx);
  ctx.window = ctx;
  ctx._autoPlanRecord = { source: 'plan-engine', at: 'now', routes: [['a', 'b'], ['c']], unassigned: ['d'] };
  const record = ctx.build([{ customerStops: [{ id: 'a' }, { id: 'b' }] }, { customerStops: [{ id: 'c' }] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(record.automaticRoutes)), [{ route: 1, stopIds: ['a', 'b'] }, { route: 2, stopIds: ['c'] }]);
  assert.equal(ctx.find({ planEngine: record, plannedRoutes: [{ stops: [{ id: 1 }] }] }), '');
  assert.equal(ctx.find({ planEngine: { automaticRoutes: [['a']] } }), 'plan.planEngine.automaticRoutes[0]');
});
