import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Start Route owns execution and GPS; navigation links only open Maps', () => {
  const page = read('driver/driver-page.js');
  const navigation = page.slice(page.indexOf('function renderNavigateAll('), page.indexOf('// Back from Google Maps:'));
  assert.doesNotMatch(navigation, /startRoute\(|store\.start|startTracking\(/);
  assert.match(page, /function startRoute\(\)\{return perform\(async\(\)=>\{state\.execution=await state\.store\.start\(state\.route\);[\s\S]*?await resumeTracking\(\);/);
  assert.match(page, /\$\('driverStartBtn'\)\.onclick=startRoute;/);
});

test('coming back to the page or recording a stop sends the position at once', () => {
  const page = read('driver/driver-page.js');
  assert.match(page, /document\.addEventListener\('visibilitychange',[\s\S]*?refreshNow/);
  assert.match(page, /finally\{state\.busy=false;render\(\);if\(state\.execution\?\.status==='IN_PROGRESS'\)window\.DriverTrackingPage\?\.refreshNow\?\.\(\);\}/);
  assert.match(read('driver-tracking.html'), /id="driverLocationAlert"[\s\S]*id="driverLocationRetry"/);
});

function trackingErrorHandler() {
  const source = read('driver-tracking.js');
  const start = source.indexOf('  function handlePositionError(error) {');
  const body = source.slice(start, source.indexOf('\n  }\n', start) + 4);
  const ctx = vm.createContext({ state: { runtimeStatus: 'active', networkState: 'offline' }, stopped: 0, rendered: 0 });
  vm.runInContext(`function stopGeoWatch() { stopped++; } function renderAll() { rendered++; }
    function clearFirstFixTimer() {} function releaseWakeLock() {}
    function geolocationErrorMessage() { return 'Location timed out.'; } var global = {};
    ${body} this.handle = handlePositionError;`, ctx);
  return ctx;
}

test('a GPS timeout keeps watching; only a denied permission stops tracking', () => {
  const timeout = trackingErrorHandler();
  timeout.handle({ code: 3, PERMISSION_DENIED: 1 });
  assert.equal(timeout.state.runtimeStatus, 'active');
  assert.equal(timeout.stopped, 0);
  const denied = trackingErrorHandler();
  denied.handle({ code: 1, PERMISSION_DENIED: 1 });
  assert.equal(denied.state.runtimeStatus, 'error');
  assert.equal(denied.state.permissionState, 'denied');
  assert.equal(denied.stopped, 1);
});

test('Live view has a way back to Dispatch and home', () => {
  const html = read('driver-tracking.html');
  assert.match(html, /id="operationsBackLink"[^>]*href="dispatch\.html"/);
  assert.match(html, /id="operationsHomeLink"[^>]*href="order-hub\.html"/);
  assert.match(read('driver/operations-page.js'), /\$\('blockedSecondaryAction'\)\.href = back\.href;/);
});

// ---- Phase 0: first fix, driver-visible problems, Maps hand-off ----
function extract(source, name) {
  const start = source.search(new RegExp(`\\n  (async )?function ${name}\\(`)) + 1;
  assert.ok(start > 0, `${name} not found`);
  return source.slice(start, source.indexOf('\n  }\n', start) + 4);
}

function trackingSandbox() {
  const source = read('driver-tracking.js');
  const names = ['debugLog', 'clearFirstFixTimer', 'sendGpsHint', 'sendApproximatePosition', 'onFirstFixWait', 'handlePositionSuccess', 'getProblem', 'sanitizeText'];
  const ctx = vm.createContext({
    clock: 0, uploads: [], updates: [], traces: [],
    console, Promise, Number, Math, String, Error,
    setTimeout: () => 1, clearTimeout: () => {},
    global: { localStorage: { getItem: () => null }, FirebaseApp: { tracking: {} } },
    state: { runtimeStatus: 'active', routeUnlocked: true, networkState: 'online', permissionState: 'granted', lastUploadedAt: null, lastUploadError: '',
      trackingStartedAt: 1, bestCoarseFix: null, approximateSent: false, lastHint: '', firstFixTimer: null, sessionId: 's1', sessionCreatedInCloud: true,
      trackingContext: { driverId: 'drv_1', driverName: 'Tan', routeId: 'r1', routeName: 'Route 1' } }
  });
  vm.runInContext(`
    const MAX_ACCEPTED_ACCURACY_METERS = 120, FIRST_FIX_WAIT_MS = 8000, MAX_APPROX_ACCURACY_METERS = 1500;
    Date.now = () => clock;
    global.FirebaseApp.tracking.updateSession = async (id, data) => { updates.push(data); return { success: true }; };
    function renderAll() {} function appendTracePoint(p) { traces.push(p); }
    async function ensureCloudSession() { return true; }
    function uploadCurrentPosition(force) { uploads.push(force); return Promise.resolve(true); }
    ${names.map((name) => extract(source, name)).join('\n')}
    this.api = { handlePositionSuccess, onFirstFixWait, getProblem };`, ctx);
  return ctx;
}
const fix = (accuracy, lat = 1.33, lng = 103.74) => ({ coords: { latitude: lat, longitude: lng, accuracy, speed: null, heading: null } });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('first fix: a fix within 120 m uploads normally and goes into the trace', async () => {
  const ctx = trackingSandbox();
  ctx.clock = 2000;
  await ctx.api.handlePositionSuccess(fix(20), true);
  assert.deepEqual(Array.from(ctx.uploads), [true]);
  assert.equal(ctx.traces.length, 1);
  assert.equal(ctx.updates.length, 0);
});

test('first fix: only coarse fixes → one approximate position after 8 s, never a point or trace', async () => {
  const ctx = trackingSandbox();
  ctx.clock = 3000;
  ctx.api.handlePositionSuccess(fix(900));
  ctx.api.handlePositionSuccess(fix(400));
  ctx.api.handlePositionSuccess(fix(2500));
  await settle();
  assert.equal(ctx.updates.length, 0, 'nothing is sent before FIRST_FIX_WAIT_MS');
  ctx.clock = 9001;
  ctx.api.onFirstFixWait();
  await settle();
  assert.equal(ctx.updates.length, 1);
  const sent = ctx.updates[0];
  assert.equal(sent.approximate, true);
  assert.equal(sent.positionIsNew, true);
  assert.equal(sent.accuracy, 400, 'the best coarse fix is sent');
  assert.equal(sent.gpsHint, 'WAITING_FIRST_FIX');
  ctx.api.handlePositionSuccess(fix(300));
  await settle();
  assert.equal(ctx.updates.length, 1, 'a second coarse fix is not sent');
  assert.equal(ctx.uploads.length, 0);
  assert.equal(ctx.traces.length, 0);
});

test('first fix: no fix at all after 8 s sends the WAITING_FIRST_FIX hint once', async () => {
  const ctx = trackingSandbox();
  ctx.clock = 9001;
  ctx.api.onFirstFixWait();
  ctx.api.onFirstFixWait();
  await settle();
  assert.equal(ctx.updates.length, 1);
  assert.equal(ctx.updates[0].gpsHint, 'WAITING_FIRST_FIX');
  assert.equal(ctx.updates[0].lat, undefined);
});

test('getProblem shows permission, waiting for a fix, upload errors and offline to the driver', () => {
  const ctx = trackingSandbox();
  ctx.clock = 2000;
  assert.equal(ctx.api.getProblem(), null);
  ctx.clock = 9001;
  assert.equal(ctx.api.getProblem().code, 'WAITING_FIRST_FIX');
  ctx.state.lastUploadError = 'Live upload failed: Missing or insufficient permissions.';
  assert.equal(ctx.api.getProblem().code, 'UPLOAD_FAILED');
  assert.match(ctx.api.getProblem().message, /^Location upload failed: Missing or insufficient permissions\./);
  ctx.state.permissionState = 'prompt';
  ctx.state.lastKnownPosition = null;
  assert.equal(ctx.api.getProblem().code, 'PERMISSION_PROMPT');
  ctx.state.networkState = 'offline';
  assert.equal(ctx.api.getProblem().code, 'OFFLINE');
  ctx.state.permissionState = 'denied';
  assert.equal(ctx.api.getProblem().code, 'PERMISSION_DENIED');
  assert.equal(ctx.api.getProblem().denied, true);
  ctx.state.runtimeStatus = 'paused';
  assert.equal(ctx.api.getProblem(), null);
});

function mapsSandbox(tracking) {
  const page = read('driver/driver-page.js');
  const start = page.indexOf('async function openMapsAfterUpload(');
  const body = page.slice(start, page.indexOf('\n', start));
  const ctx = vm.createContext({ Promise, waits: [], location: { href: 'driver-tracking.html' }, window: { DriverTrackingPage: tracking },
    setTimeout: (fn, ms) => { ctx.waits.push(ms); fn(); return 1; } });
  vm.runInContext(`const MAPS_UPLOAD_WAIT_MS = 1500; ${body} this.open = openMapsAfterUpload;`, ctx);
  return ctx;
}

test('Maps link during a route: sends the position first (at most 1500 ms), then opens Maps in this tab', async () => {
  let refreshed = 0, prevented = 0;
  const hanging = mapsSandbox({ refreshNow: () => { refreshed++; return new Promise(() => {}); }, isNativeMode: () => false });
  await hanging.open({ preventDefault: () => prevented++ }, 'https://www.google.com/maps/dir/?api=1');
  assert.equal(refreshed, 1);
  assert.equal(prevented, 1);
  assert.deepEqual(Array.from(hanging.waits), [1500]);
  assert.equal(hanging.location.href, 'https://www.google.com/maps/dir/?api=1', 'a hanging upload does not block Maps');
  const native = mapsSandbox({ refreshNow: () => { refreshed++; return Promise.resolve(true); }, isNativeMode: () => true });
  await native.open({ preventDefault() {} }, 'https://maps.example/next');
  assert.equal(refreshed, 1, 'native mode does not wait for the web upload');
  assert.equal(native.location.href, 'https://maps.example/next');
  const page = read('driver/driver-page.js');
  assert.doesNotMatch(page.slice(page.indexOf('async function openMapsAfterUpload('), page.indexOf('// One tap opens Google Maps')), /window\.open/);
});
