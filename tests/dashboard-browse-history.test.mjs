import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = read('app.html');
const dashboard = read('dashboard/dashboard-page.js');
const css = read('app-experience.css');

test('history still starts loading in the background as soon as the dashboard opens', () => {
  assert.match(app, /pageId === 'page-history-dashboard'\) \{\s*renderHistoryDashboard\(\);\s*loadDashboardData\(\)/);
  assert.match(dashboard, /loadHistoryOnce\(options\),/);
});

test('history pages are small: first page 5, Load More 10', () => {
  assert.match(app, /const HISTORY_PAGE_SIZE = 5;/);
  assert.match(app, /const HISTORY_LOAD_MORE_SIZE = 10;/);
  assert.match(app, /const pageSize = options\.loadMore === true \? HISTORY_LOAD_MORE_SIZE : HISTORY_PAGE_SIZE;\s*const result = await window\.RoutePlannerStorage\.loadHistory\(\{\s*limit: pageSize,\s*pageSize,/);
});
