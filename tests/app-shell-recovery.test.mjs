import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const product = read('route-planner-product.js');
const context = read('account-context.js');
const shell = read('app-shell.js');
const pro = { name: 'Owner', role: 'admin', tenantId: 'owner', productPlanKey: 'proplan', billingStatus: 'active' };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(loader) {
  const timers = new Map();
  const nodes = new Map();
  const selectors = new Map();
  const buttons = [
    { disabled: false, classList: { contains: () => false }, getAttribute: () => "window.location.href='settings.html'" },
    { disabled: false, classList: { contains: value => value === 'operations-logout' }, getAttribute: () => '' }
  ];
  let nextTimer = 0, listener, currentUser = null, reads = 0, mounts = 0;
  const element = () => ({
    hidden: false, dataset: {}, style: {}, textContent: '', disabled: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, appendChild() {}, addEventListener(event, fn) { this[event] = fn; },
    querySelector() { return element(); }
  });
  const root = element();
  root.classList = { add(value) { root.gated = value === 'account-is-gated'; }, remove() { root.gated = false; } };
  root.querySelector = () => element();
  root.querySelectorAll = () => buttons;
  const node = id => {
    if (id === 'activeSubscriberRoot') return root;
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const document = {
    head: { appendChild() {} },
    getElementById: node,
    querySelector: selector => { if (!selectors.has(selector)) selectors.set(selector, element()); return selectors.get(selector); },
    createElement: () => element(),
    addEventListener(event, fn) { if (event === 'DOMContentLoaded') this.boot = fn; }
  };
  const storage = { setItem() {}, removeItem() {} };
  const window = {
    document,
    location: { hash: '', href: '', replace(value) { this.href = value; } },
    FirebaseApp: {
      isInitialized: () => true, init: () => true,
      auth: {
        onAuthStateChange(fn) { listener = fn; return () => {}; },
        getCurrentUser: () => currentUser,
        isDriverAccount: () => false,
        loadProfile(user, options) { reads++; return loader(user, options); },
        resolveAccessState: () => 'active',
        sanitizeNextTarget: value => value,
        async signOut() { currentUser = null; }
      }
    },
    AppRuntime: { async mount() { mounts++; }, unmount() {} },
    GoRouteXSettings: { getTenantSettings: async () => ({}) }
  };
  const sandbox = vm.createContext({
    window, document, localStorage: storage, sessionStorage: storage, setTimeout(fn, ms) {
      const id = ++nextTimer; timers.set(id, { fn, ms }); return id;
    }, clearTimeout(id) { timers.delete(id); }, console: { warn() {} }
  });
  vm.runInContext(product, sandbox);
  vm.runInContext(context, sandbox);
  vm.runInContext(shell, sandbox);
  document.boot();
  return {
    window, root, timers, buttons, node, selector: value => document.querySelector(value),
    get reads() { return reads; }, get mounts() { return mounts; },
    auth(user) { currentUser = user; return listener(user); },
    fireSlow() { const match = [...timers].find(([, timer]) => timer.ms === 7000); assert.ok(match); timers.delete(match[0]); match[1].fn(); }
  };
}

test('authenticated shell appears before profile, stays gated after seven seconds, and late success mounts workspace once', async () => {
  const request = deferred();
  const page = harness(() => request.promise);
  const pending = page.auth({ uid: 'owner', email: 'owner@example.test' });
  assert.equal(page.root.hidden, false);
  assert.equal(page.root.dataset.accountStage, 'profile-loading');
  assert.equal(page.mounts, 0);
  assert.equal(page.buttons[0].disabled, true);
  page.fireSlow();
  assert.equal(page.root.dataset.accountStage, 'profile-slow');
  assert.equal(page.reads, 1);
  request.resolve({ success: true, profile: pro, serverConfirmed: true });
  await pending;
  assert.equal(page.root.dataset.accountStage, 'ready');
  assert.equal(page.mounts, 1);
  assert.equal(page.reads, 1);
});

test('late Firestore error replaces slow message and keeps Logout available', async () => {
  const request = deferred();
  const page = harness(() => request.promise);
  const pending = page.auth({ uid: 'owner', email: 'owner@example.test' });
  page.fireSlow();
  request.resolve({ success: false, error: 'permission denied', code: 'permission-denied' });
  await pending;
  assert.equal(page.root.dataset.accountStage, 'profile-error');
  assert.match(page.node('sidebarCurrentPlan').textContent, /Plan unavailable/);
  assert.match(page.node('accountBootstrapPanel').textContent || '', /^$/);
  assert.equal(page.mounts, 0);
  assert.equal(page.buttons[1].disabled, false);
});

test('retry during an active profile read reuses one request', async () => {
  const request = deferred();
  const page = harness(() => request.promise);
  const user = { uid: 'owner', email: 'owner@example.test' };
  const first = page.auth(user);
  page.fireSlow();
  const second = page.window.AppShell.refreshAccessState();
  assert.equal(page.reads, 1);
  request.resolve({ success: true, profile: pro, serverConfirmed: true });
  await Promise.all([first, second]);
  assert.equal(page.mounts, 1);
});

test('cached profile requires a second server-confirmed read before tenant data mounts', async () => {
  const server = deferred();
  const page = harness((_user, options) => options?.source === 'server'
    ? server.promise
    : Promise.resolve({ success: true, profile: pro, fromCache: true, serverConfirmed: false }));
  const pending = page.auth({ uid: 'owner', email: 'owner@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.reads, 2);
  assert.equal(page.mounts, 0);
  server.resolve({ success: true, profile: pro, fromCache: false, serverConfirmed: true });
  await pending;
  assert.equal(page.mounts, 1);
});

test('unknown plan preserves identity but keeps the main workspace gated', async () => {
  const page = harness(() => Promise.resolve({ success: true, profile: { ...pro, productPlanKey: 'unknown-plan' }, serverConfirmed: true }));
  await page.auth({ uid: 'owner', email: 'owner@example.test' });
  assert.equal(page.root.dataset.accountStage, 'plan-error');
  assert.equal(page.node('sidebarDisplayName').textContent, 'Owner');
  assert.equal(page.node('sidebarCurrentPlan').textContent, 'Plan unavailable');
  assert.equal(page.mounts, 0);
});

test('logout invalidates a late profile response without opening tenant data', async () => {
  const request = deferred();
  const page = harness(() => request.promise);
  const pending = page.auth({ uid: 'owner', email: 'owner@example.test' });
  await page.auth(null);
  request.resolve({ success: true, profile: pro, serverConfirmed: true });
  await pending;
  assert.equal(page.mounts, 0);
  assert.equal(page.window.GoRouteXAccountContext.getIdentity(), null);
});

test('account switch ignores the previous user response', async () => {
  const first = deferred(), second = deferred();
  const page = harness(user => user.uid === 'owner' ? first.promise : second.promise);
  const oldRequest = page.auth({ uid: 'owner', email: 'owner@example.test' });
  const nextRequest = page.auth({ uid: 'new-owner', email: 'new@example.test' });
  first.resolve({ success: true, profile: pro, serverConfirmed: true });
  second.resolve({ success: true, profile: { ...pro, name: 'New Owner', tenantId: 'new-owner' }, serverConfirmed: true });
  await Promise.all([oldRequest, nextRequest]);
  assert.equal(page.mounts, 1);
  assert.equal(page.window.GoRouteXAccountContext.getIdentity().uid, 'new-owner');
  assert.equal(page.node('sidebarDisplayName').textContent, 'New Owner');
});

test('unresolved plan cannot silently select Basic route storage', async () => {
  const storageSource = read('route-storage.js');
  const window = {
    FirebaseApp: { auth: { getCurrentUser: () => ({ uid: 'owner' }) } },
    GoRouteXAccountContext: { get: () => null },
    RoutePlannerProduct: { getCurrentPlan: () => 'basic', getStorageModeForPlan: () => 'indexeddb' }
  };
  vm.runInContext(storageSource, vm.createContext({ window, console: { warn() {} } }));
  await assert.rejects(window.RoutePlannerStorage.getResolvedStorage(), /Account plan unavailable/);
});

test('slow Firebase Auth restore offers a stable status and late Auth success continues', async () => {
  const page = harness(() => Promise.resolve({ success: true, profile: pro, serverConfirmed: true }));
  const authTimer = [...page.timers].find(([, timer]) => timer.ms === 20000);
  assert.ok(authTimer);
  page.timers.delete(authTimer[0]);
  authTimer[1].fn();
  assert.match(page.selector('#loadingState .app-shell-title').textContent, /taking longer/);
  await page.auth({ uid: 'owner', email: 'owner@example.test' });
  assert.equal(page.root.dataset.accountStage, 'ready');
  assert.equal(page.mounts, 1);
});
