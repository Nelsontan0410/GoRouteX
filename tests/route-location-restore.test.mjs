import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = read('app.html');
const between = (from, to) => { const start = app.indexOf(from); const end = app.indexOf(to, start + from.length); assert.ok(start > 0 && end > start, from); return app.slice(start, end); };
const restoreSource = between('    function routeLocationOwner()', '    function setSelectedOrigin(');
const locationInputSource = between('    function getLocationInput(addressString)', '        // For other customer addresses');
const plain = (v) => JSON.parse(JSON.stringify(v));
const WAREHOUSE = '48 Toh Guan Road East, Singapore 608586';
const WAREHOUSE_LL = { lat: 1.3329, lng: 103.7436 };

function harness({ uid = 'u1', company = {}, storage = {}, geocode } = {}) {
  const store = new Map(Object.entries(storage));
  const ctx = vm.createContext({ console, Promise, setTimeout, clearTimeout, JSON, Map, Number, String, Object, Array, Math });
  ctx.window = ctx;
  ctx.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  vm.runInContext(read('orders/route-planning-preferences.js'), ctx);
  vm.runInContext(read('settings/settings-geocode.js'), ctx);
  ctx.state = { uid, calls: [] };
  ctx.FirebaseApp = { auth: { getCurrentUser: () => (ctx.state.uid ? { uid: ctx.state.uid } : null) } };
  ctx.GoRouteXSettings = { getCachedSettings: () => ({ routePlanning: company }) };
  ctx.google = { maps: { Geocoder: function () {} } };
  ctx.geocodeImpl = geocode || (async () => ({ results: [{ formatted_address: WAREHOUSE, geometry: { location: { lat: () => WAREHOUSE_LL.lat, lng: () => WAREHOUSE_LL.lng }, location_type: 'ROOFTOP' } }] }));
  vm.runInContext(`
    var routeOriginMode = 'current', customOriginAddress = '', customOriginLatLng = null, customOriginLabel = '';
    var currentLocationOrigin = null, currentLatLng = null, routeEndRequired = true, routeEndMode = 'same';
    var customEndAddress = '', customEndLatLng = null, customEndLabel = '';
    var customOriginInput = { value: '' }, customEndInput = { value: '' }, addressNameMap = {};
    var fixedDestinationAddress = '__dispatch_base__';
    var routeLocationRequestId = 0; var routeLocationResolutions = new Map();
    var statuses = [];
    function updateRouteOriginControls() {}
    function setCustomOriginStatus(m, e) { statuses.push(['start', m, !!e]); }
    function setCustomEndStatus(m, e) { statuses.push(['end', m, !!e]); }
    function setOriginMarker() {}
    function getImportGeocoder() { return { geocode: (request) => { state.calls.push(request.address); return geocodeImpl(request); } }; }
    function getCustomerEntryByAddress() { return null; }
    ${restoreSource}
    ${locationInputSource} return addressString; }
  `, ctx);
  ctx.store = store;
  return ctx;
}
const savedKey = (uid) => `goroutex.route-locations.v1:${uid}`;
const tick = () => new Promise((r) => setTimeout(r, 5));

test('restore keeps "this browser first, then company" and borrows company coordinates only for the same address', async () => {
  const company = { defaultStart: { address: WAREHOUSE, label: 'Warehouse', latLng: WAREHOUSE_LL } };
  const sameAddress = harness({ company, storage: { [savedKey('u1')]: JSON.stringify({ start: { address: '48 TOH GUAN ROAD EAST , SINGAPORE 608586', label: 'WH' } }) } });
  sameAddress.restoreSavedRouteLocations();
  assert.deepEqual(plain(sameAddress.currentLatLng), WAREHOUSE_LL);
  assert.equal(sameAddress.customOriginLabel, 'WH', 'the browser choice still wins');
  const other = harness({ company, storage: { [savedKey('u1')]: JSON.stringify({ start: { address: '1 Tuas Ave 1, Singapore', label: 'Tuas' } }) },
    geocode: async () => { throw Object.assign(new Error('ZERO_RESULTS'), { code: 'ZERO_RESULTS' }); } });
  other.restoreSavedRouteLocations();
  assert.equal(other.customOriginAddress, '1 Tuas Ave 1, Singapore');
  assert.equal(other.currentLatLng, null, 'a different address never gets the warehouse coordinates');
  await tick();
  assert.equal(other.currentLatLng, null);
  assert.ok(other.statuses.some(([kind, , isError]) => kind === 'start' && isError), 'the failure is shown');
  const companyOnly = harness({ company });
  companyOnly.restoreSavedRouteLocations();
  assert.equal(typeof companyOnly.getLocationInput(companyOnly.currentLocationOrigin), 'object');
});

test('an old address-only start is resolved once, written back, and Same as Start returns the same object', async () => {
  const ctx = harness({ storage: { [savedKey('u1')]: JSON.stringify({ start: { address: WAREHOUSE, label: 'Warehouse' } }) } });
  ctx.restoreSavedRouteLocations();
  const second = ctx.ensureRouteLocationCoordinates();
  await second;
  assert.equal(ctx.state.calls.length, 1, 'in-flight checks for the same address are shared');
  assert.deepEqual(plain(ctx.currentLatLng), WAREHOUSE_LL);
  assert.deepEqual(plain(JSON.parse(ctx.store.get(savedKey('u1'))).start.latLng), WAREHOUSE_LL, 'saved in this browser');
  assert.deepEqual(plain(ctx.getLocationInput(ctx.currentLocationOrigin)), WAREHOUSE_LL);
  assert.deepEqual(plain(ctx.getLocationInput('__dispatch_base__')), WAREHOUSE_LL, 'Same as Start uses the start coordinates');
});

test('a late answer is dropped after an account switch or an address change', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = harness({ storage: { [savedKey('u1')]: JSON.stringify({ start: { address: WAREHOUSE, label: 'Warehouse' } }) },
    geocode: async () => { await gate; return { results: [{ formatted_address: WAREHOUSE, geometry: { location: { lat: () => 1.3329, lng: () => 103.7436 } } }] }; } });
  ctx.restoreSavedRouteLocations();
  ctx.state.uid = 'u2';
  release();
  await tick();
  assert.equal(ctx.customOriginLatLng, null, 'not written into the other account');
  assert.equal(ctx.store.get(savedKey('u2')), undefined);

  let release2;
  const gate2 = new Promise((r) => { release2 = r; });
  const moved = harness({ storage: { [savedKey('u1')]: JSON.stringify({ start: { address: WAREHOUSE, label: 'Warehouse' } }) },
    geocode: async () => { await gate2; return { results: [{ formatted_address: WAREHOUSE, geometry: { location: { lat: () => 1.3329, lng: () => 103.7436 } } }] }; } });
  moved.restoreSavedRouteLocations();
  moved.customOriginAddress = 'Somewhere else';
  release2();
  await tick();
  assert.equal(moved.customOriginLatLng, null, 'an answer for the old address is not applied to the new one');
});

test('company settings that arrive late lend coordinates only to the same unedited address', () => {
  const ctx = harness({ storage: { [savedKey('u1')]: JSON.stringify({ start: { address: WAREHOUSE, label: 'Warehouse' } }) }, geocode: () => new Promise(() => {}) });
  ctx.restoreSavedRouteLocations();
  ctx.customOriginInput.value = 'Warehouse';
  ctx.applyLateCompanyCoordinates({ defaultStart: { address: WAREHOUSE, latLng: WAREHOUSE_LL } });
  assert.deepEqual(plain(ctx.currentLatLng), WAREHOUSE_LL);
  const edited = harness({ storage: { [savedKey('u1')]: JSON.stringify({ start: { address: WAREHOUSE, label: 'Warehouse' } }) }, geocode: () => new Promise(() => {}) });
  edited.restoreSavedRouteLocations();
  edited.customOriginInput.value = 'Warehouse 2 (typing)';
  edited.applyLateCompanyCoordinates({ defaultStart: { address: WAREHOUSE, latLng: WAREHOUSE_LL } });
  assert.equal(edited.currentLatLng, null);
});

test('Same as Start survives a refresh even when an old custom end is still saved', () => {
  const ctx = harness({ storage: { [savedKey('u1')]: JSON.stringify({ start: { address: WAREHOUSE, label: 'W', latLng: WAREHOUSE_LL }, end: { address: 'Old end', label: 'Old end', latLng: { lat: 1.3, lng: 103.9 } } }) } });
  ctx.GoRouteXRouteLocations.save('u1', 'endMode', 'same');
  ctx.restoreSavedRouteLocations();
  assert.equal(ctx.routeEndMode, 'same');
  assert.equal(ctx.customEndAddress, 'Old end', 'the custom end is kept for when the user switches back');
  const custom = harness({ storage: { [savedKey('u1')]: JSON.stringify({ start: { address: WAREHOUSE, label: 'W', latLng: WAREHOUSE_LL }, end: { address: 'Old end', label: 'Old end', latLng: { lat: 1.3, lng: 103.9 } }, endMode: 'custom' }) } });
  custom.restoreSavedRouteLocations();
  assert.equal(custom.routeEndMode, 'custom');
  assert.match(app, /routeEndMode = event\.target\.value;\s*window\.GoRouteXRouteLocations\?\.save\(routeLocationOwner\(\), 'endMode', routeEndMode\);/);
});

test('saved browser locations accept only numeric coordinates', () => {
  const ctx = harness({ storage: { [savedKey('u1')]: JSON.stringify({ start: { address: 'A', latLng: { lat: '1.3', lng: '103.8' } }, end: { address: 'B', latLng: { lat: null, lng: null } } }) } });
  const saved = ctx.GoRouteXRouteLocations.read('u1');
  assert.equal(saved.start.latLng, null);
  assert.equal(saved.end.latLng, null);
});
