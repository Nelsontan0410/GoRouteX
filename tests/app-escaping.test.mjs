import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

test('route suggestion names are escaped before reaching innerHTML', () => {
  assert.match(app, /messageBarPg2\.innerHTML = `[^`]*\$\{escapeHtml\(suggestionText\)\}/);
  assert.doesNotMatch(app, /innerHTML = `[^`]*\$\{suggestionText\}/);
});
