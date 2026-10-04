// Firestore security rules tests. Run with: pnpm test:rules (needs Java for the emulator).
import test, { before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch, collection } from 'firebase/firestore';

let env;
const OWNER = 'owner1';
const DRIVER = 'drv_1';
const driverClaims = { role: 'driver', driverId: DRIVER, tenantId: OWNER, sessionVersion: 'v1' };
const owner = () => env.authenticatedContext(OWNER).firestore();
const driver = () => env.authenticatedContext(DRIVER, driverClaims).firestore();
const days = (n) => Timestamp.fromDate(new Date(Date.now() + n * 24 * 60 * 60 * 1000));

// Exactly what firebase-config.js ensureInitialProfileForNewAccount writes.
const signupProfile = (uid) => ({
  name: 'Nelson', email: 'n@example.com', createdAt: serverTimestamp(), trialEndsAt: days(7),
  planStatus: 'trial', planName: 'trial', planKey: 'trial', productPlan: 'basic', productPlanKey: 'basic',
  role: 'admin', tenantId: uid, teamMembersCount: 1, billingStatus: 'basic'
});

// Subcollections the workspace owner's client writes (see AUDIT_REPORT.md D3 inventory).
const OWNER_COLLECTIONS = ['stopsCache', 'stopsChunks', 'routes', 'plannedRoutes', 'operationSnapshots', 'sessions', 'settings',
  'gpsTracking', 'activePlannedRoutes', 'customers', 'orders', 'importProfiles', 'importBatches', 'orderCustomers', 'orderContacts', 'vehicles'];

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-goroutex', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${OWNER}`), { ...signupProfile(OWNER), createdAt: Timestamp.now(), productPlanKey: 'proplan', planStatus: 'active' });
    await setDoc(doc(db, `users/${DRIVER}`), { role: 'driver', active: true, tenantId: OWNER, driverId: DRIVER, sessionVersion: 'v1' });
    await setDoc(doc(db, 'dispatchRoutes/route1'), { assignedDriverUid: DRIVER, dispatchOwnerUid: OWNER });
    await setDoc(doc(db, 'dispatchRoutes/other'), { assignedDriverUid: 'drv_someone_else', dispatchOwnerUid: OWNER });
  });
});

// ---- Profile document: legitimate client behaviour ----
test('sign-up creates the profile with the exact client payload', async () => {
  await assertSucceeds(setDoc(doc(env.authenticatedContext('new1').firestore(), 'users/new1'), signupProfile('new1')));
});
test('owner can read own profile; nobody else can', async () => {
  await assertSucceeds(getDoc(doc(owner(), `users/${OWNER}`)));
  await assertFails(getDoc(doc(env.authenticatedContext('stranger').firestore(), `users/${OWNER}`)));
});
test('owner can refresh lastLogin', async () => {
  await assertSucceeds(setDoc(doc(owner(), `users/${OWNER}`), { lastLogin: serverTimestamp() }, { merge: true }));
});

// ---- Profile document: attacks ----
for (const [field, value] of [
  ['subscriptionExpiresAt', days(3650)], ['accessExpiresAt', days(3650)], ['planExpiresAt', days(3650)],
  ['productPlanKey', 'goplan'], ['permanentPlan', true], ['active', true], ['sessionVersion', 'x'],
  ['pendingPlanKey', 'proplan'], ['someNewField', 'anything']
]) {
  test(`sign-up cannot add ${field}`, async () => {
    await assertFails(setDoc(doc(env.authenticatedContext('new1').firestore(), 'users/new1'), { ...signupProfile('new1'), [field]: value }));
  });
  test(`owner cannot later set ${field}`, async () => {
    await assertFails(setDoc(doc(owner(), `users/${OWNER}`), { [field]: value }, { merge: true }));
  });
}
test('sign-up cannot extend the trial, backdate createdAt, join another tenant or pick a role', async () => {
  const db = env.authenticatedContext('new1').firestore();
  await assertFails(setDoc(doc(db, 'users/new1'), { ...signupProfile('new1'), trialEndsAt: days(3650) }));
  await assertFails(setDoc(doc(db, 'users/new1'), { ...signupProfile('new1'), createdAt: Timestamp.fromDate(new Date('2020-01-01')) }));
  await assertFails(setDoc(doc(db, 'users/new1'), { ...signupProfile('new1'), tenantId: OWNER }));
  await assertFails(setDoc(doc(db, 'users/new1'), { ...signupProfile('new1'), role: 'driver' }));
  await assertFails(setDoc(doc(db, 'users/new1'), { ...signupProfile('new1'), teamMembersCount: 999 }));
});
test('a driver cannot create or edit a workspace profile', async () => {
  await assertFails(setDoc(doc(env.authenticatedContext('drv_new', driverClaims).firestore(), 'users/drv_new'), signupProfile('drv_new')));
  await assertFails(setDoc(doc(driver(), `users/${DRIVER}`), { lastLogin: serverTimestamp() }, { merge: true }));
});
test('profiles cannot be deleted', async () => {
  await assertFails(deleteDoc(doc(owner(), `users/${OWNER}`)));
});

// ---- Subcollections ----
for (const name of OWNER_COLLECTIONS) {
  test(`owner can write and delete ${name}`, async () => {
    const ref = doc(owner(), `users/${OWNER}/${name}/doc1`);
    await assertSucceeds(setDoc(ref, { value: 1 }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });
}
test('owner can write nested GPS points', async () => {
  await assertSucceeds(setDoc(doc(owner(), `users/${OWNER}/gpsTracking/2026-10-04/points/p1`), { lat: 1.3, lng: 103.8 }));
});
test('owner cannot write unknown or server-only subcollections', async () => {
  for (const name of ['somethingNew', 'paymentRequests', 'billingEvents', 'cancellationRequests', 'drivers', 'driverUsage']) {
    await assertFails(setDoc(doc(owner(), `users/${OWNER}/${name}/doc1`), { value: 1 }));
  }
});
test('other users cannot touch the workspace subcollections', async () => {
  await assertFails(getDoc(doc(env.authenticatedContext('stranger').firestore(), `users/${OWNER}/orders/o1`)));
  await assertFails(setDoc(doc(env.authenticatedContext('stranger').firestore(), `users/${OWNER}/orders/o1`), { value: 1 }));
});
test('a driver cannot use owner-only subcollections in its own workspace', async () => {
  await assertFails(setDoc(doc(driver(), `users/${DRIVER}/stopsCache/main`), { value: 1 }));
  await assertFails(setDoc(doc(driver(), `users/${DRIVER}/orders/o1`), { executionStatus: 'DELIVERED' }));
});
test('top-level collections are closed to clients', async () => {
  await assertFails(getDoc(doc(owner(), 'dispatchRoutes/route1')));
  await assertFails(setDoc(doc(owner(), 'routePlanUsage/x'), { count: 0 }));
});

// ---- Driver flows (must keep working) ----
test('driver tracks GPS for an assigned route; points must match the session route', async () => {
  const db = driver();
  const batch = writeBatch(db);
  batch.set(doc(db, `users/${DRIVER}/tracking_sessions/s1/points/p1`), { routeId: 'route1', lat: 1, lng: 2 });
  batch.set(doc(db, `users/${DRIVER}/tracking_sessions/s1`), { routeId: 'route1' }, { merge: true });
  batch.set(doc(db, `users/${DRIVER}/drivers_live/${DRIVER}`), { routeId: 'route1' }, { merge: true });
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(db, `users/${DRIVER}/tracking_sessions/s1/points/p2`), { routeId: 'other', lat: 1, lng: 2 }));
  await assertFails(setDoc(doc(db, `users/${DRIVER}/tracking_sessions/s2`), { routeId: 'other' }));
});
test('driver writes execution and proof of delivery for an assigned route only', async () => {
  await assertSucceeds(setDoc(doc(driver(), `users/${DRIVER}/driverExecutions/route1`), { stops: [] }));
  await assertSucceeds(setDoc(doc(driver(), `users/${DRIVER}/driverPods/pod1`), { routeId: 'route1' }));
  await assertFails(setDoc(doc(driver(), `users/${DRIVER}/driverExecutions/other`), { stops: [] }));
});
test('a revoked driver session (stale sessionVersion) is refused', async () => {
  const stale = env.authenticatedContext(DRIVER, { ...driverClaims, sessionVersion: 'old' }).firestore();
  await assertFails(setDoc(doc(stale, `users/${DRIVER}/driverExecutions/route1`), { stops: [] }));
});
test('driver reads only its own assigned history', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${DRIVER}/history/h1`), { assignedDriverUid: DRIVER });
  });
  await assertSucceeds(getDoc(doc(driver(), `users/${DRIVER}/history/h1`)));
  await assertFails(setDoc(doc(driver(), `users/${DRIVER}/history/h2`), { assignedDriverUid: DRIVER }));
});
test('owner writes history and reads live driver positions', async () => {
  await assertSucceeds(setDoc(doc(owner(), `users/${OWNER}/history/h1`), { routes: [] }));
  await assertSucceeds(getDoc(doc(owner(), `users/${OWNER}/drivers_live/x`)));
});
