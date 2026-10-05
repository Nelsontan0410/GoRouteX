import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = read('app.html');
const planningPage = read('planning/planning-page.js');
const page = app.slice(app.indexOf('<div id="page-select-stops"'), app.indexOf('<button id="goToManualAssignBtn"'));
const panel = page.slice(page.indexOf('<div id="routeSettingsPanel"'), page.indexOf('<div class="stop-selector-container">'));
const visible = page.replace(panel, '');

test('the Route Settings card and its start/end/date summary are no longer shown on Stops Selection', () => {
  assert.match(panel, /class="route-settings-overlay"[^>]*hidden>/, 'only inside a panel that starts hidden');
  assert.doesNotMatch(visible, /routeSettingsSummary|Route Settings<|planningDateTime/);
  assert.match(read('app-experience.css'), /\.route-settings-overlay \.route-settings-header \{\s*display: none !important;/);
});

test('start, end and date/time inputs keep their ids, so workflow state and storage are unchanged', () => {
  for (const id of ['customOriginInput', 'customEndInput', 'planningDateTime', 'routeSettingsBody', 'routeSettingsBar', 'routeEndOptionsWrap']) {
    assert.match(panel, new RegExp(`id="${id}"`), id);
  }
  assert.match(panel, /name="routeOriginMode" value="current"/);
  assert.match(panel, /name="routeEndMode" value="same"/);
});

test('the page description sits below the title', () => {
  assert.match(visible, /<h2>Stops Selection<\/h2>\s*<p class="workspace-intro-description">Select the stops for this route, review your selection, and continue to assignment\.<\/p>/);
});

test('Dashboard shortcut removed, Back kept, Route settings opens the panel', () => {
  assert.doesNotMatch(visible, /id="backToDashboardBtn"|>Dashboard</);
  assert.match(visible, /onclick="goBackToPreviousPage\(\)"[^>]*>Back</);
  assert.match(visible, /id="openRouteSettingsBtn"[^>]*>Route settings</);
  assert.match(planningPage, /openBtn\.addEventListener\('click', open\);/);
  assert.match(planningPage, /bindRouteSettingsPanel\(\);/);
});

test('search, selected list, count, Clear Selected, Add Stop and Review & Assign controls are unchanged', () => {
  for (const id of ['searchCustomerInput', 'selectionAddCustomerBtn', 'selectedStopsBadge', 'clearSelectedStopsBtn', 'selectedListDisplay', 'stopsList']) {
    assert.match(visible, new RegExp(`id="${id}"`), id);
  }
  assert.match(app, /<button id="goToManualAssignBtn">Review & Assign Selected Stops<\/button>/);
});

test('validation that needs a start or end address opens the panel first', () => {
  assert.match(app, /window\.openRouteSettingsPanel\?\.\(\);\s*if \(customOriginInput\) customOriginInput\.focus\(\);/);
  assert.match(app, /window\.openRouteSettingsPanel\?\.\(\);\s*if \(customEndInput\) customEndInput\.focus\(\);/);
});
