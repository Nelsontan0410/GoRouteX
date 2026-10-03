import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
function body(name, next) {
  return app.slice(app.indexOf(`    function ${name}`), app.indexOf(`    function ${next}`, app.indexOf(`    function ${name}`)));
}
test('toolbar selection arms the requested leg and a map click inserts a detour and recalculates', () => {
  const route = { id: 'route1', manualWaypoints: [] };
  let recalculations = 0;
  const context = {
    manualDetourTarget: null, manualPreviewRoutes: [route], MAX_MANUAL_DETOURS_PER_ROUTE: 12,
    document: { getElementById: () => ({ value: '["route1",1]' }) },
    getManualRouteById: id => id === route.id ? route : null,
    getLatLngLiteral: position => position,
    renderManualRestrictionStatus() {}, rememberManualDetourState() {}, rememberRouteManualDetours() {},
    refreshManualDetourRoute() { recalculations++; },
  };
  vm.createContext(context);
  vm.runInContext(body('armManualDetour', 'addManualDetourAt') + body('addManualDetourAt', 'bindManualDetourMap') + body('startMapDetour', 'renderManualDetourToolbar'), context);
  context.startMapDetour();
  context.addManualDetourAt({ lat: 1.314, lng: 103.754 });
  assert.equal(route.manualWaypoints.length, 1);
  assert.equal(route.manualWaypoints[0].legIndex, 1);
  assert.equal(route.manualWaypoints[0].lat, 1.314);
  assert.equal(recalculations, 1);
});

test('manual detour drafts are scoped to the signed-in account and complete route identity', () => {
  assert.match(app, /version: 2,/);
  assert.match(app, /accountId,/);
  assert.match(app, /origin:/);
  assert.match(app, /configuredEnd:/);
  assert.match(app, /stops: stopLocations/);
  assert.match(app, /manualRouteInFlightKey \? 'Recalculating route…'/);
});
