import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const coreSource = readFileSync(new URL('../lorry-restrictions.js', import.meta.url), 'utf8');
const routingSource = readFileSync(new URL('../restriction-routing.js', import.meta.url), 'utf8');
const safetySource = readFileSync(new URL('../route-safety.js', import.meta.url), 'utf8');
function setup() {
  const events = new Map();
  const values = new Map();
  const settings = { enabled: true, selectedCodes: ['4002'] };
  values.set('goroutex.lorry.settings.device', JSON.stringify(settings));
  const route = { id: 1, optimizedStops: ['A', 'B'], directionsResult: { routes: [{ legs: [{ start_location: { lat: 1.3, lng: 103.8 }, end_location: { lat: 1.301, lng: 103.8 }, steps: [{ path: [{ lat: 1.3, lng: 103.8 }, { lat: 1.301, lng: 103.8 }] }] }] }] } };
  const context = { console, setTimeout, clearTimeout, AbortSignal, Date, URL, Event,
    addEventListener: (name, listener) => events.set(name, listener), dispatchEvent: (event) => events.get(event.type)?.(event),
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    document: { readyState: 'complete', querySelector: () => null, querySelectorAll: () => [] }, AppState: { plannedRoutes: [route] },
    fetch: async () => ({ ok: true, json: async () => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), sourceSha256: 'fixture', signs: [
      { id: 'far', signCode: '4002', signName: 'Lorry', restrictionCategory: 'LORRY', role: 'RESTRICTION', latitude: 1.4, longitude: 103.9 }
    ] }) }) };
  context.window = context; vm.createContext(context); vm.runInContext(coreSource, context); vm.runInContext(routingSource, context); vm.runInContext(safetySource, context);
  return { context, route, values, settings, safety: context.RouteSafety };
}
test('a usable Google route remains navigable when restriction data changes', async () => {
  const { safety, route } = setup();
  assert.equal(safety.permitted(route), true);
  await safety.validateRoutes(); assert.equal(safety.permitted(route), true);
  assert.equal(safety.permitted(JSON.parse(JSON.stringify(route))), true);
  route.optimizedStops.push('C'); assert.equal(safety.permitted(route), true);
});
test('code selection edit invalidates pins without blocking navigation', async () => {
  const { safety, route, values, settings } = setup(); await safety.validateRoutes();
  settings.selectedCodes = ['1011']; values.set('goroutex.lorry.settings.device', JSON.stringify(settings));
  assert.equal(safety.permitted(route), true);
});
test('route input edits do not block an otherwise usable navigation handoff', async () => {
  const { safety, route, context } = setup();
  let address = 'Original address'; context.getAddressForMapsUrl = () => address;
  await safety.validateRoutes(); assert.equal(safety.permitted(route), true);
  address = 'Edited address'; assert.equal(safety.permitted(route), true);
});
test('network failure records a warning but does not block navigation', async () => {
  const { safety, route, context, values } = setup(); await safety.validateRoutes();
  context.fetch = async () => { throw new Error('Offline'); }; await safety.validateRoutes();
  assert.equal(safety.permitted(route), true); assert.equal(route.lorryValidation.status, 'WARNING');
  assert.equal(JSON.parse(values.get('goroutex.lorry.audit.device')).at(-1).event, 'validation-error');
});
test('conflicts trigger a reminder without blocking navigation or sharing', async () => {
  const { safety, route, context } = await conflictFixture();
  let reminder;
  context.addEventListener('restriction-navigation-reminder', (event) => { reminder = event.detail; });
  assert.equal(safety.gate(route), true);
  assert.equal(reminder.routeId, 1);
  assert.equal(reminder.conflicts, 2);
  assert.equal(reminder.hasManualDetour, false);
});
test('clearing all selected codes retains original navigation behavior and logs unvalidated plans', async () => {
  const { safety, route, values, settings } = setup(); settings.enabled = false; settings.selectedCodes = [];
  values.set('goroutex.lorry.settings.device', JSON.stringify(settings)); await safety.validateRoutes();
  assert.equal(safety.permitted(route), true);
  assert.equal(JSON.parse(values.get('goroutex.lorry.audit.device')).at(-1).finalStatus, 'NOT_CHECKED');
});
test('a usable but unchecked route remains pending instead of being labelled safe', () => {
  const { safety, route } = setup();
  assert.equal(safety.permitted(route), true);
  assert.equal(safety.summary([route]).state, 'PENDING');
  route.lorryValidation = { status: 'SAFE', safe: true, conflicts: [], issues: [] };
  assert.equal(safety.summary([route]).state, 'SAFE');
});
function mapFixture(context) {
  const markers = [];
  context.google = { maps: { SymbolPath: { CIRCLE: 0 }, Marker: class {
    constructor(options) { Object.assign(this, options); markers.push(this); }
    addListener() {} setMap(map) { this.map = map; }
  } } };
  const listeners = {};
  const map = { getBounds: () => ({ contains: () => true }), addListener: (name, fn) => { listeners[name] = fn; } };
  return { map, listeners, active: () => markers.filter((m) => m.map === map) };
}
async function conflictFixture() {
  const fixture = setup(), { context, safety } = fixture;
  context.fetch = async () => ({ ok: true, json: async () => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), sourceSha256: 'pins', signs: [
    { id: 'hit', signCode: '4002', signName: 'Chosen', latitude: 1.3005, longitude: 103.8, bearing: 0, bearingConvention: 'TRAVEL_DIRECTION' },
    { id: 'review', signCode: '4002', signName: 'Nearby', latitude: 1.3005, longitude: 103.8002 },
    { id: 'far', signCode: '4002', signName: 'Far', latitude: 1.4, longitude: 103.9 },
    { id: 'unselected', signCode: '1011', signName: 'Other', latitude: 1.3005, longitude: 103.8 }
  ] }) });
  const maps = mapFixture(context); safety.registerMap(maps.map);
  await safety.validateRoutes();
  return { ...fixture, ...maps };
}
test('selected code with no route never pins signs, including after map idle', async () => {
  const { safety, context } = setup(), { map, listeners, active } = mapFixture(context);
  context.AppState.plannedRoutes = [];
  await safety.validateRoutes(); safety.showConflicts(map, []);
  assert.equal(active().length, 0); listeners.idle(); assert.equal(active().length, 0);
});
test('selected-code points within 20 m appear and duplicate route hits share one pin', async () => {
  const { safety, context, route, map, listeners, active } = await conflictFixture();
  assert.equal(route.lorryValidation.conflicts.length, 2);
  assert.equal(active().length, 1); assert.ok(active().every((m) => m.label.text === '4002'));
  const second = JSON.parse(JSON.stringify(route)); second.id = 2;
  context.AppState.plannedRoutes.push(second); await safety.validateRoutes();
  safety.showConflicts(map, context.AppState.plannedRoutes); listeners.idle();
  assert.equal(active().length, 1);
});
test('reverse direction still shows points within 20 m in manual and final maps', async () => {
  const { safety, context, route, map, listeners, active } = await conflictFixture();
  // Reverse travel: same location, but no matching sign direction. Both
  // candidates stay available for diagnostics and neither may be pinned.
  const leg = route.directionsResult.routes[0].legs[0];
  leg.steps[0].path.reverse();
  [leg.start_location, leg.end_location] = [leg.end_location, leg.start_location];
  await safety.validateRoutes();
  assert.equal(route.lorryValidation.conflicts.length, 2);
  assert.ok(route.lorryValidation.conflicts.every(c => c.confidence === 'MEDIUM'));
  safety.showConflicts(map, [route]);
  listeners.idle();
  assert.equal(active().length, 1);
  await safety.validateRoutes([route], { context: 'manual', forceRefresh: false });
  safety.showConflicts(map, [route], { context: 'manual' });
  listeners.idle();
  assert.equal(active().length, 1);
  assert.equal(safety.permitted(route), true);
});
test('selection changes, edited routes, and removed routes cannot repaint stale pins', async () => {
  const { safety, context, route, values, settings, map, listeners, active } = await conflictFixture();
  assert.equal(active().length, 1);
  settings.selectedCodes = ['1011']; values.set('goroutex.lorry.settings.device', JSON.stringify(settings));
  safety.render(); assert.equal(active().length, 0);
  settings.selectedCodes = ['4002']; values.set('goroutex.lorry.settings.device', JSON.stringify(settings));
  await safety.validateRoutes(); assert.equal(active().length, 1);
  route.optimizedStops.push('Changed'); safety.render(); assert.equal(active().length, 0);
  route.optimizedStops.pop(); await safety.validateRoutes();
  safety.showConflicts(map, context.AppState.plannedRoutes);
  context.AppState.plannedRoutes = []; safety.render(); listeners.idle(); assert.equal(active().length, 0);
});
test('starting a recheck clears old pins before the pending network request finishes', async () => {
  const { safety, context, active } = await conflictFixture();
  assert.equal(active().length, 1);
  let release; context.fetch = () => new Promise((resolve) => { release = resolve; });
  const pending = safety.validateRoutes(); assert.equal(active().length, 0);
  release({ ok: false }); await pending; assert.equal(active().length, 0);
});
test('real AppState replacement immediately clears pins without waiting for map idle or render', async () => {
  const { context, active } = await conflictFixture();
  assert.equal(active().length, 1);
  vm.runInContext(readFileSync(new URL('../state.js', import.meta.url), 'utf8'), context);
  context.AppState.plannedRoutes = [];
  assert.equal(active().length, 0);
});
test('a conflict remains visible and does not trigger an automatic Google reroute', async () => {
  const { safety, context, active } = await conflictFixture();
  assert.equal(active().length, 1);
  const a = { lat: 1.3, lng: 103.8 }, b = { lat: 1.301, lng: 103.8 };
  const path = [a, { lat: 1.3, lng: 103.802 }, { lat: 1.301, lng: 103.802 }, b];
  let requests = 0;
  context.MapHandler = { initDirectionsService: () => ({}), route: async () => { requests++; return ({ routes: [{ legs: [{ start_location: a, end_location: b, steps: [{ path }] }] }] }); } };
  await safety.validateRoutes();
  assert.equal(requests, 0);
  assert.equal(active().length, 1);
  assert.equal(context.AppState.plannedRoutes[0].lorryValidation.status, 'BLOCKED');
});

test('manual map binds preview routes independently from final AppState routes', async () => {
  const { context, safety, route } = setup();
  context.fetch = async () => ({ ok: true, json: async () => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), sourceSha256: 'manual-pins', signs: [
    { id: 'manual-hit', signCode: '4002', signName: 'Manual preview sign', latitude: 1.3005, longitude: 103.8, bearing: 0, bearingConvention: 'TRAVEL_DIRECTION' }
  ] }) });
  const previewRoute = JSON.parse(JSON.stringify(route));
  previewRoute.id = 'manual-1';
  context.AppState.plannedRoutes = [];
  const { map, active } = mapFixture(context);
  await safety.validateRoutes([previewRoute], { context: 'manual', forceRefresh: false });
  safety.showConflicts(map, [previewRoute], { context: 'manual' });
  assert.equal(active().length, 1);
});

test('manual and final route checks use separate contexts', async () => {
  const { context, safety, route } = setup();
  const manualRoute = JSON.parse(JSON.stringify(route)); manualRoute.id = 'manual';
  const finalRoute = JSON.parse(JSON.stringify(route)); finalRoute.id = 'final';
  await safety.validateRoutes([manualRoute], { context: 'manual', forceRefresh: false });
  await safety.validateRoutes([finalRoute], { context: 'final', forceRefresh: false });
  assert.equal(manualRoute.lorryValidation.status, 'SAFE');
  assert.equal(finalRoute.lorryValidation.status, 'SAFE');
});

test('same-context concurrent checks with the same input are coalesced', async () => {
  const { context, safety, route } = setup();
  let release;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  context.fetch = () => new Promise((resolve) => { release = resolve; started(); });
  const first = safety.validateRoutes([route], { context: 'manual', forceRefresh: false });
  await ready;
  const second = safety.validateRoutes([route], { context: 'manual', forceRefresh: false });
  assert.equal(first, second);
  release({ ok: true, json: async () => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), sourceSha256: 'coalesced', signs: [
    { id: 'far', signCode: '4002', signName: 'Lorry', latitude: 1.4, longitude: 103.9 }
  ] }) });
  await Promise.all([first, second]);
  assert.equal(route.lorryValidation.status, 'SAFE');
});

test('a current manual result is reused by the final route object', async () => {
  const { safety, route } = setup();
  await safety.validateRoutes([route], { context: 'manual', forceRefresh: false });
  const finalRoute = JSON.parse(JSON.stringify(route));
  await safety.validateRoutes([finalRoute], { context: 'final', forceRefresh: false, reuse: true });
  assert.equal(safety.permitted(finalRoute), true);
  assert.equal(finalRoute.lorryValidation.status, 'SAFE');
});

test('fresh conflict checks on aged data retain pins while freshness remains invalid', async () => {
  const { context, safety, route, map, active } = await conflictFixture();
  const fetchFresh = context.fetch;
  context.fetch = async () => ({ ok: true, json: async () => ({
    ...await (await fetchFresh()).json(), generatedAt: new Date(Date.now() - 16 * 86400000).toISOString()
  }) });
  await safety.validateRoutes();
  safety.showConflicts(map, [route]);
  assert.equal(safety.isCurrent(route), false);
  assert.equal(active().length, 1);
  assert.ok(route.lorryValidation.issues.some(message => message.includes('14 days')));
});
