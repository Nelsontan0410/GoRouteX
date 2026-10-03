import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../route-engine.js', import.meta.url), 'utf8');

function loadEngine() {
  const context = { console };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.RouteEngine;
}

test('manual and final planning share an order-preserving route request definition', () => {
  const engine = loadEngine();
  const definition = engine.buildRouteRequest({
    originIdentifier: 'START',
    stopIds: ['A', 'B'],
    configuredEndId: 'START',
    origin: { lat: 1.33, lng: 103.74 },
    destination: { lat: 1.33, lng: 103.74 },
    waypoints: [
      { location: { lat: 1.31, lng: 103.75 }, stopover: true },
      { location: { lat: 1.32, lng: 103.69 }, stopover: true }
    ]
  });
  assert.deepEqual(Array.from(definition.optimizedStops), ['START', 'A', 'B', 'START']);
  assert.equal(definition.request.optimizeWaypoints, false);
  assert.deepEqual(Array.from(definition.request.waypoints, (item) => item.stopover), [true, true]);
});

test('route request cache key changes when a resolved coordinate changes under the same stop IDs', () => {
  const engine = loadEngine();
  const base = {
    originIdentifier: 'START', stopIds: ['A'], configuredEndId: '',
    origin: { lat: 1.3, lng: 103.8 }, destination: { lat: 1.31, lng: 103.81 }, waypoints: []
  };
  const first = engine.buildRouteRequest(base);
  const second = engine.buildRouteRequest({ ...base, destination: { lat: 1.311, lng: 103.81 } });
  assert.notEqual(first.cacheKey, second.cacheKey);
});

test('manual detours are non-stop points inserted before their selected delivery leg', () => {
  const engine = loadEngine();
  const definition = engine.buildRouteRequest({
    originIdentifier: 'START', stopIds: ['A', 'B'], configuredEndId: '',
    origin: { lat: 1.3, lng: 103.8 }, destination: { lat: 1.32, lng: 103.82 },
    waypoints: [{ location: { lat: 1.31, lng: 103.81 }, stopover: true }],
    manualWaypoints: [{ id: 'via-a', lat: 1.305, lng: 103.805, legIndex: 0 }, { id: 'via-b', lat: 1.315, lng: 103.815, legIndex: 1 }]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(Array.from(definition.request.waypoints, (point) => [point.location, point.stopover]))), [
    [{ lat: 1.305, lng: 103.805 }, false],
    [{ lat: 1.31, lng: 103.81 }, true],
    [{ lat: 1.315, lng: 103.815 }, false]
  ]);
  assert.match(definition.cacheKey, /via-a/);
});

test('direction classification uses the specified boundary ranges and preserves origin stops first', () => {
  const engine = loadEngine();
  const result = engine.classifyStopsByDirection([
    { id: 'origin', lat: 1, lng: 103 },
    { id: 'north', lat: 2, lng: 103 },
    { id: 'east', lat: 1, lng: 104 },
    { id: 'south', lat: 0, lng: 103 },
    { id: 'west', lat: 1, lng: 102 }
  ], { lat: 1, lng: 103 }, ['WEST', 'NORTH', 'EAST', 'SOUTH']);
  assert.deepEqual(Array.from(result.atOrigin, (entry) => entry.stop.id), ['origin']);
  assert.deepEqual(Array.from(engine.flattenDirectionGroups(result), (stop) => stop.id), ['origin', 'west', 'north', 'east', 'south']);
  assert.equal(engine.directionForBearing(315), 'NORTH');
  assert.equal(engine.directionForBearing(45), 'EAST');
  assert.equal(engine.directionForBearing(135), 'SOUTH');
  assert.equal(engine.directionForBearing(225), 'WEST');
});

test('direction bearing normalizes a route crossing the international date line', () => {
  const engine = loadEngine();
  const eastward = engine.bearingDegrees({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
  assert.ok(eastward > 80 && eastward < 100);
  assert.equal(engine.directionForBearing(eastward), 'EAST');
});

test('direction order accepts each direction once and restores missing defaults', () => {
  const engine = loadEngine();
  assert.deepEqual(Array.from(engine.normalizeDirectionOrder(['north', 'WEST', 'north', 'invalid'])), ['NORTH', 'WEST', 'EAST', 'SOUTH']);
});
