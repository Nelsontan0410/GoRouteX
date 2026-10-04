import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = read('app.html');
const dashboard = read('dashboard/dashboard-page.js');
const css = read('app-experience.css');

test('the dashboard no longer shows route history inline; the panel stays in the DOM, hidden', () => {
  assert.match(app, /<section id="historyStatsPanel"[^>]*\shidden>/);
  assert.match(css, /#historyStatsPanel\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  // Elements other code still reads must exist, so nothing throws on a missing node.
  for (const id of ['totalRoutesCount', 'todayRoutesCount', 'totalStopsCount', 'avgStopsPerRoute', 'browseFullHistoryBtn', 'historyList']) {
    assert.match(app, new RegExp(`id="${id}"`), id);
  }
});

test('the hero offers Browse History and no longer a Load Route that needs an inline selection', () => {
  const hero = app.slice(app.indexOf('class="dashboard-primary-actions"'), app.indexOf('</section>', app.indexOf('class="dashboard-primary-actions"')));
  assert.match(hero, /id="dashboardBrowseHistoryBtn"[^>]*>Browse History</);
  assert.match(hero, /id="loadSelectedRouteBtn"[^>]*\shidden>/);
});

test('Browse History opens the history browser page, which loads history if it is not ready yet', () => {
  assert.match(dashboard, /dashboardBrowseHistoryBtn\.addEventListener\('click', \(\) => \{\s*renderHistoryBrowserList\(\);\s*showPage\('page-history-browser'\);/);
  assert.match(app, /pageId === 'page-history-browser'\) \{\s*renderHistoryBrowserList\(\);\s*loadHistoryOnce\(\)\.then\(renderHistoryBrowserList\)/);
});

test('history still starts loading in the background as soon as the dashboard opens', () => {
  assert.match(app, /pageId === 'page-history-dashboard'\) \{\s*renderHistoryDashboard\(\);\s*loadDashboardData\(\)/);
  assert.match(dashboard, /loadHistoryOnce\(options\),/);
});
