import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { driverEntitlement, normalizeDriverPlan } from '../netlify/functions/_shared/driver-domain.js';

const contextSource = readFileSync(new URL('../account-context.js', import.meta.url), 'utf8');
const productSource = readFileSync(new URL('../route-planner-product.js', import.meta.url), 'utf8');
const files = Object.fromEntries(['app.html', 'dispatch.html', 'settings.html', 'order-hub.html', 'app-shell.js', 'dispatch/dispatch-page.js', 'orders/order-hub.js', 'settings/settings-page.js', 'route-storage.js', 'netlify/functions/dispatch.js'].map(name => [name, readFileSync(new URL('../' + name, import.meta.url), 'utf8')]));

function setup(profiles) {
  let current = null;
  let reads = 0;
  let writes = 0;
  const window = {
    FirebaseApp: { auth: {
      getCurrentUser: () => current,
      updateProfile: async () => { writes++; },
      ensureProfile: async user => {
        reads++;
        const profile = profiles[user.uid];
        return profile instanceof Error ? { success: false, error: profile.message } : { success: true, profile };
      }
    } }
  };
  const sandbox = vm.createContext({ window, Date, Error, Object, String });
  vm.runInContext(productSource, sandbox);
  vm.runInContext(contextSource, sandbox);
  return { window, setUser(user) { current = user; }, get reads() { return reads; }, get writes() { return writes; } };
}

const pro = { name: 'logistic-sin', role: 'admin', productPlanKey: 'proplan', productPlan: 'proplan', planStatus: 'active', billingStatus: 'active' };
const basic = { name: 'Fresh Owner', role: 'admin', productPlanKey: 'basic', planStatus: 'trial', billingStatus: 'basic' };

test('one server profile yields the same name and Pro plan on all admin pages', async () => {
  const harness = setup({ owner: pro });
  const user = { uid: 'owner', email: 'owner@example.test', displayName: 'Auth Name' };
  harness.setUser(user);
  const [first, second] = await Promise.all([harness.window.GoRouteXAccountContext.load(user), harness.window.GoRouteXAccountContext.load(user)]);
  assert.equal(harness.reads, 1);
  assert.equal(first, second);
  assert.deepEqual([first.uid, first.tenantId, first.displayName, first.planId, first.planLabel], ['owner', 'owner', 'logistic-sin', 'proplan', 'Pro Plan']);
  const name = {}, plan = {};
  harness.window.GoRouteXAccountContext.render(first, name, plan);
  assert.deepEqual([name.textContent, plan.textContent], ['logistic-sin', 'Pro Plan']);
  assert.deepEqual(driverEntitlement(first.profile), { plan: 'proplan', maxActiveDrivers: 10 });
  assert.equal(harness.window.RoutePlannerProduct.getStorageModeForPlan(first.planId), 'cloud');
  for (const page of ['app.html', 'dispatch.html', 'settings.html', 'order-hub.html']) assert.match(files[page], /account-context\.js/);
  for (const page of ['app-shell.js', 'orders/order-hub.js', 'settings/settings-page.js']) assert.match(files[page], /GoRouteXAccountContext\.loadIdentity\(user\)/);
  assert.match(files['dispatch/dispatch-page.js'], /GoRouteXAccountContext\.loadIdentity\(user\)/);
});

test('direct load, refresh, logout and account switch never reuse another user plan', async () => {
  const harness = setup({ owner: pro, fresh: basic });
  const owner = { uid: 'owner', email: 'owner@example.test' };
  const fresh = { uid: 'fresh', email: 'fresh@example.test' };
  harness.setUser(owner);
  assert.equal((await harness.window.GoRouteXAccountContext.load(owner)).planId, 'proplan');
  harness.window.GoRouteXAccountContext.clear();
  assert.equal((await harness.window.GoRouteXAccountContext.load(owner)).planId, 'proplan');
  harness.window.GoRouteXAccountContext.clear();
  harness.setUser(fresh);
  const next = await harness.window.GoRouteXAccountContext.load(fresh);
  assert.deepEqual([next.uid, next.displayName, next.planLabel], ['fresh', 'Fresh Owner', 'Basic']);
  assert.deepEqual(driverEntitlement(next.profile), { plan: 'basic', maxActiveDrivers: 1 });
  assert.equal(harness.window.currentUserProfile.name, 'Fresh Owner');
  assert.equal(harness.reads, 3);
});

test('profile read failure and missing plan fail closed instead of showing Basic', async () => {
  const harness = setup({ bad: new Error('permission-denied'), incomplete: { name: 'Incomplete', role: 'admin', productPlanKey: 'unknown-plan' } });
  const user = { uid: 'bad', email: 'bad@example.test' };
  harness.setUser(user);
  await assert.rejects(harness.window.GoRouteXAccountContext.load(user), /permission-denied/);
  assert.equal(harness.window.GoRouteXAccountContext.get(), null);
  const name = {}, plan = {};
  harness.window.GoRouteXAccountContext.render(null, name, plan);
  assert.deepEqual([name.textContent, plan.textContent], ['Account unavailable', 'Plan unavailable']);
  harness.setUser({ uid: 'incomplete', email: 'incomplete@example.test' });
  await assert.rejects(harness.window.GoRouteXAccountContext.load(harness.window.FirebaseApp.auth.getCurrentUser()), /Plan unavailable/);
  assert.doesNotMatch(files['dispatch.html'], /id="dispatchDisplayName">User|id="dispatchCurrentPlan">Basic/);
  assert.match(files['route-storage.js'], /Account plan unavailable/);
});

test('trusted server authorization ignores client-provided plan and tenant', () => {
  assert.match(files['netlify/functions/dispatch.js'], /verifyFirebaseUser\(req\)/);
  assert.match(files['netlify/functions/dispatch.js'], /db\.collection\('users'\)\.doc\(uid\)\.get\(\)/);
  assert.match(files['netlify/functions/dispatch.js'], /requireOwner\(decoded, profile\)/);
  assert.doesNotMatch(files['netlify/functions/dispatch.js'], /body\.planKey\b|body\.productPlan\b|body\.tenantId\b/);
});


test('server Driver plan matches the established browser plan for current and legacy profiles', () => {
  const harness = setup({});
  const profiles = [
    pro, basic,
    { name: 'Go', productPlanKey: 'goplan', billingStatus: 'active' },
    { name: 'Legacy Go', planKey: 'basic', planStatus: 'active' },
    { name: 'Legacy Pro', planKey: 'pro', planStatus: 'active' },
    { name: 'Expired Pro', productPlanKey: 'proplan', planStatus: 'expired' },
    { name: 'Canceled Go', productPlanKey: 'goplan', planStatus: 'active', billingStatus: 'canceled' },
    { name: 'Old Pro expiry', productPlanKey: 'proplan', subscriptionExpiresAt: '2020-01-01T00:00:00Z' }
  ];
  for (const profile of profiles) {
    const client = harness.window.RoutePlannerProduct.getCurrentPlan(profile);
    const server = driverEntitlement(profile).plan;
    assert.equal(server, client, profile.name);
    assert.equal(normalizeDriverPlan(profile), ['Expired Pro', 'Canceled Go', 'Old Pro expiry'].includes(profile.name) ? (profile.name === 'Canceled Go' ? 'goplan' : 'proplan') : client);
  }
});


test('server-confirmed self-owned legacy admin stays in its own UID workspace without migration writes', async () => {
  const profile = { ...pro, name: 'Legacy Owner', uid: 'owner', tenantId: 'historical-tenant' };
  const harness = setup({ owner: profile });
  const user = { uid: 'owner', displayName: 'Auth Name' };
  harness.setUser(user);
  const first = await harness.window.GoRouteXAccountContext.load(user);
  assert.deepEqual([first.uid, first.workspaceId, first.tenantId, first.role, first.displayName, first.planLabel],
    ['owner', 'owner', 'owner', 'admin', 'Legacy Owner', 'Pro Plan']);
  assert.equal(profile.tenantId, 'historical-tenant', 'legacy metadata is not silently written or changed');
  assert.equal(harness.writes, 0);
  harness.window.GoRouteXAccountContext.clear();
  const second = await harness.window.GoRouteXAccountContext.load(user);
  assert.equal(second.workspaceId, 'owner');
  assert.equal(harness.reads, 2, 'one logical profile read per independent bootstrap');
  assert.equal(harness.writes, 0, 'subsequent boots are also read-only');
});

test('current canonical Owner and documented missing-tenant legacy Owner resolve identically', async () => {
  for (const profile of [
    { ...pro, tenantId: 'owner' },
    { ...pro }
  ]) {
    const harness = setup({ owner: profile });
    const user = { uid: 'owner' };
    harness.setUser(user);
    const identity = await harness.window.GoRouteXAccountContext.loadIdentity(user);
    assert.deepEqual([identity.workspaceId, identity.tenantId, identity.role], ['owner', 'owner', 'admin']);
    assert.equal(harness.writes, 0);
  }
});

test('foreign, malformed, inactive, unknown-role and Driver shapes never gain Owner access', async () => {
  const selfOwned = { ...pro, uid: 'owner', tenantId: 'foreign-tenant' };
  const cases = [
    ['foreign tenant without self UID', 'owner', { ...pro, tenantId: 'foreign-tenant' }],
    ['foreign embedded UID', 'owner', { ...selfOwned, uid: 'another-owner' }],
    ['explicit foreign workspace', 'owner', { ...selfOwned, workspaceId: 'foreign-tenant' }],
    ['explicit foreign owner', 'owner', { ...selfOwned, ownerUid: 'foreign-tenant' }],
    ['multi-workspace membership', 'owner', { ...selfOwned, memberships: [{ workspaceId: 'foreign-tenant' }] }],
    ['malformed tenant field', 'owner', { ...pro, tenantId: { id: 'owner' } }],
    ['inactive owner', 'owner', { ...selfOwned, active: false }],
    ['manager without membership', 'owner', { ...pro, role: 'manager' }],
    ['unknown role', 'owner', { ...pro, role: 'superuser', tenantId: 'owner' }],
    ['Driver role', 'owner', { ...selfOwned, role: 'driver' }],
    ['managed Driver UID', 'drv_owner', { ...pro, uid: 'drv_owner', tenantId: 'drv_owner' }],
    ['Driver identifier marker', 'owner', { ...selfOwned, driverId: 'drv_other' }],
    ['Driver PIN marker', 'owner', { ...selfOwned, authMethod: 'pin' }],
    ['Driver session marker', 'owner', { ...selfOwned, sessionVersion: 1 }]
  ];
  for (const [label, uid, profile] of cases) {
    const harness = setup({ [uid]: profile });
    const user = { uid };
    harness.setUser(user);
    await assert.rejects(harness.window.GoRouteXAccountContext.load(user), /Workspace (membership|role) is missing or invalid/, label);
    assert.equal(harness.window.GoRouteXAccountContext.get(), null, label);
    assert.equal(harness.writes, 0, label);
  }
});

test('cached identity cannot authorize a different tenant before server confirmation', async () => {
  const harness = setup({});
  const user = { uid: 'owner' };
  const calls = [];
  harness.setUser(user);
  harness.window.FirebaseApp.auth.loadProfile = async (_user, options) => {
    calls.push(options?.source || 'default');
    return options?.source === 'server'
      ? { success: true, profile: { ...pro, uid: 'other', tenantId: 'foreign' }, fromCache: false, serverConfirmed: true }
      : { success: true, profile: { ...pro, tenantId: 'owner' }, fromCache: true, serverConfirmed: false };
  };
  await assert.rejects(harness.window.GoRouteXAccountContext.load(user), /Workspace membership is missing or invalid/);
  assert.deepEqual(calls, ['default', 'server']);
  assert.equal(harness.window.GoRouteXAccountContext.getIdentity(), null);
  assert.equal(harness.writes, 0);
});
