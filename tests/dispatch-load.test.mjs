import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Safari uses forced long polling so a broken streaming channel cannot stall reads', () => {
  const config = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8');
  assert.match(config, /if \(_isSafariEngine\) \{\s*db\.settings\(\{ experimentalForceLongPolling: true, merge: true \}\);/);
  assert.doesNotMatch(config, /experimentalAutoDetectLongPolling/);
});

test('Dispatch retries a timed-out plan read once and then offers Retry', () => {
  const page = readFileSync(new URL('../dispatch/dispatch-page.js', import.meta.url), 'utf8');
  assert.match(page, /if \(error\?\.code !== 'timeout' \|\| request !== generation\) throw error;\s*showState\('Still loading the plan, retrying…'\);\s*return withDeadline\(readPlan\(explicit\)\);/);
  assert.match(page, /showState\(`Unable to load Dispatch\. \$\{error\.message \|\| ''\}`, true, true, true\)/);
  assert.match(page, /retry\.addEventListener\('click', \(\) => \{ const user = auth\?\.getCurrentUser\?\.\(\); if \(user\) restorePlan\(user\); \}\);/);
});
