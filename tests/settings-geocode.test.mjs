import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../settings/settings-geocode.js', import.meta.url), 'utf8');
function load(extra = {}) {
  const ctx = vm.createContext({ setTimeout, clearTimeout, Promise, ...extra });
  ctx.window = ctx;
  vm.runInContext(source, ctx);
  return ctx;
}
const G = load().GoRouteXGeocode;
const plain = (v) => JSON.parse(JSON.stringify(v));
const loc = (lat, lng) => ({ lat: () => lat, lng: () => lng });
const result = (extra = {}) => ({ formatted_address: '48 Toh Guan Rd E, Singapore 608586', geometry: { location: loc(1.3329, 103.7436), location_type: 'ROOFTOP' }, ...extra });

test('only one exact match is accepted; anything else returns a reason', () => {
  assert.deepEqual(plain(G.classifyResults([result()])), { ok: true, address: '48 Toh Guan Rd E, Singapore 608586', latLng: { lat: 1.3329, lng: 103.7436 }, quality: 'address' });
  assert.equal(G.classifyResults([]).code, 'ZERO_RESULTS');
  assert.equal(G.classifyResults([result(), result()]).code, 'AMBIGUOUS');
  assert.equal(G.classifyResults([result({ partial_match: true })]).code, 'PARTIAL');
  assert.equal(G.classifyResults([result({ geometry: {} })]).code, 'NO_GEOMETRY');
  assert.equal(G.classifyResults([result({ geometry: { location: loc(1.33, 103.7), location_type: 'APPROXIMATE' } })]).code, 'APPROXIMATE');
  assert.equal(G.classifyResults([result({ geometry: { location: loc(NaN, 103.7) } })]).code, 'NO_GEOMETRY');
});

test('geocoder errors and timeouts become reasons, never coordinates', async () => {
  const maps = { Geocoder: function () {} };
  const fail = (code) => ({ geocode: () => Promise.reject(Object.assign(new Error(`Geocoding failed: ${code}`), { code })) });
  assert.equal((await G.geocodeAddress('x', { maps, geocoder: fail('ZERO_RESULTS') })).code, 'ZERO_RESULTS');
  const denied = await G.geocodeAddress('x', { maps, geocoder: fail('REQUEST_DENIED') });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /rejected/);
  const slow = await G.geocodeAddress('x', { maps, geocoder: { geocode: () => new Promise(() => {}) }, timeoutMs: 20 });
  assert.equal(slow.code, 'TIMEOUT');
  assert.equal((await G.geocodeAddress('  ', { maps, geocoder: fail('X') })).code, 'INVALID_REQUEST');
  const ok = await G.geocodeAddress('48 Toh Guan', { maps, geocoder: { geocode: async () => ({ results: [result()] }) } });
  assert.equal(ok.ok, true);
});

test('Places autocomplete: a place without a position is not verified', () => {
  assert.equal(G.fromPlace({ name: 'X' }, 'X'), null);
  assert.deepEqual(plain(G.fromPlace({ formatted_address: 'A', geometry: { location: loc(1.3, 103.8) } }, 'typed')), { address: 'A', latLng: { lat: 1.3, lng: 103.8 }, quality: 'place' });
});

test('the Maps loader is shared, times out, and can be retried after a failure', async () => {
  const scripts = [];
  const doc = { createElement: () => { const s = { remove() {} }; scripts.push(s); return s; }, head: { appendChild() {} } };
  const ctx = load({ document: doc });
  const geo = ctx.GoRouteXGeocode;
  const a = geo.loadMapsApi({ timeoutMs: 30 });
  const b = geo.loadMapsApi({ timeoutMs: 30 });
  assert.equal(a, b, 'one load at a time');
  assert.equal(scripts.length, 1);
  await assert.rejects(a, (error) => error.code === 'MAPS_UNAVAILABLE');
  const retry = geo.loadMapsApi({ timeoutMs: 1000 });
  assert.equal(scripts.length, 2, 'a failed load is retried');
  ctx.google = { maps: { Geocoder: function () {}, places: {} } };
  ctx.__goroutexGeocodeMapsReady();
  assert.equal(await retry, ctx.google.maps);
  scripts[1].onerror?.();
});

test('a rejected key stops further loads with a clear reason', async () => {
  const doc = { createElement: () => ({ remove() {} }), head: { appendChild() {} } };
  const ctx = load({ document: doc });
  const pending = ctx.GoRouteXGeocode.loadMapsApi({ timeoutMs: 1000 });
  ctx.gm_authFailure();
  await assert.rejects(pending, (error) => error.code === 'AUTH_FAILED');
  await assert.rejects(ctx.GoRouteXGeocode.loadMapsApi(), (error) => error.code === 'AUTH_FAILED');
});

test('coordinates follow the exact address they were verified for', () => {
  const verified = { address: '48 Toh Guan Rd E, Singapore 608586', latLng: { lat: 1.3329, lng: 103.7436 } };
  assert.deepEqual(plain(G.pointFor(' 48 Toh Guan Rd E, Singapore 608586 ', verified, null)).latLng, { lat: 1.3329, lng: 103.7436 });
  assert.equal(G.pointFor('48 Toh Guan Rd E, Singapore 608587', verified, null).latLng, null, 'edited text drops coordinates');
  assert.equal(G.pointFor('', verified, null), null);
  const loaded = { address: 'Old', label: 'Warehouse', latLng: null };
  assert.equal(G.pointFor('Old', null, loaded).label, 'Warehouse');
});

test('save check: unchanged old addresses never block; new ones are geocoded or block with a reason', async () => {
  const calls = [];
  const geocode = async (address) => { calls.push(address); return address === 'bad' ? { ok: false, code: 'AMBIGUOUS', reason: 'Several places match' } : { ok: true, latLng: { lat: 1.3, lng: 103.8 } }; };
  const loaded = { defaultStart: { address: 'Old warehouse', label: 'Old warehouse', latLng: null }, defaultEnd: null };
  const unchanged = { defaultStart: { address: 'Old warehouse', label: 'Old warehouse', latLng: null }, defaultEnd: null };
  assert.equal((await G.verifyPoints(unchanged, loaded, geocode)).ok, true);
  assert.equal(calls.length, 0, 'Google is not even asked');
  const edited = { defaultStart: { address: 'New warehouse', label: 'New warehouse', latLng: null }, defaultEnd: { address: 'bad', label: 'bad', latLng: null } };
  const outcome = await G.verifyPoints(edited, loaded, geocode);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.field, 'defaultEnd');
  assert.deepEqual(plain(outcome.matched), ['defaultStart']);
  assert.deepEqual(plain(edited.defaultStart.latLng), { lat: 1.3, lng: 103.8 });
  assert.equal(edited.defaultEnd.latLng, null);
});

test('Settings page: save uses one snapshot, edits during the save stay unsaved, typing clears coordinates', () => {
  const page = readFileSync(new URL('../settings/settings-page.js', import.meta.url), 'utf8');
  const save = page.slice(page.indexOf('async function save('), page.indexOf('function bind()'));
  assert.match(save, /const input = readForm\(\)/);
  assert.match(save, /verifySnapshotLocations\(input\)/);
  assert.match(save, /saveTenantSettings\(input\)/);
  assert.match(save, /state\.baseline = JSON\.stringify\(input\)/);
  assert.doesNotMatch(save, /baseline = JSON\.stringify\(readForm\(\)\)/);
  assert.match(page, /if \(LOCATION_FIELDS\.includes\(event\.target\.id\)\) onLocationInput\(event\.target\.id\)/);
  assert.match(page, /state\.verified\[id\]\.address !== \$\(id\)\.value\.trim\(\)\) state\.verified\[id\] = null/);
  assert.doesNotMatch(page, /latLng: null \}/);
});
