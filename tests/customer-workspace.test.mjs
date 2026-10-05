import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = read('app.html');
const page = app.slice(app.indexOf('<div id="page-add-stop"'), app.indexOf('<div class="add-stop-map-panel"'));

test('master-data labels say Customer Workspace / Add Customer / Search Customers', () => {
  assert.match(page, /<div class="add-stop-title">Customer Workspace<\/div>/);
  assert.match(page, /data-stop-workspace-mode="add"[^>]*>Add Customer</);
  assert.match(page, /<h3 id="addStopCreateHeading">Add Customer<\/h3>/);
  assert.match(page, /<h3>Search Customers<\/h3>/);
  assert.match(page, />Add Customer<\/button>/);
  for (const text of ['Import customers from your spreadsheet', 'Add your customer list', 'When a matching customer already exists', 'Export customers', 'Delete all customers']) assert.ok(page.includes(text), text);
  for (const old of ['Stop workspace', 'Add New Stop', 'Search Saved Stops', 'Export saved stops', 'Delete all stops']) assert.ok(!page.includes(old), old);
  assert.match(app, /createHeading\.textContent = isEditing \? 'Edit Customer' : 'Add Customer'/);
});

test('route-stop terminology in planning is not renamed', () => {
  const selection = app.slice(app.indexOf('<div id="page-select-stops"'), app.indexOf('<button id="goToManualAssignBtn"'));
  assert.match(selection, /<h2>Stops Selection<\/h2>/);
  assert.match(selection, /id="selectionAddCustomerBtn"[^>]*>Add Stop</);
  assert.match(selection, /Selected Stops/);
});

test('Customer Workspace keeps Back and drops the duplicate Dashboard shortcut; old links still open it', () => {
  const header = page.slice(0, page.indexOf('add-stop-container'));
  assert.match(header, /goBackToPreviousPage\(\)">Back</);
  assert.doesNotMatch(header, />Dashboard</);
  assert.match(app, /'customer-workspace': 'page-add-stop'/);
});

test('search type and search terms stack vertically at full width inside the panel', () => {
  const css = read('styles/master-search.css');
  assert.match(css, /#masterSearchForm\.master-search-controls \{ display:flex; flex-direction:column;[^}]*max-width:100%;[^}]*box-sizing:border-box;/);
  assert.match(css, /#masterSearchType, #manageStopsSearchInput \{ display:block; width:100%; max-width:100%; min-width:0;[^}]*box-sizing:border-box;/);
  assert.doesNotMatch(css, /grid-template-columns: 150px/);
  const form = page.slice(page.indexOf('<form id="masterSearchForm"'), page.indexOf('</form>', page.indexOf('<form id="masterSearchForm"')));
  assert.ok(form.indexOf('for="masterSearchType"') < form.indexOf('id="masterSearchType"'), 'label above select');
  assert.ok(form.indexOf('for="manageStopsSearchInput"') < form.indexOf('id="manageStopsSearchInput"'), 'label above input');
  for (const option of ['customer', 'contact', 'phone', 'address']) assert.match(form, new RegExp(`<option value="${option}">`));
});

test('the customer form shows Delivery Availability and Service Time with default/custom and Return to default', () => {
  for (const id of ['customerDeliveryAvailability', 'deliveryScheduleSummary', 'customDeliverySchedule', 'resetDeliveryScheduleBtn', 'customerServiceTime', 'serviceTimeSummary', 'customServiceMinutes', 'resetServiceTimeBtn', 'customerConstraintErrors']) {
    assert.match(page, new RegExp(`id="${id}"`), id);
  }
  assert.match(page, /name="deliveryScheduleMode" value="default" checked/);
  assert.match(page, /name="serviceTimeMode" value="default" checked/);
  assert.equal((page.match(/>Return to default</g) || []).length, 2);
  for (const script of ['delivery-constraints.js', 'delivery-schedule-editor.js', 'customer-constraints-form.js']) assert.match(app, new RegExp(`<script src="${script}"></script>`));
});

test('saving, editing and clearing a customer carry the override fields; invalid overrides block the save', () => {
  assert.match(app, /const constraints = window\.GoRouteXCustomerConstraints\?\.read\(\)/);
  assert.match(app, /\.\.\.\(constraints\.fields \|\| \{\}\),/);
  assert.match(app, /if \(stopData\.constraintErrors\?\.length\) \{[\s\S]*?return;\s*\}\s*delete stopData\.constraintErrors;/);
  assert.match(app, /window\.GoRouteXCustomerConstraints\?\.set\(entry\);/);
  assert.match(app, /if \(form\) form\.reset\(\);\s*window\.GoRouteXCustomerConstraints\?\.set\(null\);/);
});

// ---- Storage: existing records stay default; overrides survive normalisation; default mode stores no copy ----
const source = read('firebase-config.js');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const ctx = vm.createContext({ firebase: { firestore: { Timestamp: { now: () => 'NOW' } } }, buildStableStopId: (stop) => stop.id || 'generated', normalizePhoneValue: (v) => String(v || '') });
vm.runInContext(`${slice('function pickDeliveryConstraintFields(', 'function estimateStopsBytes(')}\nthis.normalizeStop = normalizeStop; this.toLegacyCustomer = toLegacyCustomer;`, ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const custom = { monday: { open: true, windows: [{ start: '07:00', end: '11:00' }], breaks: [] } };

test('a customer saved before this release has no fields and resolves as default', () => {
  const stop = plain(ctx.normalizeStop({ id: 's1', name: 'Old Co', address: '1 Road' }));
  assert.equal(stop.deliveryScheduleMode, 'default');
  assert.equal(stop.serviceTimeMode, 'default');
  assert.equal('customDeliverySchedule' in stop, false);
  assert.equal('customServiceMinutes' in stop, false);
  assert.equal(stop.id, 's1', 'stable identifier preserved');
});

test('custom overrides survive normalisation and the legacy customer shape', () => {
  const stop = plain(ctx.normalizeStop({ id: 's2', name: 'Special', address: '2 Road', deliveryScheduleMode: 'custom', customDeliverySchedule: custom, serviceTimeMode: 'custom', customServiceMinutes: 30 }));
  assert.deepEqual(stop.customDeliverySchedule, custom);
  assert.equal(stop.customServiceMinutes, 30);
  const legacy = plain(ctx.toLegacyCustomer(stop));
  assert.equal(legacy.deliveryScheduleMode, 'custom');
  assert.equal(legacy.customServiceMinutes, 30);
});

test('Return to default (mode default) drops the stored override even when merged onto the old record', () => {
  const existing = { id: 's3', name: 'Special', address: '3 Road', deliveryScheduleMode: 'custom', customDeliverySchedule: custom, serviceTimeMode: 'custom', customServiceMinutes: 30 };
  const merged = plain(ctx.normalizeStop({ ...existing, deliveryScheduleMode: 'default', serviceTimeMode: 'default' }));
  assert.equal('customDeliverySchedule' in merged, false);
  assert.equal('customServiceMinutes' in merged, false);
});

test('partial updates (e.g. import merge) keep an existing custom override', () => {
  const existing = { id: 's4', name: 'Special', address: '4 Road', deliveryScheduleMode: 'custom', customDeliverySchedule: custom, serviceTimeMode: 'default' };
  const merged = plain(ctx.normalizeStop({ ...existing, phone: '999' }));
  assert.equal(merged.deliveryScheduleMode, 'custom');
  assert.deepEqual(merged.customDeliverySchedule, custom);
});
