import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sanitizeRouteRequest } from '../netlify/functions/_shared/planner-validation.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/osrm-route.json')); // real route from the Singapore network
const stops = [[103.7424, 1.3331], [103.8490, 1.3700], [103.9450, 1.3530], [103.7424, 1.3331]];

function load({ plan = 'basic', enabled = true, manual = false, fetchImpl } = {}) {
  const ctx = vm.createContext({ console, AbortController, setTimeout, clearTimeout, Promise });
  ctx.window = ctx;
  ctx.localStorage = { getItem: (k) => (k === 'goroutexPlanner' && enabled ? 'on' : null) };
  ctx.fetch = fetchImpl || (async () => ({ ok: true, json: async () => ({ success: true, route: fixture }) }));
  ctx.getCurrentUserIdToken = async () => 'token';
  ctx.getCurrentProductPlan = () => plan;
  ctx._autoPlanManualMode = manual;
  vm.runInContext(read('delivery-constraints.js'), ctx);
  vm.runInContext(read('planner-problem.js'), ctx);
  vm.runInContext(read('lorry-restrictions.js'), ctx);
  vm.runInContext(read('planning/plan-engine-client.js'), ctx);
  vm.runInContext(read('map-handler.js') + '\nthis.MapHandler = MapHandler;', ctx);
  return ctx;
}
const request = () => ({
  origin: { lat: 1.3331, lng: 103.7424 }, destination: { lat: 1.3331, lng: 103.7424 }, travelMode: 'DRIVING',
  waypoints: [{ location: { lat: 1.37, lng: 103.849 }, stopover: true }, { location: { lat: 1.353, lng: 103.945 }, stopover: true }]
});
const googleService = (calls) => ({ route: async (req) => { calls.push(req); return { routes: [{ legs: [] }], source: 'google' }; } });

test('Basic routes go to the self-hosted network and come back shaped like a Google result', async () => {
  const ctx = load();
  const calls = [];
  const result = await ctx.MapHandler.route(googleService(calls), request());
  assert.equal(calls.length, 0, 'Google not called');
  assert.equal(result._source, 'osrm');
  const legs = result.routes[0].legs;
  assert.equal(legs.length, 3);
  assert.deepEqual(legs.map((l) => l.duration.value), fixture.legs.map((l) => Math.round(l.duration)));
  assert.ok(legs.every((l) => l.steps[0].path.length > 100), 'per-leg road geometry');
  assert.equal(legs[1].end_location.lng, 103.945);
});

test('the converted result passes the existing lorry restriction geometry reader at full step quality', async () => {
  const ctx = load();
  const result = await ctx.MapHandler.route(googleService([]), request());
  const geometry = ctx.LorryRestrictions.extractGeometry(result);
  assert.equal(geometry.quality, 'STEPS');
  assert.equal(geometry.paths.length, 3);
  assert.deepEqual([...geometry.pathLegIndices], [0, 1, 2]);
});

test('paid plans outside manual mode, optimisation requests, addresses and points outside Singapore use Google', async () => {
  for (const [label, options, req] of [
    ['pro', { plan: 'proplan' }, request()],
    ['switch off', { enabled: false }, request()],
    ['optimise', {}, { ...request(), optimizeWaypoints: true }],
    ['address', {}, { ...request(), origin: '1 Raffles Place' }],
    ['johor', {}, { ...request(), destination: { lat: 1.49, lng: 103.76 } }]
  ]) {
    const calls = [];
    const result = await load(options).MapHandler.route(googleService(calls), req);
    assert.equal(calls.length, 1, label);
    assert.equal(result.source, 'google', label);
  }
  const calls = [];
  await load({ plan: 'proplan', manual: true }).MapHandler.route(googleService(calls), request());
  assert.equal(calls.length, 0, 'manual mode on a paid plan uses the network too');
});

test('if the network route fails, Google is used instead (callback style too)', async () => {
  const ctx = load({ fetchImpl: async () => ({ ok: false, json: async () => ({ success: false, code: 'planner-unavailable' }) }) });
  const calls = [];
  const result = await ctx.MapHandler.route(googleService(calls), request());
  assert.equal(calls.length, 1);
  assert.equal(result.source, 'google');
  const ok = load();
  const status = await new Promise((resolve) => ok.MapHandler.route(googleService([]), request(), (res, st) => resolve([res?._source, st])));
  assert.deepEqual(status, ['osrm', 'OK']);
});

test('network results are drawn as a polyline in the renderer style and cleared with it', async () => {
  const ctx = load();
  const lines = [];
  ctx.google = { maps: { Polyline: class { constructor(o) { this.o = o; this.map = o.map; lines.push(this); } setMap(m) { this.map = m; } }, LatLng: class { constructor(lat, lng) { this._lat = lat; this._lng = lng; } lat() { return this._lat; } lng() { return this._lng; } } } };
  const cleared = [];
  const renderer = { getMap: () => 'MAP', get: () => ({ strokeColor: '#FF4D4F', strokeWeight: 6 }), setDirections: (d) => cleared.push(d), setMap() {} };
  const result = await ctx.MapHandler.route(googleService([]), request());
  ctx.MapHandler.setDirections(renderer, result);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].o.strokeColor, '#FF4D4F');
  assert.equal(lines[0].map, 'MAP');
  assert.ok(lines[0].o.path.length > 1000);
  ctx.MapHandler.clearRendererMap(renderer);
  assert.equal(lines[0].map, null);
});

test('route requests are limited to 2-27 points inside Singapore', () => {
  assert.equal(sanitizeRouteRequest(stops).ok, true);
  assert.equal(sanitizeRouteRequest([stops[0]]).ok, false);
  assert.equal(sanitizeRouteRequest([stops[0], [103.76, 1.49]]).ok, false);
  assert.equal(sanitizeRouteRequest(Array.from({ length: 28 }, () => stops[0])).ok, false);
  const fn = read('netlify/functions/plan-routes.js');
  assert.ok(fn.indexOf("body.action === 'route'") < fn.indexOf('isActiveSession('), 'routes do not use the automatic-planning allowance');
});
