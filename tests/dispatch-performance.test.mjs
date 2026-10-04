import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { snapshotRouteStops } from '../driver/route-model.js';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const board = readFileSync(new URL('../dispatch/dispatch-board.js', import.meta.url), 'utf8');
const dispatchPage = readFileSync(new URL('../dispatch.html', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../dispatch/dispatch-page.js', import.meta.url), 'utf8');
const accountContext = readFileSync(new URL('../account-context.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../netlify/functions/dispatch.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');

function section(source, start, end) {
  const a = source.indexOf(start);
  assert.ok(a >= 0, `Missing ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.ok(b >= 0, `Missing ${end}`);
  return source.slice(a, b);
}

test('standalone Dispatch receives the persisted plan ID and avoids Planning dependencies', () => {
  const finalization = readFileSync(new URL('../planning/route-finalization.js', import.meta.url), 'utf8');
  const flow = section(finalization, 'async function handleProceedToOptimizeRoutes(options = {})', 'function openDispatchPage');
  assert.ok(flow.indexOf('generateTimeListAndShowOnPage3Legacy') < flow.indexOf('savePlannedRoutes'));
  assert.ok(flow.indexOf('savePlannedRoutes') < flow.indexOf('openDispatchPage(dynamicSaveResult.id)'));
  assert.match(flow, /dynamicSaveResult\?\.success && !dynamicSaveResult\.skipped/);
  assert.match(flow, /if \(!dynamicSaveResult\.id\)/);
  assert.match(readFileSync(new URL('../history/route-history-page.js', import.meta.url), 'utf8'), /function loadSelectedRoute\(\) \{[\s\S]*?openDispatchPage\(entry\.id\)/);
  assert.match(app, /onclick="openDispatchPage\(\)">Dispatch/);
  assert.doesNotMatch(app, /id="dispatchBoard"/);
  assert.match(dispatchPage, /id="dispatchBoard"/);
  assert.match(dispatchPage, /src="dispatch\/dispatch-board\.js"/);
  assert.doesNotMatch(dispatchPage, /route-engine\.js|route-safety\.js|map-handler\.js|xlsx|maps\.googleapis|ui\.js/);
  assert.match(bootstrap, /RoutePlannerStorage\.loadPlan\(planId/);
  assert.match(bootstrap, /RoutePlannerStorage\.loadLatestFinalizedPlan/);
  assert.match(bootstrap, /Plan no longer available/);
  assert.match(bootstrap, /No finalized route plan available/);
  assert.match(bootstrap, /auth\.isDriverAccount\(user\)/);
  assert.match(bootstrap, /location\.replace\('driver\.html'\)/);
  assert.match(readFileSync(new URL('../_redirects', import.meta.url), 'utf8'), /\/driver\.html \/driver-tracking\.html 200/);
  assert.match(bootstrap, /routeStops\(route\)/);
});

test('direct plan entry waits for account access, loads only the selected plan, and reuses the board', async () => {
  const calls = { plan: [], latest: 0, refresh: 0, init: 0, optimization: 0, eta: 0, directions: 0 };
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, classList: { toggle() {} }, append() {}, addEventListener() {}, textContent: '' });
    return nodes.get(id);
  };
  let authCallback;
  const user = { uid: 'tenantA', email: 'owner@example.test' };
  const route = { id: 1, customerStops: [{ id: 'one' }], detailedStopTimes: [{ stopId: 'one', arrivalTimeStr: '09:00' }] };
  const plan = { id: 'selected_123', plannedRoutes: [route] };
  const window = {
    location: { search: '?planId=selected_123', replace() {} },
    setTimeout, clearTimeout, addEventListener() {},
    FirebaseApp: { auth: {
      onAuthStateChange(callback) { authCallback = callback; },
      getCurrentUser() { return user; },
      isDriverAccount() { return false; },
      async ensureProfile() { return { success: true, profile: { role: 'admin', name: 'Owner', productPlanKey: 'proplan', billingStatus: 'active' } }; }
    } },
    RoutePlannerStorage: {
      async loadPlan(id) { calls.plan.push(id); return { success: true, plan, storageMode: 'cloud' }; },
      async loadLatestFinalizedPlan() { calls.latest++; return { success: true, plan: null }; }
    },
    RoutePlannerProduct: { normalizePlanKey(value, fallback) { return value === 'proplan' ? 'proplan' : fallback; }, getCurrentPlan() { return 'proplan'; }, getPlanDefinition() { return { key: 'proplan' }; } },
    GoRouteXDispatch: {
      reset() {}, init(options) { calls.init++; this.options = options; },
      refresh() { calls.refresh++; },
      contextFromPlan(value) { return { planId: value.id, routes: value.plannedRoutes }; }
    },
    RouteEngine: { optimize() { calls.optimization++; } },
    generateTimeListAndShowOnPage3Legacy() { calls.eta++; },
    google: { maps: { DirectionsService() { calls.directions++; } } }
  };
  const session = new Map();
  const sandbox = vm.createContext({ window, document: { hidden: false, getElementById: node }, sessionStorage: { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value) }, performance, URLSearchParams, console });
  vm.runInContext(accountContext, sandbox);
  vm.runInContext(bootstrap, sandbox);
  assert.deepEqual(calls.plan, []);
  await authCallback(user);
  assert.deepEqual(calls.plan, ['selected_123']);
  assert.equal(calls.latest, 0);
  assert.equal(calls.init, 1);
  assert.equal(calls.refresh, 1);
  assert.equal(window.GoRouteXDispatch.options.getContext().planId, 'selected_123');
  assert.equal(nodes.get('dispatchBoard').hidden, false);
  assert.equal(nodes.get('dispatchDisplayName').textContent, 'Owner');
  assert.equal(nodes.get('dispatchCurrentPlan').textContent, 'Pro Plan');
  assert.equal(session.get('grxLastFinalizedPlan:tenantA'), 'selected_123');
  assert.deepEqual([calls.optimization, calls.eta, calls.directions], [0, 0, 0]);
});

test('current-plan status excludes unrelated history, GPS, and POD; Driver list has no N+1 identity chain', () => {
  const drivers = section(service, "if (action === 'drivers' && req.method === 'GET')", "if (action === 'dispatch' && req.method === 'POST')");
  assert.match(drivers, /where\('status', '==', 'ACTIVE'\)/);
  assert.doesNotMatch(drivers, /driverIdentity|getUser\(|for \(const/);
  const status = section(service, "if (action === 'routes' && req.method === 'GET' && url.searchParams.get('planId'))", "if ((action === 'routes' || action === 'monitor')");
  assert.match(status, /doc\(key\(uid, planId, routeId\)\)/);
  assert.doesNotMatch(status, /where\('dispatchOwnerUid'|drivers_live|driverPods|gps:|pods:/);
  assert.match(status, /dispatchOwnerUid !== uid/);
});

test('100 standalone Route tab switches make no requests, writes, ETA, or Directions calls', () => {
  const calls = { fetch: 0, write: 0, eta: 0, directions: 0 };
  const cards = [1, 2, 3].map(id => ({ dataset: { routeId: String(id) }, hidden: false }));
  const tabs = [1, 2, 3].map(id => ({ dataset: { routeId: String(id) }, setAttribute() {}, tabIndex: 0 }));
  const document = { querySelectorAll(selector) { return selector.includes('dispatch-route-card') ? cards : tabs; } };
  const window = { fetch() { calls.fetch++; }, saveActivePlannedRoutesToCloud() { calls.write++; }, generateTimeListAndShowOnPage3Legacy() { calls.eta++; }, google: { maps: { DirectionsService() { calls.directions++; } } } };
  vm.runInContext(board, vm.createContext({ document, window, performance, console }));
  const durations = [];
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    window.GoRouteXDispatch.selectRoute(String(i % 3 + 1));
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  assert.deepEqual(calls, { fetch: 0, write: 0, eta: 0, directions: 0 });
  assert.equal(cards.filter(card => !card.hidden).length, 1);
  assert.ok(durations[94] < 200, `Local harness p95 ${durations[94].toFixed(1)} ms`);
});

test('Dispatch refresh has keyed in-flight reuse, stale generation checks, and visible-page polling', () => {
  assert.match(board, /state\.refreshPromise && !forceDrivers && state\.refreshKey/);
  assert.match(board, /generation !== state\.generation/);
  assert.match(board, /driverCache\?\.uid === user\.uid/);
  assert.match(board, /document\.hidden/);
  assert.match(board, /state\.dispatched\.length\) pollStatus\(\)/);
  assert.match(board, /patchStatus\(result\.routes \|\| \[\]\)/);
});

test('primary endpoints read only current plan and tenant Drivers in a simulated 100-route history', async () => {
  const calls = { statusDocs: [], allHistoryQueries: 0, authUsers: 0, driverDocs: 0 };
  const owner = 'tenantA';
  const doc = (id, data) => ({ id, exists: data !== null, data: () => data });
  const routeDocs = new Map();
  for (let i = 0; i < 100; i++) routeDocs.set(`tenantA_old_${i}`, { dispatchOwnerUid: owner, dispatchPlanId: 'old', routeId: String(i) });
  routeDocs.set('tenantA_today_1', { dispatchOwnerUid: owner, dispatchPlanId: 'today', routeId: '1', assignedDriverUid: 'drv_A', driverName: 'A', status: 'DISPATCHED', plannedRoutes: [{ customerStops: [{ id: 'one' }] }] });
  const db = { collection(name) {
    if (name === 'dispatchRoutes') return {
      doc(id) { calls.statusDocs.push(id); return { get: async () => doc(id, routeDocs.get(id) || null) }; },
      where() { calls.allHistoryQueries++; throw Error('Unrelated history scan'); }
    };
    if (name === 'users') return { doc(uid) { return {
      get: async () => doc(uid, uid === owner ? { role: 'owner' } : null),
      collection(sub) {
        if (sub === 'drivers') return { where: () => ({ get: async () => ({ size: 3, docs: [0, 1, 2].map(i => doc(`drv_${i}`, { tenantId: owner, status: 'ACTIVE', displayName: `Driver ${i}`, username: `d${i}` })) }) }) };
        if (sub === 'driverExecutions') return { doc: () => ({ get: async () => doc('execution', { status: 'IN_PROGRESS', stops: [{ executionStatus: 'DELIVERED' }] }) }) };
        throw Error(`Unexpected users subcollection ${sub}`);
      }
    }; } };
    throw Error(`Unexpected collection ${name}`);
  } };
  const transformed = service.replace(/^import .*;\n/gm, '').replace('export default async (req) => {', 'globalThis.handler = async (req) => {').replace(/^export function /gm, 'function ');
  const sandbox = vm.createContext({
    getFirebaseAdmin: () => ({ firestore: () => db, auth: () => ({ getUser: async () => { calls.authUsers++; throw Error('Auth N+1'); } }) }),
    verifyFirebaseUser: async () => ({ uid: owner }),
    jsonResponse: (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }),
    readJson: async () => ({}), requireOwner: () => {},
    snapshotRouteStops,
    URL, Response, Buffer, performance, console
  });
  vm.runInContext(transformed, sandbox);
  const driverResponse = await sandbox.handler(new Request('https://example.test/.netlify/functions/dispatch?action=drivers'));
  const drivers = await driverResponse.json();
  assert.equal(drivers.drivers.length, 3);
  assert.equal(calls.authUsers, 0);
  assert.equal(calls.driverDocs, 0);
  const routeResponse = await sandbox.handler(new Request('https://example.test/.netlify/functions/dispatch?action=routes&planId=today&routeIds=1,2'));
  const routes = await routeResponse.json();
  assert.equal(routes.routes.length, 1);
  assert.deepEqual(calls.statusDocs, ['tenantA_today_1', 'tenantA_today_2']);
  assert.equal(calls.allHistoryQueries, 0);
  assert.equal(routes.routes[0].execution.completedStops, 1);
  assert.ok(!('gps' in routes.routes[0]));
  assert.ok(!('pods' in routes.routes[0]));
});
