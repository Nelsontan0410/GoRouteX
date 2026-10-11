import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const slice = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

test('Share all routes joins every route in driving order into one WhatsApp message', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`
    var AppState = { plannedRoutes: [{ id: 1, directionsResult: {} }, null, { id: 2, directionsResult: {} }, { id: 3 }] };
    function buildRouteShareData(i) { return { message: 'Route ' + AppState.plannedRoutes[i].id }; }
    ${slice('    function buildAllRoutesShareMessage()', '    function shareAllRoutes()')}
    this.result = buildAllRoutesShareMessage();
  `, ctx);
  assert.equal(ctx.result.count, 2, 'unplanned routes are skipped');
  assert.match(ctx.result.message, /^Route 1\n\n━+\n\nRoute 2$/);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.result.blocked)), []);
});

test('a route blocked by the safety check stops Share all; the button is wired and role-gated', () => {
  const fn = slice('    function shareAllRoutes()', '    function generateShareableLinkPage3(');
  assert.match(fn, /if \(blocked\.length\) \{[\s\S]*?return;/);
  assert.match(fn, /openWhatsAppWithFallback\('', message,/);
  assert.match(app, /if \(shareAllRoutesBtn\) shareAllRoutesBtn\.addEventListener\('click', shareAllRoutes\);/);
  assert.match(app, /shareCurrentRouteBtn,\n\s*shareAllRoutesBtn,\n\s*mapsPreviewBtn,/);
});

test('share messages carry the planning date and list detour points apart from delivery stops', () => {
  const build = slice('    function buildRouteShareData(', '    function updateRouteSharePreview(');
  assert.match(build, /const tripDate = formatRegionalDate\(getRouteStartDateTime\(\),/);
  assert.match(build, /Navigation points \(not delivery stops\):/);
  assert.match(build, /lines\.push\(`Total stops: \$\{operationalStopIds\.length\}`\);/);
});
