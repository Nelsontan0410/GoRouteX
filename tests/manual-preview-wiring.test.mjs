import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../planning/manual-map-preview.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../lorry-safety.css', import.meta.url), 'utf8');

test('manual and final routes do not mount a separate restriction review panel', () => {
  assert.doesNotMatch(app, /id="manualRestrictionStatus"/);
  assert.match(app, /id="messageBar"[\s\S]*id="mobileLayout"/);
  const safety = readFileSync(new URL('../route-safety.js', import.meta.url), 'utf8');
  assert.doesNotMatch(safety, /data-lorry-results/);
});

test('manual route calculation validates before drawing and binds pins to the manual context', () => {
  const start = preview.indexOf('async function calculateManualRouteLines');
  const end = preview.indexOf('function updateRouteLines', start);
  const source = preview.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(source, /RouteEngine\.buildRouteRequest/);
  assert.match(source, /RouteSafety\.validateRoutes\(manualPreviewRoutes, \{ context: 'manual'/);
  assert.match(source, /RouteSafety\.showConflicts\(mapPage2, manualPreviewRoutes, \{ context: 'manual' \}\)/);
  assert.ok(source.indexOf('RouteSafety.validateRoutes') < source.indexOf('drawManualPreviewRoutes'));
});

test('confirm waits for the current manual check before building and saving final routes', () => {
  const finalization = readFileSync(new URL('../planning/route-finalization.js', import.meta.url), 'utf8');
  const start = finalization.indexOf('async function handleProceedToOptimizeRoutes');
  const end = finalization.indexOf('function openDispatchPage', start);
  const source = finalization.slice(start, end);
  assert.ok(source.indexOf('await ensureManualRouteCheckCurrent()') < source.indexOf('await prepareRoutePlanningUi(options)'));
  assert.ok(source.indexOf('await prepareRoutePlanningUi(options)') < source.indexOf('RouteEngine.buildPlannedRoutes()'));
  assert.match(source, /context: 'final', forceRefresh: false, reuse: true/);
});

test('route and restriction edits use a 400 ms debounce and immediately clear manual pins', () => {
  const start = preview.indexOf('function updateRouteLines(options = {})');
  const end = preview.indexOf('async function ensureManualRouteCheckCurrent', start);
  const source = preview.slice(start, end);
  assert.match(source, /RouteSafety\.invalidate\('manual'/);
  assert.match(source, /RouteSafety\.showConflicts\(mapPage2, \[\], \{ context: 'manual' \}\)/);
  assert.match(source, /setTimeout\(start, 400\)/);
});

test('manual restriction layout keeps native checkboxes aligned and has mobile rules', () => {
  assert.match(css, /\.lorry-toggle-row,.lorry-safety-panel \.lorry-code-option\{display:grid;grid-template-columns:18px minmax\(0,1fr\)/);
  assert.match(css, /input\[type=checkbox\][^{]*\{display:block;position:static;appearance:auto;width:16px/);
  assert.match(css, /@media \(max-width:768px\)\{\.manual-lorry-status/);
});

test('manual detours are attached to a route leg, trigger a fresh check, and can be cleared', () => {
  const start = app.indexOf('function addManualDetourAt');
  const end = app.indexOf('function bindManualDetourMap', start);
  const source = app.slice(start, end);
  assert.match(source, /legIndex: manualDetourTarget\.legIndex/);
  assert.match(source, /source: 'MANUAL_MAP'/);
  assert.match(source, /refreshManualDetourRoute\(\)/);
  assert.match(app, /restriction-manual-via-request/);
  assert.match(preview, /manualWaypoints: route\.manualWaypoints \|\| \[\]/);
  assert.match(app, /Clear manual detours/);
  assert.match(preview, /Undo detour edit/);
  assert.match(preview, /Previous manual detours were cleared|Previous manual detours were cleared/i);
});

test('manual detours persist by route key and are presented as navigation-only coordinate stops', () => {
  assert.match(app, /MANUAL_DETOUR_SESSION_KEY/);
  assert.match(app, /rememberRouteManualDetours\(route\)/);
  assert.match(app, /restoreRouteManualDetours\(route\)/);
  assert.match(app, /Navigation points \(not delivery stops\):/);
  assert.match(app, /formatManualNavigationStop\(point\)/);
});

test('maps draw a different color for each delivery leg', () => {
  assert.match(app, /ROUTE_LEG_COLORS/);
  assert.match(app, /MapHandler\.renderRouteLegs/);
  assert.match(app, /route-leg-color-legend/);
  assert.match(css, /\.route-leg-color-legend/);
});
