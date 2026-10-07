import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlanInsights, plannedEtaMs } from '../netlify/functions/_shared/plan-insights.js';

const at = (hhmm) => `2026-10-05T${hhmm}:00+08:00`;
const iso = (hhmm) => new Date(at(hhmm)).toISOString();
const stop = (id, eta, arrive, done, status = 'DELIVERED') => ({ savedStopId: id, stopName: `Shop ${id}`, plannedEta: eta, actualArrivalAt: iso(arrive), actualCompletedAt: done ? iso(done) : null, executionStatus: status });

test('planned ETAs are read as Singapore time on the route date', () => {
  assert.equal(plannedEtaMs('2026-10-05', '9:05 AM'), Date.parse('2026-10-05T01:05:00Z'));
  assert.equal(plannedEtaMs('2026-10-05', '12:30 PM'), Date.parse('2026-10-05T04:30:00Z'));
  assert.equal(plannedEtaMs('2026-10-05', '12:10 AM'), Date.parse('2026-10-04T16:10:00Z'));
  assert.equal(plannedEtaMs('2026-10-05', '13:05'), Date.parse('2026-10-05T05:05:00Z'));
  assert.equal(plannedEtaMs('bad', '9:05 AM'), null);
});

test('ETA accuracy and actual service time from completed stops; pending stops ignored', () => {
  const executions = [{ routeDate: '2026-10-05', stops: [
    stop('a', '9:00 AM', '09:10', '09:40'),
    stop('b', '10:00 AM', '09:50', '10:05'),
    stop('c', '11:00 AM', '11:30', null, 'FAILED'),
    { ...stop('d', '12:00 PM', '12:00', '12:10'), executionStatus: 'PENDING' }
  ] }];
  const r = computePlanInsights(executions, { defaultServiceMinutes: 15 });
  assert.equal(r.completedStops, 3);
  assert.equal(r.eta.samples, 3);
  assert.equal(r.eta.p50AbsMinutes, 10);
  assert.equal(r.eta.medianErrorMinutes, 10);
  assert.equal(r.eta.within15MinutesShare, 66.7);
  assert.equal(r.service.samples, 2, 'failed stops have no service time');
  assert.equal(r.service.medianMinutes, 30, 'upper median of 30 and 15');
});

test('a customer is suggested a custom service time after 5 visits that differ from the default by 5+ min', () => {
  const visits = (id, minutes, count) => Array.from({ length: count }, () => stop(id, '9:00 AM', '09:00', `09:${String(minutes).padStart(2, '0')}`));
  const r = computePlanInsights([{ routeDate: '2026-10-05', stops: [...visits('slow', 35, 5), ...visits('normal', 16, 5), ...visits('rare', 50, 4)] }], { defaultServiceMinutes: 15 });
  assert.deepEqual(r.customerSuggestions.map((s) => [s.id, s.suggestedServiceMinutes]), [['slow', 35]]);
  assert.equal(r.service.suggestedDefaultMinutes, null, 'fewer than 20 samples: no default change suggested');
});

test('no executions yet gives an empty, valid report', () => {
  const r = computePlanInsights([], {});
  assert.equal(r.routes, 0);
  assert.equal(r.eta.p50AbsMinutes, null);
  assert.deepEqual(r.customerSuggestions, []);
});

test('Settings shows planned vs actual in Route Planning Defaults, loaded when the section opens', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../settings/settings-page.js', import.meta.url), 'utf8');
  const section = html.split('id="section-routePlanning"')[1].split('</section>')[0];
  assert.match(section, /<h3>Planned vs actual<\/h3>/);
  assert.match(section, /id="planInsights"/);
  assert.match(page, /if \(section === 'routePlanning'\) loadPlanInsights\(\);/);
  assert.match(page, /fetch\('\/\.netlify\/functions\/plan-insights'/);
  assert.doesNotMatch(page.slice(page.indexOf('function renderPlanInsights')), /innerHTML/, 'rendered with textContent only');
  const fn = readFileSync(new URL('../netlify/functions/plan-insights.js', import.meta.url), 'utf8');
  assert.match(fn, /requireOwner\(user, profile\)/);
});
