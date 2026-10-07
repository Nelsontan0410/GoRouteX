// Summarises Plan Engine shadow comparisons and calibration samples into a rollout decision.

export const ROLLOUT_GATE = Object.freeze({ minComparisons: 50, minNoWorseViolationsShare: 0.95, maxDurationIncreaseShare: 0.0 });
const HOUR_BANDS = [[0, 9, 'before 09:00'], [9, 12, '09:00-12:00'], [12, 15, '12:00-15:00'], [15, 18, '15:00-18:00'], [18, 24, 'after 18:00']];

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round = (n, digits = 2) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits);
const sum = (values) => values.reduce((a, b) => a + b, 0);

export function summariseShadow(records) {
  const rows = (records || []).filter((r) => r?.engine && r?.baseline);
  const n = rows.length;
  const noWorseViolations = rows.filter((r) => r.engine.violations + (r.engine.unassigned || 0) <= r.baseline.violations + (r.baseline.unassigned || 0)).length;
  const fewerViolations = rows.filter((r) => r.engine.violations + (r.engine.unassigned || 0) < r.baseline.violations + (r.baseline.unassigned || 0)).length;
  const minutes = (key, side) => sum(rows.map((r) => r[side][key] || 0)) / 60;
  const durationChange = n ? (minutes('duration', 'engine') - minutes('duration', 'baseline')) / Math.max(1, minutes('duration', 'baseline')) : null;
  const ready = n >= ROLLOUT_GATE.minComparisons
    && noWorseViolations / n >= ROLLOUT_GATE.minNoWorseViolationsShare
    && durationChange !== null && durationChange <= ROLLOUT_GATE.maxDurationIncreaseShare;
  return {
    comparisons: n,
    violations: { engine: sum(rows.map((r) => r.engine.violations || 0)), baseline: sum(rows.map((r) => r.baseline.violations || 0)), noWorseShare: n ? round(noWorseViolations / n, 3) : null, fewerShare: n ? round(fewerViolations / n, 3) : null },
    unassignedByEngine: sum(rows.map((r) => r.engine.unassigned || 0)),
    totalMinutes: { engine: round(minutes('duration', 'engine'), 0), baseline: round(minutes('duration', 'baseline'), 0), change: round(durationChange, 3) },
    travelMinutes: { engine: round(minutes('travel', 'engine'), 0), baseline: round(minutes('travel', 'baseline'), 0) },
    waitingMinutes: { engine: round(minutes('waiting', 'engine'), 0), baseline: round(minutes('waiting', 'baseline'), 0) },
    routes: { engine: sum(rows.map((r) => r.engine.routes || 0)), baseline: sum(rows.map((r) => r.baseline.routes || 0)) },
    readyForRollout: ready,
    gate: ROLLOUT_GATE
  };
}

/** Travel-time correction: Google-confirmed leg durations / road-network durations, overall and per time band. */
export function summariseCalibration(records) {
  const legs = [];
  const edits = [];
  for (const record of records || []) {
    for (const leg of record?.legs || []) if (leg.google > 0 && leg.network > 0) legs.push({ hour: record.hour, ratio: leg.google / leg.network });
    if (record?.edits) edits.push(record.edits);
  }
  const bands = HOUR_BANDS.map(([from, to, label]) => {
    const ratios = legs.filter((l) => l.hour >= from && l.hour < to).map((l) => l.ratio);
    return { band: label, samples: ratios.length, factor: round(median(ratios)) };
  }).filter((b) => b.samples);
  const bySource = {};
  for (const e of edits) {
    const s = (bySource[e.source] = bySource[e.source] || { plans: 0, unchanged: 0, moved: 0, reordered: 0 });
    s.plans++;
    if (e.unchanged) s.unchanged++;
    s.moved += e.moved || 0;
    s.reordered += e.reordered || 0;
  }
  for (const s of Object.values(bySource)) s.unchangedShare = round(s.unchanged / s.plans, 3);
  return {
    legs: legs.length,
    recommendedDurationFactor: legs.length >= 30 ? round(median(legs.map((l) => l.ratio))) : null,
    bands,
    planEdits: bySource
  };
}
