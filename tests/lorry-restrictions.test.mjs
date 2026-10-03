import test from 'node:test';
import assert from 'node:assert/strict';
import '../lorry-restrictions.js';
const engine = globalThis.LorryRestrictions;
const selectedCodes = ['1011'];
const a = { lat: 1.32, lng: 103.83, roadSegmentId: 'test-road' }, b = { lat: 1.32, lng: 103.85, roadSegmentId: 'test-road' };
const sign = { id: 'test', signCode: '1011', signName: 'Restriction on Lorry', restrictionCategory: 'LORRY', role: 'RESTRICTION',
  latitude: 1.32001, longitude: 103.84, threshold: null, bearing: 90, bearingConvention: 'UNVERIFIED', roadSegmentId: null };
const validate = (signs = [sign], codes = selectedCodes, paths = [[a, b]], quality = 'STEPS') => engine.validateRouteAgainstLorryRestrictions(
  { paths, quality }, codes, { signs, generatedAt: new Date().toISOString() });
test('decodes Google encoded polyline and rejects malformed input', () => {
  assert.deepEqual(engine.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
  assert.throws(() => engine.decodePolyline('_'), /Malformed/);
});
test('finds a sign near the middle of a long segment without treating proximity as proof', () => {
  const result = validate(); assert.equal(result.status, 'WARNING'); assert.equal(result.conflicts.length, 1);
  assert.ok(result.conflicts[0].distanceToRoute < 2); assert.equal(result.conflicts[0].routeHeading, 90);
});
test('selected-code blocking uses travel direction; excluding reverse travel also requires road evidence', () => {
  const verified = { ...sign, bearingConvention: 'TRAVEL_DIRECTION', roadSegmentId: 'test-road' };
  assert.equal(validate([verified]).status, 'BLOCKED');
  assert.equal(validate([verified], selectedCodes, [[b, a]]).status, 'SAFE');
  assert.equal(validate([{ ...verified, roadSegmentId: 'parallel-road' }]).status, 'SAFE');
  assert.equal(validate([{ ...verified, role: 'SUPPLEMENTARY' }]).status, 'BLOCKED');
});
test('selected 4002 requires no vehicle profile and unselected codes do not produce conflicts', () => {
  const weight = { ...sign, signCode: '4002', role: 'SUPPLEMENTARY', bearing: 90, bearingConvention: 'TRAVEL_DIRECTION' };
  assert.equal(validate([weight], ['4002']).status, 'BLOCKED');
  const other = { ...sign, id: 'far', latitude: 1.4 };
  assert.equal(validate([weight, other], ['1011']).status, 'SAFE');
});
test('empty selection and missing geometry cannot report safe; far selected signs are ignored', () => {
  assert.equal(validate([sign], []).status, 'WARNING');
  assert.equal(validate([sign], selectedCodes, [], 'MISSING').status, 'WARNING');
  assert.equal(validate([sign], selectedCodes, [[a, b]], 'OVERVIEW').status, 'WARNING');
  assert.equal(validate([{ ...sign, latitude: 1.33 }]).status, 'SAFE');
});
test('step extraction does not silently approve missing legs or join disconnected steps', () => {
  const result = engine.extractGeometry({ routes: [{ legs: [{ steps: [{ path: [a, b] }, { path: [b, a] }] }] }] });
  assert.equal(result.quality, 'STEPS'); assert.equal(result.paths.length, 2);
  assert.equal(engine.extractGeometry({ routes: [{ legs: [{ steps: [] }] }] }).quality, 'INCOMPLETE');
});
