import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const product = source('route-planner-product.js');
const account = source('account-context.js');
const dispatch = source('dispatch/dispatch-page.js');
const route = { id: 'route-one', customerStops: [{ id: 'stop-one' }], detailedStopTimes: [{ stopId: 'stop-one', arrivalTimeStr: '09:00' }] };
const plan = { id: 'final-one', plannedRoutes: [route] };

function harness(profileResult, user = { uid: 'owner-uid', email: 'owner@example.test' }) {
  const nodes = new Map();
  const timers = new Map();
  const warnings = [];
  const calls = { listeners: 0, profiles: 0, planLoads: 0, redirects: [], boardInit: 0 };
  let callback;
  let currentUser = user;
  let nextTimer = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: false, children: [], classList: { toggle() {} }, append(...items) { this.children.push(...items); }, addEventListener() {} });
    return nodes.get(id);
  };
  const document = {
    hidden: false,
    getElementById: node,
    createElement(tag) { return { tag, textContent: '', addEventListener(event, fn) { this[event] = fn; } }; }
  };
  const window = {
    performance,
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {},
    location: { search: '', replace(url) { calls.redirects.push(url); }, assign(url) { calls.redirects.push(url); } },
    FirebaseApp: { auth: {
      onAuthStateChange(fn) { calls.listeners++; callback = fn; },
      getCurrentUser() { return currentUser; },
      isDriverAccount() { return false; },
      async ensureProfile() { calls.profiles++; const result = typeof profileResult === 'function' ? profileResult() : profileResult; if (result instanceof Error) throw result; return { success: true, profile: await result }; },
      ensureWorkspacePersistence() { return Promise.resolve({ success: true }); }
    } },
    RoutePlannerStorage: { async loadLatestFinalizedPlan() { calls.planLoads++; return { success: true, plan, storageMode: 'cloud' }; } },
    GoRouteXDispatch: { reset() {}, init() { calls.boardInit++; }, refresh() {}, contextFromPlan(value) { return value; } }
  };
  const session = new Map();
  const sandbox = vm.createContext({ window, document, sessionStorage: { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value) }, URLSearchParams, performance, console: { warn: (...args) => warnings.push(args) } });
  vm.runInContext(product, sandbox);
  vm.runInContext(account, sandbox);
  vm.runInContext(dispatch, sandbox);
  return {
    window, calls, warnings, timers, nodes,
    setUser(value) { currentUser = value; },
    auth(value = currentUser) { return callback(value); },
    retry() { const button = node('dispatchPageState').children.findLast(item => item?.textContent === 'Retry'); assert.ok(button, 'Retry button is visible'); button.click(); },
    fireTimer(id) { const timer = timers.get(id); if (timer) { timers.delete(id); timer.fn(); } }
  };
}

const pro = { name: 'logistic-sin', role: 'admin', productPlanKey: 'proplan', billingStatus: 'active' };

test('direct Dispatch auth restore reads users/{uid} once, then renders Pro identity and plan', async () => {
  const page = harness(pro);
  assert.equal(page.calls.listeners, 1);
  await page.auth();
  assert.equal(page.calls.profiles, 1);
  assert.equal(page.window.GoRouteXAccountContext.getIdentity().uid, 'owner-uid');
  assert.equal(page.nodes.get('dispatchDisplayName').textContent, 'logistic-sin');
  assert.equal(page.nodes.get('dispatchCurrentPlan').textContent, 'Pro Plan');
  assert.equal(page.calls.planLoads, 1);
  assert.equal(page.nodes.get('dispatchBoard').hidden, false);
  assert.equal(page.timers.size, 0, 'auth timeout was cleared when the callback fired');
});

test('refresh and independent new tab resolve the same owner without app.html memory', async () => {
  for (const page of [harness(pro), harness(pro), harness(pro)]) {
    await page.auth();
    assert.equal(page.nodes.get('dispatchDisplayName').textContent, 'logistic-sin');
    assert.equal(page.nodes.get('dispatchCurrentPlan').textContent, 'Pro Plan');
    assert.equal(page.calls.planLoads, 1);
  }
  const login = source('login.html');
  assert.match(login, /setLoginPersistence\(false\)/);
  assert.match(login, /Auth\.Persistence\.LOCAL/);
  assert.match(login, /setLoginPersistence\(true\)/);
  assert.match(login, /Auth\.Persistence\.SESSION/);
});

test('plan failure preserves resolved identity and terminates loading', async () => {
  const page = harness({ name: 'Known Owner', role: 'admin', productPlanKey: 'unknown-plan' });
  await page.auth();
  assert.equal(page.nodes.get('dispatchDisplayName').textContent, 'Known Owner');
  assert.equal(page.nodes.get('dispatchCurrentPlan').textContent, 'Plan unavailable');
  assert.match(page.nodes.get('dispatchPageState').textContent, /Plan unavailable/);
  assert.equal(page.calls.planLoads, 0);
  assert.equal(page.timers.size, 0);
});

test('profile permission failure shows explicit error and retry uses one listener', async () => {
  const error = Object.assign(Error('permission-denied'), { code: 'permission-denied' });
  const page = harness(error);
  await page.auth();
  assert.equal(page.nodes.get('dispatchDisplayName').textContent, 'Account unavailable');
  assert.equal(page.nodes.get('dispatchCurrentPlan').textContent, 'Plan unavailable');
  assert.match(page.nodes.get('dispatchPageState').textContent, /profile/);
  assert.ok(page.warnings.some(([label, detail]) => label === 'ACCOUNT_CONTEXT_STAGE_FAILED' && detail.stage === 'profileRead' && detail.code === 'permission-denied'));
  assert.equal(page.calls.listeners, 1);
  page.retry();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.calls.listeners, 1);
  assert.equal(page.calls.profiles, 2);
  assert.equal(page.calls.planLoads, 0);
});

test('workspace denial is not overwritten by the old auth timeout', async () => {
  const page = harness({ name: 'Viewer', role: 'viewer', productPlanKey: 'proplan' });
  await page.auth();
  assert.match(page.nodes.get('dispatchPageState').textContent, /Workspace role is missing or invalid/);
  assert.equal(page.nodes.get('dispatchDisplayName').textContent, 'Account unavailable');
  assert.equal(page.nodes.get('dispatchCurrentPlan').textContent, 'Plan unavailable');
  assert.equal(page.timers.size, 0);
  assert.equal(page.calls.planLoads, 0);
});

test('auth callback never firing ends in a stable auth error with retry', () => {
  const page = harness(pro);
  const [authTimer] = page.timers.keys();
  page.fireTimer(authTimer);
  assert.equal(page.nodes.get('dispatchDisplayName').textContent, 'Account unavailable');
  assert.equal(page.nodes.get('dispatchCurrentPlan').textContent, 'Plan unavailable');
  assert.match(page.nodes.get('dispatchPageState').textContent, /restore your sign-in/);
  assert.equal(page.calls.listeners, 1);
});


test('slow Dispatch profile request remains live and late success opens the board without another read', async () => {
  let finishProfile;
  const page = harness(() => new Promise(resolve => { finishProfile = resolve; }));
  const pending = page.auth();
  await new Promise(resolve => setImmediate(resolve));
  const slowTimer = [...page.timers].find(([, timer]) => timer.ms === 7000);
  assert.ok(slowTimer);
  page.fireTimer(slowTimer[0]);
  assert.match(page.nodes.get('dispatchPageState').textContent, /taking longer/);
  assert.equal(page.calls.profiles, 1);
  finishProfile(pro);
  await pending;
  assert.equal(page.calls.profiles, 1);
  assert.equal(page.nodes.get('dispatchDisplayName').textContent, 'logistic-sin');
  assert.equal(page.nodes.get('dispatchBoard').hidden, false);
});
