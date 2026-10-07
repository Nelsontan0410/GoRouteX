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
  assert.match(entry, /window\._autoPlanRecord = \{\s*source: window\._plannerUsedEngine \? 'plan-engine' : 'google',/);
  assert.match(entry, /window\._autoPlanRecord = \{ source: 'manual'/);
  const persistence = read('planning/planning-persistence.js');
  assert.match(persistence, /planEngine: buildPlanEngineRecord\(driverPlannedRoutes\),/);
  assert.match(persistence, /return \{ source: record\.source, plannedAt: record\.at, automaticRoutes: record\.routes, unassignedByPlanner: record\.unassigned, edits \};/);
});
