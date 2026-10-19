import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('tapping a navigation link starts the route when it was not started yet', () => {
  const page = read('driver/driver-page.js');
  assert.match(page, /link\.addEventListener\('click',\(\)=>\{if\(!state\.execution&&!state\.busy\)startRoute\(\);\}\);/);
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

test('Live view says why there is no GPS and polls every 15 seconds', () => {
  const ops = read('driver/operations-page.js');
  assert.match(ops, /the driver has not started this route/);
  assert.match(ops, /GPS problem on the driver's phone/);
  assert.match(ops, /Last activity/);
  assert.match(ops, /load\(\); \}, 15000\);/);
});
