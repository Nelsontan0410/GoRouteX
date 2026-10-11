import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { navigationParts, MAPS_LINK_WAYPOINTS } from '../driver/navigation.js';

const stops = Array.from({ length: 16 }, (_, i) => ({ sequence: i + 1, stopName: `S${i + 1}`, lat: 1.3 + i / 1000, lng: 103.8 }));
const warehouse = { lat: 1.3329, lng: 103.7436 };
const params = (url) => new URL(url).searchParams;

test('16 stops: part 1 = start + stops 1-9, part 2 = stop 9 + stops 10-16 + end', () => {
  assert.equal(MAPS_LINK_WAYPOINTS, 8);
  const parts = navigationParts({ origin: warehouse, end: warehouse, stops });
  assert.equal(parts.length, 2);
  const [one, two] = parts.map((p) => params(p.url));
  assert.equal(one.get('origin'), '1.3329,103.7436');
  assert.equal(one.get('waypoints').split('|').length, 8, 'stops 1-8 as waypoints');
  assert.equal(one.get('destination'), `${stops[8].lat},103.8`, 'stop 9 ends part 1');
  assert.equal(two.get('origin'), `${stops[8].lat},103.8`, 'part 2 starts at stop 9');
  assert.equal(two.get('waypoints').split('|').length, 7, 'stops 10-16');
  assert.equal(two.get('destination'), '1.3329,103.7436', 'back to the warehouse');
  assert.deepEqual(parts.map((p) => [p.fromLabel, p.toLabel, p.firstStop, p.lastStop]), [['Start', 'Stop 9', 1, 9], ['Stop 9', 'End', 10, 16]]);
  assert.equal(one.get('travelmode'), 'driving');
});

test('a short day is one link; without an end the last stop is the destination', () => {
  const parts = navigationParts({ origin: warehouse, stops: stops.slice(0, 5) });
  assert.equal(parts.length, 1);
  assert.equal(params(parts[0].url).get('destination'), `${stops[4].lat},103.8`);
  assert.equal(params(parts[0].url).get('waypoints').split('|').length, 4);
});

test('detour points ride along as waypoints in their place; no origin means the phone location', () => {
  const parts = navigationParts({ stops: stops.slice(0, 3), detours: [{ lat: 1.25, lng: 103.7, legIndex: 1 }] });
  const p = params(parts[0].url);
  assert.equal(p.get('origin'), null, 'Google Maps starts from where the driver is');
  assert.deepEqual(p.get('waypoints').split('|'), [`${stops[0].lat},103.8`, '1.25,103.7', `${stops[1].lat},103.8`]);
  assert.equal(parts[0].fromLabel, 'Your location');
});

test('addresses are used when a stop has no coordinates', () => {
  const parts = navigationParts({ origin: { address: '48 Toh Guan Road East' }, stops: [{ sequence: 1, deliveryAddress: '61a Tuas Nexus Drive' }] });
  assert.equal(params(parts[0].url).get('origin'), '48 Toh Guan Road East');
  assert.equal(params(parts[0].url).get('destination'), '61a Tuas Nexus Drive');
});

test('the driver page shows the parts, from the start before the route starts and remaining stops after', () => {
  const page = readFileSync(new URL('../driver/driver-page.js', import.meta.url), 'utf8');
  assert.match(page, /origin:started\?null:\(route\.originLatLng\|\|\{address:route\.originName\}\)/);
  assert.match(page, /const list=started\?remaining:stops;/);
  assert.match(readFileSync(new URL('../driver-tracking.html', import.meta.url), 'utf8'), /id="driverNavigateAll"/);
});
