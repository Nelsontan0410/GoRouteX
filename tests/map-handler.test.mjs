import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../map-handler.js', import.meta.url), 'utf8');

test('encoded step geometry is decoded instead of drawing a straight endpoint line', () => {
  const polylines = [];
  const context = {
    window: null,
    google: { maps: {
      Polyline: class { constructor(options) { this.options = options; polylines.push(this); } },
      geometry: { encoding: { decodePath: () => [{ lat: 1.3, lng: 103.8 }, { lat: 1.31, lng: 103.81 }, { lat: 1.32, lng: 103.82 }] } }
    } }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`${source};globalThis.__mapHandler = MapHandler;`, context);
  const route = { directionsResult: { routes: [{ legs: [{
    start_location: { lat: 1.3, lng: 103.8 }, end_location: { lat: 1.32, lng: 103.82 },
    steps: [{ polyline: { points: 'encoded' } }]
  }] }] } };
  context.__mapHandler.renderRouteLegs(route, {}, {});
  assert.equal(polylines.length, 1);
  assert.equal(polylines[0].options.path.length, 3);
  assert.equal(polylines[0].options.clickable, false);
});
