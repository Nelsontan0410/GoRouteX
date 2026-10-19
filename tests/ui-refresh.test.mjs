import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = read('app.html');

test('the design layer loads last on every workspace page', () => {
  for (const page of ['app.html', 'order-hub.html', 'dispatch.html', 'settings.html']) {
    const html = read(page);
    const head = html.slice(0, html.indexOf('</head>'));
    const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(sheets.at(-1), 'styles/ui-refresh.css', page);
  }
});

test('Stops Selection keeps its controls and adds the phone tabs, filters and sticky action bar', () => {
  const page = app.slice(app.indexOf('<div id="page-select-stops"'), app.indexOf('<div id="page-manual-assign"'));
  for (const id of ['searchCustomerInput', 'selectedListDisplay', 'clearSelectedStopsBtn', 'goToManualAssignBtn', 'ssSummaryBtn', 'ssSelectedCount']) assert.match(page, new RegExp(`id="${id}"`), id);
  assert.match(page, /data-ss-tab="available"[\s\S]*data-ss-tab="selected"/);
  assert.match(page, /data-phone-filter="phone"[\s\S]*data-phone-filter="nophone"/);
  assert.match(app, /function removeSelectedStop\(customerId\)/);
  assert.match(app, /stopPhoneFilter === 'phone' \? hasPhone/);
});

test('Review & Assign adds chips and group tabs without touching the planning lists', () => {
  const page = app.slice(app.indexOf('<div id="page-manual-assign"'), app.indexOf('<div id="planningRouteCompatibility"'));
  assert.match(page, /id="raChips"/);
  assert.match(page, /id="raTabs"[\s\S]*id="stop-assignment-lists-container"/);
  for (const id of ['confirmRouteBtn', 'retrieveStopsBtn', 'backToSelectStopsBtnPg2', 'unassignedStopsList', 'routesSection', 'map']) assert.match(page, new RegExp(`id="${id}"`), id);
  const ui = read('planning/review-assign-ui.js');
  assert.doesNotMatch(ui, /fetch\(|firebase|localStorage|sessionStorage/, 'presentation only');
  assert.match(app, /<script src="planning\/review-assign-ui\.js"><\/script>/);
});

test('Order Hub validation panel counts the stored review reasons; Dispatch shows plan KPI cards', () => {
  const hub = read('orders/order-hub.js');
  assert.match(hub, /function renderValidation\(\)/);
  assert.match(hub, /order\.validationIssues\?\.length\?order\.validationIssues/);
  assert.match(read('dispatch/dispatch-board.js'), /function renderKpis\(context\)/);
});

test('GPS tracking is not reachable: no More entry, no aliases, links land on the dashboard', () => {
  assert.doesNotMatch(app, /data-more-pages|GPS Tracking<|tracking: 'page-gps-tracking'|gps: 'page-gps-tracking'/);
  assert.match(app, /if \(normalized === 'page-gps-tracking'\) return 'page-history-dashboard';/);
  assert.doesNotMatch(read('app-sidebar.js'), /GPS|morePages/);
});
