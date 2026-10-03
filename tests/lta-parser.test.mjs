import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySign, normalizeLtaGeoJSON } from '../scripts/lib/lta-parser.mjs';
const feature = (properties = {}, coordinates = [103.84, 1.32]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {
  TYP_NAM: '4002', TYP_CD: 'Exceeding 2500kg In Unladen Weight [4002]', UNIQUE_ID: 125153, BEARG_NUM: 0, ...properties
} });
const parse = (...features) => normalizeLtaGeoJSON({ type: 'FeatureCollection', features });
test('4002 is extracted with correct coordinate order and remains a supplementary plate', () => {
  const s = parse(feature()).signs[0];
  assert.equal(s.threshold, 2500); assert.equal(s.latitude, 1.32); assert.equal(s.longitude, 103.84);
  assert.equal(s.bearing, 0); assert.equal(s.role, 'SUPPLEMENTARY'); assert.equal(s.parentSignId, null);
  assert.equal(s.bearingConvention, 'TRAVEL_DIRECTION');
});
test('unknown dimensions are never inferred and opposing weight conditions stay distinct', () => {
  assert.equal(classifySign('1005', 'Width Limit [1005]').threshold, null);
  assert.equal(classifySign('1006', 'Weight Limit [1006]').threshold, null);
  assert.equal(classifySign('1076', 'Height Limit - X.Xm [1076]').threshold, null);
  assert.equal(classifySign('4007', 'Vehicles Not Exceeding 2500 Kg In Unladen Weight [4007]').comparison, 'NOT_EXCEEDING');
  assert.equal(classifySign('1069', 'MAX LADEN WEIGHT 30 TONNES [1069]').threshold, 30000);
});
test('height warnings, explicit limits, axles and unrelated signs', () => {
  assert.equal(classifySign('2031', 'Height Limit Ahead - 4.5m [2031]').role, 'ADVANCE_WARNING');
  assert.equal(classifySign('1007', 'Height Limit - 4.5m [1007]').threshold, 4.5);
  assert.equal(classifySign('1012', 'Restriction Of Movement Of Vehicles With 3 Or More Axles [1012]').threshold, 3);
  assert.equal(classifySign('3351', 'No Parking of Lorry [3351]'), null);
  assert.equal(classifySign('2036', 'Road Hump Ahead [2036]'), null);
});
test('missing bearings are not converted to north', () => {
  for (const value of [null, '', 'invalid', -1, 361]) assert.equal(parse(feature({ BEARG_NUM: value })).signs[0].bearing, null);
});
test('rejects corrupt source, duplicate IDs and invalid or swapped coordinates', () => {
  assert.throws(() => normalizeLtaGeoJSON({}), /FeatureCollection/);
  assert.throws(() => parse(feature(), feature()), /Duplicate/);
  assert.throws(() => parse(feature({}, [1.32, 103.84])), /Invalid relevant/);
  assert.throws(() => parse(feature({}, [null, 1.32])), /Invalid relevant/);
});
test('published compact dataset retains the West Coast 4002 acceptance sign', () => {
  const data = JSON.parse(readFileSync(new URL('../data/lta-restrictions.json', import.meta.url), 'utf8'));
  const sign = data.signs.find((entry) => entry.id === '120054');
  assert.ok(sign);
  assert.equal(sign.signCode, '4002');
  assert.equal(sign.latitude, 1.3143747913860258);
  assert.equal(sign.longitude, 103.7548210862709);
  assert.equal(sign.bearing, 38.27819222);
});
