import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePosition, parseFixTime, newTrackingToken, isTrackingToken, hashTrackingToken, isStalePoint, livePayload, TtlCache } from '../netlify/functions/_shared/tracking-domain.js';
import { handleTrack, resetTrackCaches } from '../netlify/functions/track.js';
import { gpsState } from '../driver/live-view-model.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const TOKEN = 'grx_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
const NOW = Date.parse('2026-11-16T02:00:00Z');

class FakeDb {
  constructor() { this.data = new Map(); this.reads = 0; this.writes = []; }
  collection(path) { return new FakeCollection(this, path); }
}
class FakeCollection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new FakeRef(this.db, `${this.path}/${id}`); }
}
class FakeRef {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
  async get() { this.db.reads++; const data = this.db.data.get(this.path); return { exists: !!data, data: () => data }; }
  async set(value, options) { this.db.writes.push({ path: this.path, value, options }); this.db.data.set(this.path, { ...(options?.merge ? this.db.data.get(this.path) : {}), ...value }); }
}
function setup({ deviceActive = true, driver = { role: 'driver', active: true, tenantId: 'owner-a' } } = {}) {
  resetTrackCaches();
  const db = new FakeDb();
  db.data.set(`trackingDevices/${hashTrackingToken(TOKEN)}`, { ownerUid: 'owner-a', driverUid: 'drv_1', active: deviceActive });
  if (driver) db.data.set('users/drv_1', driver);
  return db;
}
const osmand = (extra = '') => new Request(`https://example.test/.netlify/functions/track?id=${TOKEN}&lat=1.3521&lon=103.8198&timestamp=${Math.floor(NOW / 1000) - 5}&speed=10&bearing=90&accuracy=8&batt=76${extra}`, { method: 'POST' });

test('tokens: 32 random base62 characters after grx_, hashed for storage', () => {
  const a = newTrackingToken(), b = newTrackingToken();
  assert.ok(isTrackingToken(a) && isTrackingToken(b));
  assert.notEqual(a, b);
  assert.equal(hashTrackingToken(a).length, 64);
  for (const bad of ['', 'grx_short', 'abc_' + 'a'.repeat(32), TOKEN + 'x', 'grx_' + 'a'.repeat(31) + '-']) assert.equal(isTrackingToken(bad), false, bad);
});

test('fix time: epoch seconds, milliseconds, ISO and plain UTC date-time', () => {
  const iso = '2026-11-16T01:59:30.000Z';
  for (const value of [1794794370, 1794794370000, iso, '2026-11-16 01:59:30']) assert.equal(parseFixTime(value).toISOString(), iso, String(value));
  assert.equal(parseFixTime(''), null);
  assert.equal(parseFixTime('not a date'), null);
});

test('OsmAnd query/form: coordinates, speed knots to m/s, heading, accuracy, battery', () => {
  const params = new URLSearchParams(`id=${TOKEN}&lat=1.35&lon=103.81&speed=10&bearing=90&accuracy=8.5&batt=76.4&timestamp=1794794370`);
  const result = parsePosition(params);
  assert.equal(result.ok, true);
  assert.deepEqual({ ...result.point, fixTime: result.point.fixTime.toISOString() }, { token: TOKEN, lat: 1.35, lng: 103.81, accuracy: 8.5, speedMps: 5.14, heading: 90, fixTime: '2026-11-16T01:59:30.000Z', battery: 76 });
  const combined = parsePosition(new URLSearchParams(`deviceid=${TOKEN}&location=1.3,103.8`));
  assert.equal(combined.point.lat, 1.3);
  assert.equal(combined.point.lng, 103.8);
});

test('JSON body: device_id, coords in m/s, battery level 0..1', () => {
  const json = { device_id: TOKEN, location: { timestamp: '2026-11-16T01:59:30Z', coords: { latitude: 1.35, longitude: 103.81, accuracy: 12, speed: 4.2, heading: 180 }, battery: { level: 0.55 } } };
  const result = parsePosition(new URLSearchParams(), json);
  assert.equal(result.ok, true);
  assert.equal(result.point.token, TOKEN);
  assert.equal(result.point.speedMps, 4.2);
  assert.equal(result.point.battery, 55);
  assert.equal(result.point.fixTime.toISOString(), '2026-11-16T01:59:30.000Z');
});

test('bad coordinates and unknown formats are told apart', () => {
  for (const query of [`id=${TOKEN}&lat=0&lon=0`, `id=${TOKEN}&lat=95&lon=103`, `id=${TOKEN}&lat=abc&lon=103`]) {
    assert.equal(parsePosition(new URLSearchParams(query)).reason, 'coordinates', query);
  }
  const unknown = parsePosition(new URLSearchParams('foo=1&bar=2'));
  assert.equal(unknown.reason, 'format');
  assert.deepEqual(unknown.fields, ['foo', 'bar']);
});

test('stale points and the live payload the Live view reads', () => {
  assert.equal(isStalePoint({ fixTime: new Date(NOW - 119000) }, NOW), false);
  assert.equal(isStalePoint({ fixTime: new Date(NOW - 121000) }, NOW), true);
  assert.equal(isStalePoint({ fixTime: null }, NOW), false);
  const payload = livePayload({ lat: 1.35, lng: 103.81, accuracy: 150, speedMps: 3, heading: 10, battery: 50, fixTime: new Date(NOW + 3600000) }, { driverUid: 'drv_1', ownerUid: 'owner-a' }, { now: new Date(NOW) });
  assert.equal(payload.positionAt.getTime(), NOW, 'phone clock far ahead is replaced by server time');
  assert.equal(payload.source, 'device-app');
  assert.equal(payload.approximate, true);
  const view = gpsState({ ...payload, positionAt: new Date(NOW - 20000) }, NOW);
  assert.equal(view.state, 'live');
  assert.equal(view.source, 'device-app');
  assert.equal(gpsState(null).source, 'browser');
});

test('TTL cache expires entries and caps its size', () => {
  const cache = new TtlCache(1000, 2);
  cache.set('a', 1, 0); cache.set('b', null, 0);
  assert.equal(cache.get('a', 500), 1);
  assert.equal(cache.get('b', 500), null);
  assert.equal(cache.get('a', 1000), undefined);
  cache.set('c', 3, 0); cache.set('d', 4, 0);
  assert.equal(cache.map.size, 2);
});

test('track: a valid position is written to the driver live document', async () => {
  const db = setup();
  const response = await handleTrack(osmand(), { db, now: NOW });
  assert.equal(response.status, 200);
  assert.equal(db.writes.length, 1);
  const { path, value, options } = db.writes[0];
  assert.equal(path, 'users/drv_1/drivers_live/drv_1');
  assert.deepEqual(options, { merge: true });
  assert.equal(value.lat, 1.3521);
  assert.equal(value.lng, 103.8198);
  assert.equal(value.source, 'device-app');
  assert.equal(value.status, 'active');
  assert.equal(value.ownerUid, 'owner-a');
  assert.equal(value.battery, 76);
  assert.equal(value.positionAt.getTime(), NOW - 5000);
});

test('track: form-encoded and JSON bodies are accepted', async () => {
  let db = setup();
  const form = new Request('https://example.test/track', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `id=${TOKEN}&lat=1.3&lon=103.8` });
  assert.equal((await handleTrack(form, { db, now: NOW })).status, 200);
  assert.equal(db.writes.length, 1);
  db = setup();
  const json = new Request('https://example.test/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: TOKEN, location: { coords: { latitude: 1.3, longitude: 103.8 } } }) });
  assert.equal((await handleTrack(json, { db, now: NOW })).status, 200);
  assert.equal(db.writes.length, 1);
});

test('track: unknown device, removed device and inactive driver are refused', async () => {
  let db = setup();
  const other = 'grx_' + 'Z'.repeat(32);
  assert.equal((await handleTrack(new Request(`https://x.test/t?id=${other}&lat=1.3&lon=103.8`), { db, now: NOW })).status, 403);
  db = setup({ deviceActive: false });
  assert.equal((await handleTrack(osmand(), { db, now: NOW })).status, 403);
  db = setup({ driver: { role: 'driver', active: false, tenantId: 'owner-a' } });
  assert.equal((await handleTrack(osmand(), { db, now: NOW })).status, 403);
  db = setup({ driver: { role: 'driver', active: true, tenantId: 'owner-b' } });
  assert.equal((await handleTrack(osmand(), { db, now: NOW })).status, 403);
  assert.equal(db.writes.length, 0);
});

test('track: malformed identifiers never reach the database', async () => {
  const db = setup();
  assert.equal((await handleTrack(new Request('https://x.test/t?id=hello&lat=1.3&lon=103.8'), { db, now: NOW })).status, 400);
  assert.equal((await handleTrack(new Request('https://x.test/t?foo=1'), { db, now: NOW })).status, 400);
  assert.equal(db.reads, 0);
});

test('track: buffered old points and bursts are acknowledged without writing; lookups are cached', async () => {
  const db = setup();
  const old = new Request(`https://x.test/t?id=${TOKEN}&lat=1.3&lon=103.8&timestamp=${Math.floor(NOW / 1000) - 600}`, { method: 'POST' });
  assert.equal((await handleTrack(old, { db, now: NOW })).status, 200);
  assert.equal(db.writes.length, 0);
  assert.equal((await handleTrack(osmand(), { db, now: NOW })).status, 200);
  assert.equal((await handleTrack(osmand(), { db, now: NOW + 3000 })).status, 200);
  assert.equal(db.writes.length, 1, 'second point within 8 s is dropped');
  assert.equal((await handleTrack(osmand(), { db, now: NOW + 9000 })).status, 200);
  assert.equal(db.writes.length, 2);
  assert.equal(db.reads, 2, 'device and driver are read once, then cached');
  const badCoords = new Request(`https://x.test/t?id=${TOKEN}&lat=0&lon=0`, { method: 'POST' });
  assert.equal((await handleTrack(badCoords, { db, now: NOW + 20000 })).status, 200);
  assert.equal(db.writes.length, 2);
});

test('dispatch monitor shows the phone app position on the driver\'s routes', () => {
  assert.match(read('netlify/functions/dispatch.js'), /live\.data\(\)\.routeId === doc\.id \|\| live\.data\(\)\.source === 'device-app'/);
});

test('trackingDevices has no client access in Firestore rules', () => {
  const rules = read('firestore.rules');
  assert.equal(rules.includes('trackingDevices'), false);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});

test('Settings has the phone tracking setup dialog wired to the driver accounts API', () => {
  const html = read('settings.html'), page = read('settings/settings-page.js');
  for (const id of ['trackingSetupDialog', 'trackingServerUrl', 'trackingToken', 'trackingLink', 'trackingUnlink', 'trackingCopyToken']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(page, /driverAccountsApi\('tracking-link'/);
  assert.match(page, /driverAccountsApi\('tracking-unlink'/);
  assert.match(page, /\/\.netlify\/functions\/track/);
  assert.doesNotMatch(page, /innerHTML/);
});
