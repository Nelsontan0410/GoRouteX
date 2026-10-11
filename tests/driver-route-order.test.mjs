import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('a driver sees Route 1, 2, 3 of one dispatched plan in driving order, newest day first', async () => {
  globalThis.window = globalThis.window || {};
  const { compareAssignedRoutes } = await import('../driver/route-store.js');
  const day = (date, plan, n, ts) => ({ id: `${plan}-${n}`, date, dispatchPlanId: plan, routeName: `Route ${n}`, timestamp: ts });
  const routes = [day('2026-10-12', 'p1', 3, 't3'), day('2026-10-12', 'p1', 1, 't9'), day('2026-10-11', 'p0', 1, 't1'), day('2026-10-12', 'p1', 2, 't5')];
  assert.deepEqual(routes.sort(compareAssignedRoutes).map((r) => r.id), ['p1-1', 'p1-2', 'p1-3', 'p0-1']);
  const withIds = [{ dispatchPlanId: 'p', routeId: '10', date: 'd' }, { dispatchPlanId: 'p', routeId: '2', date: 'd' }];
  assert.deepEqual(withIds.sort(compareAssignedRoutes).map((r) => r.routeId), ['2', '10'], 'numeric, not text order');
});

test('dispatch copies the route number to the driver; Dispatch offers one driver for all routes', () => {
  const fn = readFileSync(new URL('../netlify/functions/dispatch.js', import.meta.url), 'utf8');
  assert.match(fn, /const delivery = \{ id: dispatchId, routeId, routeName: routeId === DayRoute\.DAY_ROUTE_ID \? 'All stops' : `Route \$\{routeId\}`, originLatLng: plan\.originLatLng \|\| null, endLatLng,/);
  const html = readFileSync(new URL('../dispatch.html', import.meta.url), 'utf8');
  assert.match(html, /id="dispatchAllDriver"/);
  const board = readFileSync(new URL('../dispatch/dispatch-board.js', import.meta.url), 'utf8');
  assert.match(board, /sessionStorage\.setItem\(`grxDispatchDriver:\$\{context\.planId\}:\$\{routeId\}`, select\.value\)/, 'fills every route that is not yet dispatched');
  assert.match(board, /return state\.drivers\.length === 1 \? state\.drivers\[0\]\.uid : '';/, 'a single active driver is chosen automatically');
  const page = readFileSync(new URL('../driver/driver-page.js', import.meta.url), 'utf8');
  assert.match(page, /siblings>1\?` \(of \$\{siblings\}\)`:''/);
});
