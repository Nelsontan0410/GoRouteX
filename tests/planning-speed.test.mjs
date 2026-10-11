import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('Review & Assign shows the planning screen at once and always removes it', () => {
  const page = read('planning/manual-assignment-page.js');
  const entry = page.slice(page.indexOf('async function handleGoToManualAssignPageLegacy('), page.indexOf('function populateManualAssignmentListsLegacy('));
  assert.ok(entry.indexOf('showPlanningOverlay(selectedCustomers.size);') < entry.indexOf('await startAutoPlanSession()'), 'shown before any network call');
  assert.match(entry, /\} finally \{\s*hidePlanningOverlay\(\);/);
  assert.match(entry, /console\.info\('\[Review & Assign timing, ms\]', timing\.steps\);/);
  assert.match(read('app-core.css'), /\.planning-overlay\[hidden\] \{ display: none; \}/);
});

test('Dispatch opens with the plan handed over from Confirm and loads drivers in parallel', () => {
  const persistence = read('planning/planning-persistence.js');
  assert.match(persistence, /sessionStorage\.setItem\(`grxDispatchHandoff:\$\{handoffUid\}`, handoff\)/);
  const page = read('dispatch/dispatch-page.js');
  assert.match(page, /const handed = handedOverPlan\(planId\);\s*if \(handed\) \{/);
  assert.match(page, /String\(handoff\.id\) === String\(planId\)/, 'only the plan that was just saved');
  assert.ok(page.indexOf('global.GoRouteXDispatch?.prefetchDrivers?.();') < page.indexOf('identity = await global.GoRouteXAccountContext.loadIdentity(user);'), 'drivers start before the account read');
  const board = read('dispatch/dispatch-board.js');
  assert.match(board, /if \(state\.driverPrefetch && !forceDrivers\) await state\.driverPrefetch;/);
});
