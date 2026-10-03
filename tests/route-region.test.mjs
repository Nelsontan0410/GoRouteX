import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../lorry-restrictions.js';
import '../route-region.js';
const boundary=JSON.parse(readFileSync(new URL('../data/singapore-boundary.geojson',import.meta.url),'utf8'));
const route=(points)=>({directionsResult:{routes:[{legs:[{steps:[{path:points.map(([lng,lat])=>({lat,lng}))}]}]}]}});
const matches=(points)=>RouteRegion.touchesSingapore([route(points)],boundary);
test('Singapore itinerary shows options, Malaysia and other countries do not',()=>{
  assert.equal(matches([[103.744,1.336],[103.750,1.330]]),true);
  assert.equal(matches([[103.760,1.465],[103.770,1.470]]),false);
  assert.equal(matches([[101.686,3.139],[101.690,3.140]]),false);
  assert.equal(matches([[-0.12,51.50],[-0.13,51.51]]),false);
});
test('cross-border segments detect Singapore even when no vertex lands inside',()=>{
  assert.equal(matches([[103.77,1.47],[103.77,1.30]]),true);
  assert.equal(matches([[103.60,1.35],[104.10,1.35]]),true);
});
test('empty or missing geometry does not infer a country from names',()=>{
  assert.equal(RouteRegion.touchesSingapore([],boundary),false);
  assert.equal(RouteRegion.touchesSingapore([{optimizedStops:['Singapore','Singapore']}],boundary),false);
});
test('a mixed collection needs only one Singapore route',()=>{
  assert.equal(RouteRegion.touchesSingapore([route([[101.686,3.139],[101.69,3.14]]),route([[103.744,1.336],[103.75,1.33]])],boundary),true);
});
