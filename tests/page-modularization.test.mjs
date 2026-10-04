import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const paths = ['dashboard/dashboard-page.js', 'history/route-history-page.js', 'planning/planning-page.js'];
const sources = paths.map(path => readFileSync(new URL('../' + path, import.meta.url), 'utf8'));

test('page scripts install without accessing state, binding events or starting requests', () => {
  // Intentionally no DOM, Firebase, timers or state: evaluating declarations must be inert.
  const context = vm.createContext({});
  sources.forEach(source => vm.runInContext(source, context));
  assert.equal(typeof context.loadDashboardData, 'function');
  assert.equal(typeof context.loadSelectedRoute, 'function');
  assert.equal(typeof context.bindPlanningPageControls, 'function');
});

test('dashboard entry and mount share pending history and summary work', async () => {
  let history = 0, summary = 0;
  const context = vm.createContext({
    dashboardDataPromise: null,
    getCurrentActivePageId: () => 'page-history-dashboard',
    loadHistoryOnce: async () => { history++; },
    window: { FirebaseApp: { gps: { loadSummary: async () => { summary++; return { success: true, summary: null }; } } } },
    console
  });
  vm.runInContext(sources[0], context);
  context.renderDashboardOperationalSummary = () => {};
  const first = context.loadDashboardData();
  const second = context.loadDashboardData();
  assert.equal(first, second);
  await first;
  await context.loadDashboardData();
  assert.deepEqual({ history, summary }, { history: 1, summary: 1 });
  context.getCurrentActivePageId = () => 'page-select-stops';
  await context.loadDashboardData({ forceRefresh: true });
  assert.deepEqual({ history, summary }, { history: 1, summary: 1 });
});

test('history selection opens the persisted ID without fetching or saving a route', () => {
  const opened = [];
  const context = vm.createContext({ routeHistory: [{ id: 'saved_123' }], selectedHistoryIndex: 0,
    openDispatchPage: id => opened.push(id), showToast() {} });
  vm.runInContext(sources[1], context);
  context.loadSelectedRoute();
  assert.deepEqual(opened, ['saved_123']);
  context.selectedHistoryIndex = -1;
  context.loadSelectedRoute();
  assert.deepEqual(opened, ['saved_123']);
});

test('classic scripts do not both declare the global loadSessionFromCloud', async () => {
  const { readFileSync } = await import('node:fs');
  const firebaseConfig = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8');
  assert.doesNotMatch(firebaseConfig, /function loadSessionFromCloud\(/);
  assert.match(firebaseConfig, /loadSession: loadSelectionSessionFromCloud,/);
});

test('dashboard startup steps are timed and reported once history renders', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const marks = [...[read('firebase-config.js'), read('route-storage.js'), read('app.html')].join('\n').matchAll(/GoRouteXTiming\??\.mark\('([a-z-]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(marks)].sort(), ['auth-ready', 'history-rendered', 'history-request', 'history-response', 'profile-ready', 'storage-resolved']);
  assert.match(read('app.html'), /GoRouteXTiming\?\.report\(\)/);
});
