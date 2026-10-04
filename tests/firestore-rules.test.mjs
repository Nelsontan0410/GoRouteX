import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('driver tracking points are bound to their parent session route', () => {
  const points = rules.slice(rules.indexOf('match /points/{pointId}'), rules.indexOf('match /drivers/{driverId}'));
  assert.match(points, /request\.resource\.data\.routeId == getAfter\(.*tracking_sessions\/\$\(sessionId\)\)\.data\.routeId/);
});
