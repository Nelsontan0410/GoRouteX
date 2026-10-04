import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

test('route suggestion names are escaped before reaching innerHTML', () => {
  assert.match(app, /messageBarPg2\.innerHTML = `[^`]*\$\{escapeHtml\(suggestionText\)\}/);
  assert.doesNotMatch(app, /innerHTML = `[^`]*\$\{suggestionText\}/);
});

test('route suggestion does not log customer addresses on the normal path', () => {
  const body = app.slice(app.indexOf('async function showOptimizedRouteSuggestion()'), app.indexOf('// Manual trigger function for debugging'));
  assert.doesNotMatch(body, /console\.log\("  (Origin|Destination|Waypoints):"/);
  assert.doesNotMatch(body, /WAYPOINT - /);
});
