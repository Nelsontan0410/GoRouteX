import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultSettings, normalizeSettings, validateSettings, resolveDriverRules, CAPACITY_UNITS } from '../settings/settings-model.js';
import { getTenantSettings, saveTenantSettings, listVehicles, activeVehicleCount, saveVehicle } from '../settings/settings-store.js';

const documents = new Map();
const account = { uid: 'tenantA', getIdToken: async () => 'test-token' };
let generatedIds = 0;
const ref = path => ({
  id: path.split('/').at(-1),
  collection(name) { return ref(`${path}/${name}`); },
  doc(id) { return ref(`${path}/${id || `vehicle-auto-${++generatedIds}`}`); },
  async get() {
    if (path.endsWith('/vehicles')) return { docs: [...documents].filter(([key]) => key.startsWith(`${path}/`)).map(([key, data]) => ({ id: key.slice(path.length + 1), data: () => data })) };
    const data = documents.get(path); return { exists: !!data, data: () => data };
  },
  async set(data, { merge } = {}) { documents.set(path, merge ? { ...(documents.get(path) || {}), ...data } : data); }
});
function firestore() { return { collection: name => ref(name), batch: () => { const writes = []; return { set: (target, data, options) => writes.push([target, data, options]), commit: async () => { for (const [target, data, options] of writes) await target.set(data, options); } }; } }; }
firestore.FieldValue = { serverTimestamp: () => 'server-time' };
globalThis.firebase = { auth: () => ({ currentUser: account }), firestore };
globalThis.FirebaseApp = { auth: { isDriverAccount: () => false } };
const local = new Map();
globalThis.localStorage = { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) };

test('Settings page and navigation are present', () => {
  const html = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
  for (const name of ['company','drivers','vehicles','routePlanning','orders','driverApp']) assert.match(html, new RegExp(`data-section="${name}"`));
  assert.doesNotMatch(html, /data-section="(?:planning|capacity)"/);
  const vehicles = html.split('id="section-vehicles"')[1].split('id="section-routePlanning"')[0];
  for (const id of ['capacityMode','vehicleCapacity']) assert.match(vehicles, new RegExp(`id="${id}"`));
  // Route Planning Defaults owns the Customer Delivery Schedule and the (single) Default Service Time.
  const planning = html.split('id="section-routePlanning"')[1].split('id="section-orders"')[0];
  assert.match(planning, /Route Planning Defaults/);
  assert.match(planning, /Customer Delivery Schedule/);
  for (const id of ['defaultDeliverySchedule','serviceMinutes','maxDurationMinutes','numberOfRoutes','planningTime']) assert.match(planning, new RegExp(`id="${id}"`));
  assert.equal((html.match(/id="serviceMinutes"/g) || []).length, 1, 'one service-time setting');
  assert.doesNotMatch(html, /id="section-(?:planning|capacity)"/);
  assert.match(html, /Save Changes/);
  assert.match(readFileSync(new URL('../app.html', import.meta.url), 'utf8'), /settings\.html/);
});
test('missing tenant settings resolve safe defaults without creating counts', async () => {
  const settings = await getTenantSettings();
  assert.deepEqual(settings, defaultSettings());
  assert.equal('driverCount' in settings, false);
  assert.equal('vehicleCount' in settings, false);
});
test('validation covers workload, time, service, route count and capacity consistency', () => {
  const settings = defaultSettings();
  settings.drivers.maxStops = -5; settings.drivers.workingEnd = '25:80'; settings.routePlanning.serviceMinutes = 0; settings.routePlanning.numberOfRoutes = 0;
  assert.deepEqual(Object.keys(validateSettings(settings)).sort(), ['maxStops','numberOfRoutes','serviceMinutes','workingHours']);
  settings.drivers = defaultSettings().drivers; settings.routePlanning = defaultSettings().routePlanning;
  for (const mode of ['off','weight','pallet','carton']) {
    settings.capacityPlanning = { enabled: mode !== 'off', mode, unit: CAPACITY_UNITS[mode] };
    assert.deepEqual(validateSettings(settings), {});
    assert.equal(normalizeSettings(settings).capacityPlanning.unit, CAPACITY_UNITS[mode]);
  }
  settings.capacityPlanning = { enabled: true, mode: 'weight', unit: 'carton' };
  assert.ok(validateSettings(settings).capacityMode);
});
test('null Driver overrides inherit company defaults and session values take priority', () => {
  const settings = defaultSettings(); settings.drivers.overrides.driverA = { maxStops: 15, workingStart: null, workingEnd: null, breakMinutes: null };
  assert.deepEqual(resolveDriverRules(settings, 'driverB'), { maxStops: 20, workingStart: '08:00', workingEnd: '17:00', breakMinutes: 60 });
  assert.deepEqual(resolveDriverRules(settings, 'driverA'), { maxStops: 15, workingStart: '08:00', workingEnd: '17:00', breakMinutes: 60 });
  assert.equal(resolveDriverRules(settings, 'driverA', { maxStops: 12 }).maxStops, 12);
});
test('save and reload are tenant-scoped; Contact Required and Driver policies persist', async () => {
  const settings = defaultSettings(); settings.drivers.maxStops = 18; settings.orders.contactRequired = true; settings.driverApp.liveTracking = false; settings.driverApp.pod.photoRequired = true;
  await saveTenantSettings(settings);
  assert.equal(documents.get('users/tenantA/settings/orderHub').contactRequired, true);
  assert.equal(documents.get('users/tenantA/settings/operationsV1').drivers.maxStops, 18);
  assert.equal((await getTenantSettings()).driverApp.pod.photoRequired, true);
  account.uid = 'tenantB';
  assert.deepEqual(await getTenantSettings(), defaultSettings());
  account.uid = 'tenantA';
});
test('Vehicle totals derive from records; old records without capacity remain usable when capacity is off', async () => {
  documents.set('users/tenantA/vehicles/old', { name: 'Old Van', registration: 'OLD1', active: true });
  assert.equal(activeVehicleCount(await listVehicles()), 1);
  const created = await saveVehicle({ name: 'New Van', registration: 'NEW1', active: false, capacityValue: '' }, defaultSettings());
  assert.match(created.id, /^vehicle-auto-/);
  assert.equal(documents.get(`users/tenantA/vehicles/${created.id}`).registration, 'NEW1');
  assert.equal(activeVehicleCount(await listVehicles()), 1);
  await assert.rejects(() => saveVehicle({ name: 'Bad Van', registration: 'BAD', capacityValue: 0 }, defaultSettings()), /capacity must be greater/);
});
test('permission-denied saves fail rather than claiming success', async () => {
  const originalBatch = firestore().batch;
  const denied = () => ({ set() {}, commit: async () => { const error = Error('permission-denied'); error.code = 'permission-denied'; throw error; } });
  const firestoreFn = globalThis.firebase.firestore;
  globalThis.firebase.firestore = Object.assign(() => ({ collection: name => ref(name), batch: denied }), { FieldValue: firestore.FieldValue });
  await assert.rejects(() => saveTenantSettings(defaultSettings()), /permission-denied/);
  globalThis.firebase.firestore = firestoreFn;
  assert.equal(typeof originalBatch, 'function');
});

test('Dashboard keeps History access while removing secondary hero and sidebar shortcuts', () => {
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-page="page-history-browser" onclick/);
  assert.match(html, /id="browseFullHistoryBtn"/);
  assert.match(html, /id="page-history-browser"/);
  assert.doesNotMatch(html, /id="open(?:OrderHub|Settings)Btn"/);
  assert.match(html, /id="createNewRouteBtn"/);
  assert.match(html, /id="loadSelectedRouteBtn"/);
});

test('Saved Stops keeps three workflows and Contact editing within Search', () => {
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  for (const mode of ['add','edit','import']) assert.match(html, new RegExp(`data-stop-workspace-mode="${mode}"`));
  assert.doesNotMatch(html, /data-stop-workspace-mode="contacts"/);
  const search = html.split('id="manageStopsSection"')[1].split('id="stopsImportSection"')[0];
  assert.match(search, /id="orderContactsSection"/);
  assert.match(search, /id="masterSearchForm"/);
  assert.match(html, /id="addStopForm"/);
  assert.match(html, /id="stopsImportSection"/);
});

test('shared operational layout styles are loaded on each workspace page', () => {
  for (const file of ['app.html','settings.html','order-hub.html']) assert.match(readFileSync(new URL('../'+file, import.meta.url), 'utf8'), /styles\/workspace-layout\.css/);
});

test('Settings entry reuses the Driver-account list instead of fetching Drivers twice', () => {
  const page = readFileSync(new URL('../settings/settings-page.js', import.meta.url), 'utf8');
  assert.match(page, /Promise\.allSettled\(\[listVehicles\(\), driverAccountsApi\(\)\]\)/);
  assert.match(page, /state\.drivers = state\.driverAccounts\.filter/);
  assert.doesNotMatch(page, /listLinkedDrivers/);
});

test('route planning defaults include the seven-day Customer Delivery Schedule with validation', () => {
  const base = defaultSettings();
  assert.equal(base.routePlanning.serviceMinutes, 15, 'existing service time stays the source (default 15)');
  assert.equal(base.routePlanning.defaultDeliverySchedule.monday.windows[0].start, '09:00');
  assert.equal(base.routePlanning.defaultDeliverySchedule.saturday.open, false);
  const custom = structuredClone(base);
  custom.routePlanning.defaultDeliverySchedule.saturday = { open: true, windows: [{ start: '09:00', end: '12:00' }], breaks: [] };
  assert.equal(normalizeSettings(custom).routePlanning.defaultDeliverySchedule.saturday.open, true, 'a valid schedule is kept');
  assert.deepEqual(validateSettings(normalizeSettings(custom)), {});
  const broken = structuredClone(base);
  broken.routePlanning.defaultDeliverySchedule.monday.windows = [{ start: '18:00', end: '09:00' }];
  assert.match(validateSettings(broken).deliverySchedule, /end time must be after start time/);
  assert.equal(normalizeSettings(broken).routePlanning.defaultDeliverySchedule.monday.windows[0].start, '09:00', 'stored invalid data falls back to the default');
  assert.equal(normalizeSettings({}).routePlanning.defaultDeliverySchedule.friday.breaks[0].start, '12:00', 'old settings without a schedule get the default');
});
