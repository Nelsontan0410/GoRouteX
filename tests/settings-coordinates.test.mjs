import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLatLng, migrateLegacyLatLng, normalizeSettings, defaultSettings } from '../settings/settings-model.js';

const point = (latLng) => ({ routePlanning: { defaultStart: { address: '48 Toh Guan Road East, Singapore 608586', label: 'Warehouse', latLng } } });

test('coordinates must be plain finite numbers inside the valid range', () => {
  assert.deepEqual(cleanLatLng({ lat: 1.3329, lng: 103.7436 }), { lat: 1.3329, lng: 103.7436 });
  assert.deepEqual(cleanLatLng({ lat: -90, lng: 180 }), { lat: -90, lng: 180 });
  for (const bad of [null, undefined, '', 'x', true, 0, [], {}, { lat: null, lng: null }, { lat: '', lng: '' },
    { lat: true, lng: false }, { lat: '1.3', lng: '103.7' }, { lat: NaN, lng: 103 }, { lat: Infinity, lng: 103 },
    { lat: 91, lng: 103 }, { lat: 1.3, lng: -181 }, { lat: 1.3 }]) {
    assert.equal(cleanLatLng(bad), null, JSON.stringify(bad));
  }
});

test('legacy decimal strings are migrated only when read from storage', () => {
  assert.deepEqual(migrateLegacyLatLng({ lat: ' 1.3329 ', lng: '103.7436' }), { lat: 1.3329, lng: 103.7436 });
  for (const bad of [{ lat: '', lng: '' }, { lat: '1.3abc', lng: '103' }, { lat: '1e2', lng: '103' }, { lat: '0x1', lng: '103' }, { lat: '95', lng: '103' }, { lat: true, lng: '103' }]) {
    assert.equal(migrateLegacyLatLng(bad), null, JSON.stringify(bad));
  }
  const stored = normalizeSettings(point({ lat: '1.3329', lng: '103.7436' }), false, { fromStore: true });
  assert.deepEqual(stored.routePlanning.defaultStart.latLng, { lat: 1.3329, lng: 103.7436 });
  const input = normalizeSettings(point({ lat: '1.3329', lng: '103.7436' }));
  assert.equal(input.routePlanning.defaultStart.latLng, null, 'form input never coerces strings');
});

test('normalize keeps verified coordinates, survives a round trip and keeps old address-only records', () => {
  const once = normalizeSettings(point({ lat: 1.3329, lng: 103.7436 }));
  assert.deepEqual(once.routePlanning.defaultStart, { address: '48 Toh Guan Road East, Singapore 608586', label: 'Warehouse', latLng: { lat: 1.3329, lng: 103.7436 } });
  const reloaded = normalizeSettings(JSON.parse(JSON.stringify(once)), false, { fromStore: true });
  assert.deepEqual(reloaded.routePlanning.defaultStart, once.routePlanning.defaultStart);
  const legacy = normalizeSettings(point(null), false, { fromStore: true });
  assert.equal(legacy.routePlanning.defaultStart.latLng, null);
  assert.equal(legacy.routePlanning.defaultStart.address, '48 Toh Guan Road East, Singapore 608586');
  assert.equal(normalizeSettings({}).routePlanning.defaultStart, defaultSettings().routePlanning.defaultStart);
});
