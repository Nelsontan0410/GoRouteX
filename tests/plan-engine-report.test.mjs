import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseShadow, summariseCalibration, ROLLOUT_GATE } from '../scripts/lib/plan-engine-report.mjs';

const row = (engine, baseline) => ({ engine: { routes: 2, travel: 6000, waiting: 600, duration: 20000, violations: 0, unassigned: 0, ...engine }, baseline: { routes: 2, travel: 6000, waiting: 3600, duration: 23000, violations: 1, unassigned: 0, ...baseline } });

test('rollout gate: enough comparisons, violations no worse in 95%, total time not longer', () => {
  const good = Array.from({ length: ROLLOUT_GATE.minComparisons }, () => row({}, {}));
  const s = summariseShadow(good);
  assert.equal(s.readyForRollout, true);
  assert.equal(s.violations.fewerShare, 1);
  assert.ok(s.totalMinutes.change < 0);
  assert.equal(summariseShadow(good.slice(1)).readyForRollout, false, 'too few');
  const worse = good.map((r, i) => (i < 5 ? row({ violations: 3 }, {}) : r));
  assert.equal(summariseShadow(worse).readyForRollout, false, '10% worse on violations');
  const longer = good.map(() => row({ duration: 30000 }, {}));
  assert.equal(summariseShadow(longer).readyForRollout, false, 'longer total time');
});

test('calibration: median Google/network ratio overall and by time band, after 30 legs; edit rates by source', () => {
  const records = [
    ...Array.from({ length: 20 }, () => ({ hour: 8, legs: [{ google: 1200, network: 1000 }] })),
    ...Array.from({ length: 20 }, () => ({ hour: 13, legs: [{ google: 1000, network: 1000 }], edits: { source: 'plan-engine', unchanged: true, moved: 0, reordered: 0 } })),
    { hour: 13, legs: [], edits: { source: 'google', unchanged: false, moved: 2, reordered: 1 } }
  ];
  const c = summariseCalibration(records);
  assert.equal(c.legs, 40);
  assert.equal(c.recommendedDurationFactor, 1.1);
  assert.deepEqual(c.bands.map((b) => [b.band, b.factor]), [['before 09:00', 1.2], ['12:00-15:00', 1]]);
  assert.equal(c.planEdits['plan-engine'].unchangedShare, 1);
  assert.equal(c.planEdits.google.moved, 2);
  assert.equal(summariseCalibration(records.slice(0, 10)).recommendedDurationFactor, null, 'needs 30 legs');
});
