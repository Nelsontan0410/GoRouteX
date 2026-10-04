import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DriverError, driverEntitlement, requireBillingOwner, requireOwner, resolveTrustedWorkspaceIdentity } from '../netlify/functions/_shared/driver-domain.js';
import { verifyFirebaseUser } from '../netlify/functions/_shared/firebase-admin.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const owner = { uid: 'owner-a', name: 'Owner', role: 'admin', active: true, productPlanKey: 'proplan' };
const auth = { uid: 'owner-a' };
const legacy = { ...owner, tenantId: 'historical-metadata' };

function clientIdentity(user, profile) {
  const window = { FirebaseApp: { auth: { getCurrentUser: () => user, loadProfile: async () => ({ success: true, profile, fromCache: false, serverConfirmed: true }) } } };
  const sandbox = vm.createContext({ window, Date, Error, Object, String });
  vm.runInContext(read('account-context.js'), sandbox);
  return window.GoRouteXAccountContext.loadIdentity(user);
}

function rejection(fn, code) {
  assert.throws(fn, error => error instanceof DriverError && error.status === 403 && error.code === code);
}

test('canonical and proven legacy Owner profiles both resolve only to the authenticated UID workspace', async () => {
  for (const profile of [
    { ...owner, tenantId: auth.uid },
    legacy,
    { ...owner, tenantId: undefined }
  ]) {
    const identity = resolveTrustedWorkspaceIdentity(auth, profile);
    assert.deepEqual([identity.uid, identity.workspaceId, identity.ownerUid, identity.role], ['owner-a', 'owner-a', 'owner-a', 'admin']);
    assert.equal(requireOwner(auth, profile), 'owner-a');
    assert.equal(requireBillingOwner(auth, profile), 'owner-a');
    const client = await clientIdentity(auth, profile);
    assert.deepEqual([client.uid, client.workspaceId, client.tenantId, client.role], ['owner-a', 'owner-a', 'owner-a', 'admin']);
  }
  assert.equal(resolveTrustedWorkspaceIdentity(auth, legacy).legacyOwnerCompatibility, true);
  assert.equal(resolveTrustedWorkspaceIdentity(auth, { ...owner, tenantId: auth.uid }).legacyOwnerCompatibility, false);
});

test('legacy tenant metadata never becomes the workspace key or a client override', () => {
  const decoded = { ...auth, tenantId: 'foreign-workspace' };
  const profile = { ...legacy, productPlanKey: 'basic' };
  const identity = resolveTrustedWorkspaceIdentity(decoded, profile);
  assert.equal(identity.workspaceId, 'owner-a');
  assert.equal(requireBillingOwner(decoded, profile), 'owner-a');
  assert.deepEqual(driverEntitlement(profile), { plan: 'basic', maxActiveDrivers: 1 });
  assert.deepEqual(driverEntitlement({ ...profile, productPlanKey: 'goplan' }), { plan: 'goplan', maxActiveDrivers: 3 });
  assert.deepEqual(driverEntitlement({ ...profile, productPlanKey: 'proplan' }), { plan: 'proplan', maxActiveDrivers: 10 });
  assert.equal(profile.tenantId, 'historical-metadata');
});

test('Owner resolver fails closed for Driver, inactive, unknown role and foreign membership shapes', async () => {
  const cases = [
    [{ uid: 'drv_123' }, { ...owner, uid: 'drv_123', tenantId: 'drv_123' }, 'ROLE_INVALID'],
    [{ ...auth, role: 'driver' }, { ...owner, tenantId: 'owner-a' }, 'ROLE_INVALID'],
    [auth, { ...owner, driverId: 'drv_123', tenantId: 'owner-a' }, 'ROLE_INVALID'],
    [auth, { ...owner, authMethod: 'pin', tenantId: 'owner-a' }, 'ROLE_INVALID'],
    [auth, { ...owner, sessionVersion: 1, tenantId: 'owner-a' }, 'ROLE_INVALID'],
    [auth, { ...owner, active: false, tenantId: 'owner-a' }, 'ACCOUNT_INACTIVE'],
    [auth, { ...owner, role: 'stranger', tenantId: 'owner-a' }, 'ROLE_INVALID'],
    [auth, { ...legacy, uid: 'owner-b' }, 'WORKSPACE_INVALID'],
    [auth, { ...legacy, workspaceId: 'owner-b' }, 'WORKSPACE_INVALID'],
    [auth, { ...legacy, memberships: [{ ownerUid: 'owner-b' }] }, 'WORKSPACE_INVALID'],
    [auth, { ...owner, tenantId: { id: 'owner-a' } }, 'WORKSPACE_INVALID'],
    [auth, { ...owner, role: 'dispatcher', tenantId: 'owner-b' }, 'WORKSPACE_INVALID'],
    [auth, { ...owner, tenantId: undefined, ownerUid: 'owner-b' }, 'WORKSPACE_INVALID'],
    [auth, null, 'WORKSPACE_INVALID']
  ];
  for (const [decoded, profile, code] of cases) {
    rejection(() => resolveTrustedWorkspaceIdentity(decoded, profile), code);
    if (profile && decoded.role !== 'driver') await assert.rejects(clientIdentity(decoded, profile));
  }
  assert.throws(() => resolveTrustedWorkspaceIdentity(null, owner), error => error.status === 401 && error.code === 'UNAUTHENTICATED');
});

test('Billing guard accepts legacy Owner while excluding operations roles and Drivers', () => {
  assert.equal(requireBillingOwner(auth, legacy), 'owner-a');
  assert.equal(requireOwner(auth, { ...owner, role: 'dispatcher', tenantId: 'owner-a' }), 'owner-a');
  rejection(() => requireBillingOwner(auth, { ...owner, role: 'dispatcher', tenantId: 'owner-a' }), 'ROLE_INVALID');
  rejection(() => requireBillingOwner({ uid: 'drv_123', role: 'driver' }, { ...owner, tenantId: 'drv_123' }), 'ROLE_INVALID');
});

test('all Owner server entry points use the shared guard after one direct profile lookup', () => {
  const billing = ['create-stripe-checkout.js', 'billing-sync.js', 'billing-customer-portal.js', 'billing-cancel-subscription.js'];
  for (const file of billing) {
    const source = read(`netlify/functions/${file}`);
    assert.match(source, /verifyFirebaseUser\(req\)/, file);
    assert.match(source, /requireBillingOwner\(/, file);
    assert.equal((source.match(/\.doc\(user\.uid\)\.get\(\)|\.doc\(decodedToken\.uid\)\.get\(\)|userRef\.get\(\)/g) || []).length > 0, true, file);
  }
  const driver = read('netlify/functions/driver-accounts.js');
  const dispatch = read('netlify/functions/dispatch.js');
  assert.match(driver, /const ownerUid = requireOwner\(decoded, profile\)/);
  assert.match(dispatch, /requireOwner\(decoded, profile\)/);
  assert.match(dispatch, /db\.collection\('users'\)\.doc\(uid\)\.get\(\)/);
  assert.doesNotMatch(driver, /body\.tenantId\b|body\.planKey\b/);
  assert.doesNotMatch(dispatch, /body\.tenantId\b|body\.productPlan\b/);
  assert.doesNotMatch(read('netlify/functions/_shared/driver-domain.js').split('export function resolveTrustedWorkspaceIdentity')[1].split('export function requireOwner')[0], /\.set\(|\.update\(|\.create\(/);
  assert.doesNotMatch(driver.split('async function listed')[1].split('async function getOwned')[0], /getUser\(/);
});


test('invalid and revoked Firebase credentials remain unauthenticated while service outages propagate', async () => {
  const req = new Request('https://local.test/owner', { headers: { authorization: 'Bearer opaque-test-token' } });
  let calls = 0;
  const admin = code => ({ auth: () => ({ async verifyIdToken() { calls++; const error = Error('verification failed'); error.code = code; throw error; } }) });
  assert.equal(await verifyFirebaseUser(new Request('https://local.test/owner'), admin('auth/invalid-id-token')), null);
  assert.equal(calls, 0, 'missing credentials never call Firebase Auth');
  for (const code of ['auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked']) {
    assert.equal(await verifyFirebaseUser(req, admin(code)), null);
  }
  await assert.rejects(verifyFirebaseUser(req, admin('unavailable')), /verification failed/);
});

test('Driver and Dispatch endpoints return 401 without initializing Firebase Admin for missing credentials', async () => {
  const driverHandler = (await import('../netlify/functions/driver-accounts.js')).default;
  const dispatchHandler = (await import('../netlify/functions/dispatch.js')).default;
  const driverResponse = await driverHandler(new Request('https://local.test/.netlify/functions/driver-accounts'));
  const dispatchResponse = await dispatchHandler(new Request('https://local.test/.netlify/functions/dispatch?action=drivers'));
  assert.equal(driverResponse.status, 401);
  assert.equal((await driverResponse.json()).code, 'UNAUTHENTICATED');
  assert.equal(dispatchResponse.status, 401);
});

test('JSON responses from functions are never cached', async () => {
  const { jsonResponse } = await import('../netlify/functions/_shared/firebase-admin.js');
  assert.equal(jsonResponse({ success: true }).headers.get('Cache-Control'), 'no-store');
});
