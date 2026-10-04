import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const historyPage = readFileSync(new URL('../history/route-history-page.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../dashboard/dashboard-page.js', import.meta.url), 'utf8');

function pending(state) {
  const fn = app.slice(app.indexOf('function isRouteHistoryPending()'), app.indexOf('function setRouteHistoryLoading('));
  return vm.runInNewContext(`${fn}; isRouteHistoryPending()`, state);
}

test('history counts as pending before the first load starts and while it runs', () => {
  assert.equal(pending({ isRouteHistoryLoading: false, routeHistoryLoadState: 'idle', routeHistory: [] }), true, 'idle: auth/profile still resolving');
  assert.equal(pending({ isRouteHistoryLoading: true, routeHistoryLoadState: 'loading', routeHistory: [] }), true);
  assert.equal(pending({ isRouteHistoryLoading: false, routeHistoryLoadState: 'empty', routeHistory: [] }), false, 'a real empty answer shows the empty state');
  assert.equal(pending({ isRouteHistoryLoading: true, routeHistoryLoadState: 'loading', routeHistory: [{}] }), false, 'refresh keeps showing existing rows');
});

test('dashboard, list and browser all use the pending check before the empty state', () => {
  const list = historyPage.slice(historyPage.indexOf('function renderHistoryList()'));
  assert.ok(list.indexOf('isRouteHistoryPending()') < list.indexOf("'No Route History Found'"));
  assert.match(dashboard, /if \(isRouteHistoryPending\(\)\) \{\s*setHistoryStatsPlaceholderValues\(\);/);
  assert.doesNotMatch(historyPage + dashboard, /isRouteHistoryLoading && routeHistory\.length === 0/);
});

test('loading markup is a skeleton, never the empty-state text', () => {
  const markup = vm.runInNewContext(`${historyPage.slice(historyPage.indexOf('function createHistoryLoadingMarkup()'), historyPage.indexOf('function updateHistorySelectionButtons()'))}; createHistoryLoadingMarkup()`);
  assert.match(markup, /history-skeleton/);
  assert.doesNotMatch(markup, /No Data|No Route History/);
  assert.equal((markup.match(/history-skeleton-row/g) || []).length, 3);
});
