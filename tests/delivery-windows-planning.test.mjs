import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const finalization = readFileSync(new URL('../planning/route-finalization.js', import.meta.url), 'utf8');
const etaSource = app.slice(app.indexOf('function generateTimeListAndShowOnPage3Legacy('), app.indexOf('function generateTimeListAndShowOnPage3(...args)'));
const rulesContext = vm.createContext({});
vm.runInContext(readFileSync(new URL('../delivery-constraints.js', import.meta.url), 'utf8'), rulesContext);
const C = rulesContext.GoRouteXDeliveryConstraints;
const hhmm = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

// Run the real ETA function for one route: origin -> customers... -> end, with leg minutes and a 20-minute service.
function runEta({ start, legMinutes, customers, constraintsFor = () => C.resolveCustomerConstraints({}, { routePlanning: { serviceMinutes: 20 } }) }) {
  const route = {
    id: 1,
    directionsResult: { routes: [{ legs: legMinutes.map((m) => ({ duration: { value: m * 60 } })) }] },
    optimizedStops: ['origin', ...customers, 'end']
  };
  let html = '';
  const ctx = vm.createContext({
    window: { GoRouteXDeliveryConstraints: C },
    AppState: { plannedRoutes: [route] },
    getRouteStartDateTime: () => new Date(start.getTime()),
    timeListDisplayPage3Div: {}, schedulePreviewPage3Div: { style: {} },
    manualRoute1Waypoints: [], manualRoute2Waypoints: [],
    formatTime12Hour: (d) => hhmm(d), getStopDisplayName: (id) => id, getAddressForMapsUrl: (id) => `addr-${id}`,
    truncateText: (s) => s, isRouteConfiguredEndStop: (_r, id) => id === 'end', getRouteStopStayMinutes: () => 20,
    getRouteFinalArrivalLabel: () => 'Return', renderSchedulePreviewPages: (blocks) => { html = blocks.map((b) => b.html).join(''); },
    printSummaryPage3() {}, appLog() {}, escapeHtml: (s) => String(s), getCustomerDeliveryConstraints: constraintsFor, console
  });
  vm.runInContext(`${etaSource}\nthis.run = generateTimeListAndShowOnPage3Legacy;`, ctx);
  const result = ctx.run({ print: false });
  return { route, result, html, stop: (id) => route.detailedStopTimes.find((s) => s.stopId === id) };
}

test('arriving at 12:30 during the 12:00–13:00 break waits until 13:00 before the 20-minute service', () => {
  const { stop, result } = runEta({ start: new Date(2026, 9, 5, 12, 0), legMinutes: [30, 10, 15], customers: ['c1', 'c2'] });
  const c1 = stop('c1');
  assert.equal(c1.arrivalTimeStr, '12:30');
  assert.equal(c1.waitMinutes, 30);
  assert.equal(c1.serviceStartTimeStr, '13:00');
  assert.equal(c1.departureTimeStr, '13:20');
  assert.equal(stop('c2').arrivalTimeStr, '13:30', 'the next leg starts after the delayed service');
  assert.equal(result.timeWindowViolations.length, 0);
});

test('arriving at 11:50 cannot start a 20-minute service that would cross noon; it starts at 13:00', () => {
  const { stop } = runEta({ start: new Date(2026, 9, 5, 11, 30), legMinutes: [20, 10, 15], customers: ['c1', 'c2'] });
  assert.equal(stop('c1').arrivalTimeStr, '11:50');
  assert.equal(stop('c1').serviceStartTimeStr, '13:00');
});

test('a closed weekend produces a visible violation with customer, ETA, window and reason', () => {
  const { result, html, stop } = runEta({ start: new Date(2026, 9, 10, 9, 0), legMinutes: [20, 15], customers: ['c1'] });
  assert.equal(result.timeWindowViolations.length, 1);
  const v = result.timeWindowViolations[0];
  assert.equal(v.customer, 'c1');
  assert.equal(v.eta, '09:20');
  assert.equal(v.receiving, 'closed');
  assert.equal(v.reason, 'closed');
  assert.equal(stop('c1').windowStatus, 'violation');
  assert.match(html, /Outside delivery hours/);
});

test('each stop keeps a snapshot of the rules it was planned against', () => {
  const custom = C.defaultSchedule();
  custom.monday = { open: true, windows: [{ start: '07:00', end: '10:00' }], breaks: [] };
  const { stop } = runEta({
    start: new Date(2026, 9, 5, 8, 0), legMinutes: [15, 15], customers: ['c1'],
    constraintsFor: () => C.resolveCustomerConstraints({ deliveryScheduleMode: 'custom', customDeliverySchedule: custom, serviceTimeMode: 'custom', customServiceMinutes: 20 }, { routePlanning: { serviceMinutes: 15 } })
  });
  assert.deepEqual(JSON.parse(JSON.stringify(stop('c1').deliveryConstraints)), { day: 'monday', receiving: '07:00–10:00', scheduleMode: 'custom', serviceMode: 'custom', serviceMinutes: 20 });
});

test('the fixed 12:00-13:00 jump is gone; breaks now come from each customer schedule', () => {
  assert.doesNotMatch(etaSource, /LUNCH_START_HOUR|applyLunchBreakIfNeeded/);
});

// ---- Confirmation gate ----
function gate({ violations, decision }) {
  const saved = [];
  let toast = '';
  const ctx = vm.createContext({
    AppState: {}, window: { FirebaseApp: { auth: { getCurrentUser: () => ({ uid: 'u1', displayName: 'Planner One' }) } } },
    document: { getElementById: () => null }, messageBarPg2: {}, console: { info() {} },
    showToast: (m) => { toast = m; }, showPage: async () => {}, escapeHtml: (s) => String(s)
  });
  vm.runInContext(`${finalization}\nthis.enforce = enforceDeliveryWindows; this.setModal = (fn) => { openTimeWindowExceptionModal = fn; };`, ctx);
  ctx.setModal(async () => decision);
  return { ctx, run: () => ctx.enforce({ timeWindowViolations: violations }), saved, toast: () => toast };
}
const violation = { routeId: 1, stopId: 'c1', customer: 'Shop', eta: '18:20', receiving: '09:00–18:00', reason: 'after-hours', message: 'too late' };

test('no violations: confirmation proceeds without a dialog or override', async () => {
  const { ctx, run } = gate({ violations: [], decision: null });
  assert.equal((await run()).proceed, true);
  assert.equal(ctx.AppState.timeWindowOverride, null);
});

test('violations block saving unless the planner overrides; the choice to adjust keeps the plan unsaved', async () => {
  const adjust = gate({ violations: [violation], decision: { action: 'adjust' } });
  assert.equal((await adjust.run()).proceed, false);
  assert.match(adjust.ctx.messageBarPg2.textContent, /outside customer delivery hours/);
  const change = gate({ violations: [violation], decision: { action: 'change-start' } });
  assert.equal((await change.run()).proceed, false);
});

test('an explicit override records actor and reason with the violations', async () => {
  const { ctx, run } = gate({ violations: [violation], decision: { action: 'override', reason: 'Customer agreed to 18:30' } });
  assert.equal((await run()).proceed, true);
  const record = JSON.parse(JSON.stringify(ctx.AppState.timeWindowOverride));
  assert.equal(record.actorUid, 'u1');
  assert.equal(record.actorName, 'Planner One');
  assert.equal(record.reason, 'Customer agreed to 18:30');
  assert.equal(record.violations[0].customer, 'Shop');
  assert.ok(record.at);
});

test('the confirm flow checks windows after ETA and before saving, and saves the override with the plan', () => {
  const flow = finalization.slice(finalization.indexOf('async function handleProceedToOptimizeRoutes('));
  const eta = flow.indexOf('generateTimeListAndShowOnPage3Legacy');
  const check = flow.indexOf('enforceDeliveryWindows(etaResult)');
  const save = flow.indexOf('savePlannedRoutes(');
  assert.ok(eta < check && check < save);
  assert.match(flow, /if \(!windowCheck\.proceed\) \{[\s\S]*?return \{ success: false, blocked: 'delivery-windows' \};/);
  const persistence = readFileSync(new URL('../planning/planning-persistence.js', import.meta.url), 'utf8');
  assert.match(persistence, /timeWindowOverride: AppState\.timeWindowOverride \|\| null,/);
  assert.match(app, /<div id="timeWindowExceptionModal" hidden>/);
  for (const id of ['timeWindowChangeStartBtn', 'timeWindowAdjustRoutesBtn', 'timeWindowOverrideBtn', 'timeWindowOverrideReason']) assert.match(app, new RegExp(`id="${id}"`));
});

test('Google-optimised routes pass through the delivery-window ordering before assignment', () => {
  const generator = app.slice(app.indexOf('async function generateOptimizedActiveRoutesFromSelection('), app.indexOf('validatePackedActiveRoutes(window._activeRoutes, maxPerRoute);', app.indexOf('async function generateOptimizedActiveRoutesFromSelection(')));
  assert.ok(generator.indexOf('splitOptimizedStopsIntoPackedRoutes(optimizedStops') < generator.indexOf('packedRoutes = applyDeliveryWindowsToPackedRoutes(packedRoutes, result);'));
  const order = ['delivery-constraints.js', 'delivery-schedule-editor.js', 'customer-constraints-form.js', 'route-time-windows.js'].map((f) => app.indexOf(`<script src="${f}"></script>`));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), 'scripts load in dependency order');
  assert.match(readFileSync(new URL('../planning/manual-assignment-page.js', import.meta.url), 'utf8'), /window\._timeWindowPlanningNotice/);
});
