import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../lorry-restrictions.js';
import '../restriction-routing.js';
const core = globalThis.LorryRestrictions, routing = globalThis.RestrictionRouting;
const a = { lat: 1.32, lng: 103.83 }, b = { lat: 1.32, lng: 103.85 }, c = { lat: 1.32, lng: 103.86 };
const detour = [a, { lat: 1.322, lng: 103.83 }, { lat: 1.322, lng: 103.84 }, { lat: 1.322, lng: 103.85 }, b];
const leg = (path) => ({ start_location: path[0], end_location: path.at(-1), duration: { value: 600 }, steps: [{ path }] });
const response = (...paths) => ({ routes: [{ legs: paths.map(leg) }] });
const original = response([a, b], [b, c]);
const dataset = { generatedAt: new Date().toISOString(), signs: [{ id: 'chosen', signCode: '4002', signName: 'Exceeding 2500kg', role: 'SUPPLEMENTARY',
  latitude: 1.32, longitude: 103.84, bearing: 90, bearingConvention: 'TRAVEL_DIRECTION' }] };
const validate = (result) => core.validateRouteAgainstLorryRestrictions(core.extractGeometry(result), ['4002'], dataset);
const route = () => ({ id: 1, optimizedStops: ['A', 'B', 'C'], directionsResult: original });
test('automatic avoidance does not replace a manually chosen detour on the conflicting leg', async () => {
  let calls = 0;
  const result = await routing.attemptBypass({ ...route(), manualWaypoints: [{ lat: 1.32, lng: 103.835, legIndex: 0 }] }, validate(original), validate, async () => { calls++; return original; });
  assert.equal(calls, 0);
  assert.equal(result.changed, false);
  assert.match(result.reason, /detour point is preserved/);
});
test('uses Google-returned road nodes, revalidates full route and preserves delivery stopovers', async () => {
  const inputs = [];
  const result = await routing.attemptBypass(route(), validate(original), validate, async (input) => {
    inputs.push(input); return inputs.length === 1 ? response(detour) : response(detour, [b, c]);
  });
  assert.equal(result.changed, true); assert.equal(result.validation.safe, true); assert.equal(inputs.length, 2);
  assert.equal(inputs[0].provideRouteAlternatives, true); assert.equal(inputs[0].waypoints, undefined);
  assert.equal(inputs[1].optimizeWaypoints, false);
  assert.deepEqual(inputs[1].waypoints.filter((p) => p.stopover).map((p) => p.location), [b]);
  assert.ok(result.safetyWaypoints.every((p) => detour.some((node) => node.lat === p.lat && node.lng === p.lng)));
  assert.ok(inputs[1].waypoints.some((p) => p.stopover === false));
});
test('rejects Google recalculation that still crosses selected signs; caps all extra calls at three', async () => {
  let calls = 0;
  const result = await routing.attemptBypass(route(), validate(original), validate, async () => ++calls === 1 ? response(detour) : original);
  assert.equal(calls, 3); assert.equal(result.changed, false); assert.equal(result.validation.safe, false);
  assert.equal(result.directionsResult, original); assert.deepEqual(result.safetyWaypoints, []);
});
test('no safe alternative, missing context, cancellation and Google errors never fake a route', async () => {
  const initial = validate(original);
  const noAlternative = await routing.attemptBypass(route(), initial, validate, async () => response([a, b]));
  assert.equal(noAlternative.changed, false); assert.equal(noAlternative.reroutes, 1);
  const cancelled = await routing.attemptBypass(route(), initial, validate, async () => { throw new Error('must not call'); }, () => false);
  assert.equal(cancelled.changed, false); assert.equal(cancelled.reroutes, 0);
  const failed = await routing.attemptBypass(route(), initial, validate, async () => { throw new Error('QUOTA'); });
  assert.equal(failed.changed, false); assert.match(failed.reason, /QUOTA/);
  const missing = await routing.attemptBypass(route(), { ...initial, issues: ['incomplete'] }, validate, async () => { throw new Error('must not call'); });
  assert.equal(missing.reroutes, 0);
});
test('rejects alternatives or full responses that move delivery endpoints', async () => {
  let calls = 0;
  const result = await routing.attemptBypass(route(), validate(original), validate, async () => ++calls === 1 ? response(detour) : response(detour, [b, { lat: 1.4, lng: 103.86 }]));
  assert.equal(result.changed, false);
});
test('mobile handoff preserves every delivery and manual navigation waypoint without truncation', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ lat: 1.3, lng: 103.8 + i * 0.01 }));
  const manual = [{ lat: 1.301, lng: 103.805, legIndex: 0 }, { lat: 1.301, lng: 103.806, legIndex: 0 }, { lat: 1.301, lng: 103.807, legIndex: 0 }];
  const plan = { optimizedStops: points.map((_, i) => `stop-${i}`), directionsResult: response(...points.slice(1).map((p, i) => [points[i], p])), manualWaypoints: manual };
  const links = routing.navigationLinks(plan); assert.ok(links.length > 1);
  const observed = [];
  for (const [i, link] of links.entries()) {
    const params = new URL(link.url).searchParams, vias = params.get('waypoints')?.split('|') || [];
    assert.ok(vias.length <= 3); assert.ok(link.url.length <= 2048);
    if (i === 0) observed.push(params.get('origin'));
    else assert.equal(params.get('origin'), observed.at(-1));
    observed.push(...vias, params.get('destination'));
  }
  const text = (p) => `${p.lat},${p.lng}`;
  assert.deepEqual(observed, [text(points[0]), ...manual.map(text), ...points.slice(1).map(text)]);
  assert.deepEqual(routing.navigationLinks({ ...plan, safetyWaypoints: [{ lat: 1.301, lng: 103.808, legIndex: 0 }] }), links);
});

test('manual detour points stay on their chosen leg and survive segmented navigation links', () => {
  const manual = [
    { id: 'm1', lat: 1.321, lng: 103.831, legIndex: 0 },
    { id: 'm2', lat: 1.322, lng: 103.832, legIndex: 0 },
    { id: 'm3', lat: 1.323, lng: 103.833, legIndex: 0 },
    { id: 'm4', lat: 1.324, lng: 103.834, legIndex: 0 }
  ];
  const request = routing.buildRequest([a, b, c], [], manual);
  assert.deepEqual(request.waypoints.slice(0, 4).map((point) => point.location), manual.map(({ lat, lng }) => ({ lat, lng })));
  assert.equal(request.waypoints[4].stopover, true);
  const plan = { optimizedStops: ['A', 'B', 'C'], directionsResult: original, safetyWaypoints: [], manualWaypoints: manual };
  const links = routing.navigationLinks(plan);
  assert.ok(links.length > 1);
  const observed = [];
  for (const [index, link] of links.entries()) {
    const params = new URL(link.url).searchParams;
    if (index === 0) observed.push(params.get('origin'));
    observed.push(...(params.get('waypoints')?.split('|') || []), params.get('destination'));
  }
  assert.deepEqual(observed, [`${a.lat},${a.lng}`, ...manual.map((point) => `${point.lat},${point.lng}`), `${b.lat},${b.lng}`, `${c.lat},${c.lng}`]);
});

test('every app handoff uses the segmented navigation builder', () => {
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const page3Start = app.indexOf('function openRouteInGoogleMapsPage3');
  const page3End = app.indexOf('function formatRouteDurationLabel', page3Start);
  assert.match(app.slice(page3Start, page3End), /RouteSafety\.openNavigation\(routeData\)/);
  const shareStart = app.indexOf('function buildRouteShareData');
  const shareEnd = app.indexOf('function updateRouteSharePreview', shareStart);
  assert.match(app.slice(shareStart, shareEnd), /const mapsUrl = RouteSafety\.navigationText\(routeData\)/);
});
