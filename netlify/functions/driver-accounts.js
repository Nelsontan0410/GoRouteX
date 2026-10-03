import { randomUUID } from 'node:crypto';
import { getFirebaseAdmin, verifyFirebaseUser, jsonResponse, readJson } from './_shared/firebase-admin.js';
import { DriverError, normalizeDriverUsername, validateDriverPin, hashDriverPin, driverEntitlement, newDriverUid, publicDriver, requireOwner } from './_shared/driver-domain.js';

const cleanName = value => String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
const safeUid = value => /^drv_[a-f0-9]{32}$/.test(String(value || ''));
const now = () => new Date().toISOString();

async function accountContext(decoded, db) {
  if (!decoded) throw new DriverError('Sign in required.', 401, 'UNAUTHENTICATED');
  const profileDoc = await db.collection('users').doc(decoded.uid).get();
  const profile = profileDoc.exists ? profileDoc.data() : null;
  const ownerUid = requireOwner(decoded, profile);
  if (!profile) throw new DriverError('Workspace profile unavailable.', 403, 'FORBIDDEN');
  return { ownerUid, profile, decoded };
}
function refs(db, ownerUid, driverUid) {
  return { driver: db.collection('users').doc(ownerUid).collection('drivers').doc(driverUid), credential: db.collection('driverCredentials').doc(driverUid), profile: db.collection('users').doc(driverUid), usage: db.collection('users').doc(ownerUid).collection('driverUsage').doc('current') };
}
async function listed(db, ownerUid) {
  const snapshot = await db.collection('users').doc(ownerUid).collection('drivers').get();
  return snapshot.docs.map(doc => publicDriver({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name));
}
async function getOwned(db, ownerUid, driverUid) {
  if (!safeUid(driverUid)) throw new DriverError('Driver not found.', 404, 'NOT_FOUND');
  const { driver } = refs(db, ownerUid, driverUid);
  const doc = await driver.get();
  if (!doc.exists || doc.data().tenantId !== ownerUid) throw new DriverError('Driver not found.', 404, 'NOT_FOUND');
  return { ref: driver, record: doc.data() };
}
async function createDriver(admin, db, context, body) {
  const displayName = cleanName(body.name);
  if (!displayName) throw new DriverError('Driver name is required.');
  const username = normalizeDriverUsername(body.username);
  validateDriverPin(body.pin, body.confirmPin);
  const active = body.active !== false;
  const uid = newDriverUid();
  const sessionVersion = randomUUID();
  const pinHash = await hashDriverPin(body.pin);
  const { driver, credential, profile, usage } = refs(db, context.ownerUid, uid);
  const registry = db.collection('driverUsernames').doc(username);
  let createdAuth = false;
  let driverOperation = 'firebase-auth-create-user';
  try {
    await admin.auth().createUser({ uid, displayName, disabled: !active });
    createdAuth = true;
    driverOperation = 'firebase-auth-set-claims';
    await admin.auth().setCustomUserClaims(uid, { role: 'driver', tenantId: context.ownerUid, driverId: uid, sessionVersion });
    driverOperation = 'firestore-create-driver-transaction';
    await db.runTransaction(async tx => {
      const [reserved, usageDoc, ownerDoc] = await Promise.all([tx.get(registry), tx.get(usage), tx.get(db.collection('users').doc(context.ownerUid))]);
      if (reserved.exists) throw new DriverError('Username is unavailable.', 409, 'USERNAME_TAKEN');
      if (!ownerDoc.exists || ownerDoc.data().active === false) throw new DriverError('Workspace is inactive.', 403, 'TENANT_INACTIVE');
      const { plan, maxActiveDrivers } = driverEntitlement(ownerDoc.data());
      const count = Number(usageDoc.data()?.activeCount || 0);
      if (active && count >= maxActiveDrivers) throw new DriverError(`Driver limit reached. Your ${plan === 'basic' ? 'Free' : plan === 'goplan' ? 'Go' : 'Pro'} plan supports up to ${maxActiveDrivers} active drivers.`, 409, 'DRIVER_LIMIT');
      const timestamp = now();
      tx.create(registry, { driverId: uid, tenantId: context.ownerUid, createdAt: timestamp });
      tx.create(driver, { id: uid, authUid: uid, tenantId: context.ownerUid, displayName, username, status: active ? 'ACTIVE' : 'INACTIVE', createdAt: timestamp, createdBy: context.ownerUid, updatedAt: timestamp, updatedBy: context.ownerUid });
      tx.create(credential, { authUid: uid, tenantId: context.ownerUid, username, pinHash, status: active ? 'ACTIVE' : 'INACTIVE', updatedAt: timestamp });
      tx.create(profile, { uid, name: displayName, email: '', role: 'driver', tenantId: context.ownerUid, driverId: uid, authMethod: 'pin', active, sessionVersion, createdAt: timestamp });
      tx.set(usage, { activeCount: count + (active ? 1 : 0), updatedAt: timestamp }, { merge: true });
    });
    return { driver: publicDriver({ id: uid, authUid: uid, displayName, username, status: active ? 'ACTIVE' : 'INACTIVE', createdAt: now(), updatedAt: now() }) };
  } catch (error) {
    if (error && typeof error === 'object') error.driverOperation = driverOperation;
    if (createdAuth) { try { await admin.auth().deleteUser(uid); } catch (cleanupError) { console.error('Driver Auth cleanup failed:', cleanupError.code || 'unknown'); } }
    throw error;
  }
}
async function editDriver(db, context, body) {
  const uid = String(body.driverUid || '');
  const { ref, record } = await getOwned(db, context.ownerUid, uid);
  const name = cleanName(body.name);
  if (!name) throw new DriverError('Driver name is required.');
  await ref.set({ displayName: name, updatedAt: now(), updatedBy: context.ownerUid }, { merge: true });
  await db.collection('users').doc(uid).set({ name }, { merge: true });
  return { driver: publicDriver({ ...record, displayName: name }) };
}
async function resetPin(admin, db, context, body) {
  const uid = String(body.driverUid || '');
  await getOwned(db, context.ownerUid, uid);
  validateDriverPin(body.pin, body.confirmPin);
  const pinHash = await hashDriverPin(body.pin);
  const credential = db.collection('driverCredentials').doc(uid);
  const sessionVersion = randomUUID();
  await credential.set({ pinHash, updatedAt: now() }, { merge: true });
  await db.collection('users').doc(uid).set({ sessionVersion }, { merge: true });
  await admin.auth().setCustomUserClaims(uid, { role: 'driver', tenantId: context.ownerUid, driverId: uid, sessionVersion });
  await admin.auth().revokeRefreshTokens(uid);
  return { success: true };
}
async function setStatus(admin, db, context, body) {
  const uid = String(body.driverUid || '');
  const desired = body.active === true ? 'ACTIVE' : 'INACTIVE';
  const { driver, credential, profile, usage } = refs(db, context.ownerUid, uid);
  await getOwned(db, context.ownerUid, uid);
  // Disable Auth before updating Firestore so a deactivated Driver cannot obtain another session.
  if (desired === 'INACTIVE') { await admin.auth().updateUser(uid, { disabled: true }); await admin.auth().revokeRefreshTokens(uid); }
  await db.runTransaction(async tx => {
    const [driverDoc, usageDoc, ownerDoc] = await Promise.all([tx.get(driver), tx.get(usage), tx.get(db.collection('users').doc(context.ownerUid))]);
    if (!driverDoc.exists || driverDoc.data().tenantId !== context.ownerUid) throw new DriverError('Driver not found.', 404, 'NOT_FOUND');
    if (driverDoc.data().status === desired) return;
    const count = Number(usageDoc.data()?.activeCount || 0);
    if (desired === 'ACTIVE') {
      if (!ownerDoc.exists || ownerDoc.data().active === false) throw new DriverError('Workspace is inactive.', 403, 'TENANT_INACTIVE');
      const { plan, maxActiveDrivers } = driverEntitlement(ownerDoc.data());
      if (count >= maxActiveDrivers) throw new DriverError(`Driver limit reached. Your ${plan === 'basic' ? 'Free' : plan === 'goplan' ? 'Go' : 'Pro'} plan supports up to ${maxActiveDrivers} active drivers.`, 409, 'DRIVER_LIMIT');
    }
    const timestamp = now();
    tx.update(driver, { status: desired, updatedAt: timestamp, updatedBy: context.ownerUid, ...(desired === 'INACTIVE' ? { deactivatedAt: timestamp } : {}) });
    tx.update(credential, { status: desired, updatedAt: timestamp });
    tx.update(profile, { active: desired === 'ACTIVE', ...(desired === 'INACTIVE' ? { sessionVersion: randomUUID() } : {}) });
    tx.set(usage, { activeCount: Math.max(0, count + (desired === 'ACTIVE' ? 1 : -1)), updatedAt: timestamp }, { merge: true });
  });
  if (desired === 'ACTIVE') {
    try {
      const profileDoc = await profile.get();
      await admin.auth().setCustomUserClaims(uid, { role: 'driver', tenantId: context.ownerUid, driverId: uid, sessionVersion: profileDoc.data().sessionVersion });
      await admin.auth().updateUser(uid, { disabled: false });
    } catch (error) {
      // Firestore and Firebase Auth cannot share one transaction. Release the slot if enabling Auth fails.
      try {
        await db.runTransaction(async tx => {
          const [driverDoc, usageDoc] = await Promise.all([tx.get(driver), tx.get(usage)]);
          if (driverDoc.data()?.status !== 'ACTIVE') return;
          tx.update(driver, { status: 'INACTIVE', updatedAt: now(), updatedBy: context.ownerUid });
          tx.update(credential, { status: 'INACTIVE', updatedAt: now() });
          tx.update(profile, { active: false, sessionVersion: randomUUID() });
          tx.set(usage, { activeCount: Math.max(0, Number(usageDoc.data()?.activeCount || 0) - 1), updatedAt: now() }, { merge: true });
        });
      } catch (cleanupError) { console.error('Driver activation rollback failed for UID', uid, cleanupError.code); }
      throw error;
    }
  }
  return { success: true };
}

export function classifyDriverServiceFailure(error) {
  const code = String(error?.code || '');
  if (code === 'auth/insufficient-permission') return { status: 503, code: 'AUTH_PERMISSION', error: 'Driver creation needs Firebase Authentication access for the server account. Contact the site administrator.' };
  if (code === '7' || code === 'PERMISSION_DENIED' || code === 'permission-denied') return { status: 503, code: 'STORAGE_PERMISSION', error: 'Driver accounts cannot access cloud storage. Contact the site administrator.' };
  return { status: 503, code: 'SERVICE_UNAVAILABLE', error: 'Driver accounts are temporarily unavailable. Please try again.' };
}

export default async req => {
  try {
    const decoded = await verifyFirebaseUser(req);
    if (!decoded) throw new DriverError('Sign in required.', 401, 'UNAUTHENTICATED');
    const admin = getFirebaseAdmin(), db = admin.firestore();
    const context = await accountContext(decoded, db);
    if (req.method === 'GET') {
      const drivers = await listed(db, context.ownerUid);
      const { plan, maxActiveDrivers } = driverEntitlement(context.profile);
      return jsonResponse({ success: true, drivers, entitlement: { plan, maxActiveDrivers, activeCount: drivers.filter(driver => driver.active).length } });
    }
    if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
    const body = await readJson(req);
    const result = body.action === 'create' ? await createDriver(admin, db, context, body)
      : body.action === 'edit' ? await editDriver(db, context, body)
      : body.action === 'reset-pin' ? await resetPin(admin, db, context, body)
      : body.action === 'status' ? await setStatus(admin, db, context, body)
      : (() => { throw new DriverError('Unknown Driver action.', 404); })();
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    if (error instanceof DriverError) return jsonResponse({ success: false, error: error.message, code: error.code }, error.status);
    const failure = classifyDriverServiceFailure(error);
    console.error('Driver account service failed:', { operation: error.driverOperation || 'account-request', code: error.code || 'unknown' });
    return jsonResponse({ success: false, error: failure.error, code: failure.code }, failure.status);
  }
};

export { createDriver, setStatus, resetPin, listed };
