import { getFirebaseAdmin, jsonResponse, readJson } from './_shared/firebase-admin.js';
import { digest, LOGIN_FAILURE_LIMIT, LOGIN_LOCK_MS, normalizeDriverUsername, verifyDriverPin } from './_shared/driver-domain.js';

const generic = () => jsonResponse({ success: false, error: 'Invalid username or PIN.' }, 401);
const locked = () => jsonResponse({ success: false, error: 'Too many attempts. Please try again in 15 minutes.' }, 429);
const now = () => Date.now();
const active = record => record && record.status === 'ACTIVE';

async function reserveAttempt(db, username, ip) {
  const keys = [digest(`username:${username}`), digest(`username-ip:${username}:${ip}`)];
  const refs = keys.map(key => db.collection('driverLoginAttempts').doc(key));
  let blocked = false;
  await db.runTransaction(async tx => {
    const docs = await Promise.all(refs.map(ref => tx.get(ref)));
    const instant = now();
    blocked = docs.some(doc => doc.exists && Number(doc.data().lockoutUntil || 0) > instant);
    if (blocked) return;
    docs.forEach((doc, index) => {
      const prior = doc.exists && Number(doc.data().windowStartedAt || 0) > instant - LOGIN_LOCK_MS ? Number(doc.data().failedAttemptCount || 0) : 0;
      if (prior >= LOGIN_FAILURE_LIMIT) blocked = true;
      const count = prior + 1;
      tx.set(refs[index], { failedAttemptCount: count, windowStartedAt: prior ? doc.data().windowStartedAt : instant, lastFailedAt: instant, lockoutUntil: count >= LOGIN_FAILURE_LIMIT ? instant + LOGIN_LOCK_MS : 0 });
    });
  });
  return { refs, blocked };
}

export async function authenticateDriver({ admin, db, username, pin, ip = 'unknown' }) {
  const attempt = await reserveAttempt(db, username, ip);
  if (attempt.blocked) return locked();
  const registry = await db.collection('driverUsernames').doc(username).get();
  const identity = registry.exists ? registry.data() : null;
  const uid = identity?.driverId;
  const credentialDoc = uid ? await db.collection('driverCredentials').doc(uid).get() : null;
  const credential = credentialDoc?.exists ? credentialDoc.data() : null;
  // Even absent usernames take the same bcrypt path, reducing username timing leaks.
  const dummyHash = '$2b$12$C6UzMDM.H6dfI/f/IKxGhuoCCRRHAPa54h58UyJDv1oPbXPxTKiKa';
  const pinMatches = await verifyDriverPin(pin, credential?.pinHash || dummyHash);
  if (!pinMatches || !identity || !credential || credential.username !== username || credential.tenantId !== identity.tenantId || !active(credential)) return generic();
  const [driverDoc, profileDoc, tenantDoc, authUser] = await Promise.all([
    db.collection('users').doc(identity.tenantId).collection('drivers').doc(uid).get(),
    db.collection('users').doc(uid).get(),
    db.collection('users').doc(identity.tenantId).get(),
    admin.auth().getUser(uid)
  ]);
  const driver = driverDoc.exists ? driverDoc.data() : null;
  const profile = profileDoc.exists ? profileDoc.data() : null;
  if (!active(driver) || driver.authUid !== uid || driver.tenantId !== identity.tenantId || !tenantDoc.exists || tenantDoc.data().active === false || !profile || profile.role !== 'driver' || profile.active === false || profile.tenantId !== identity.tenantId || authUser.disabled || authUser.customClaims?.role !== 'driver' || authUser.customClaims?.tenantId !== identity.tenantId || authUser.customClaims?.sessionVersion !== profile.sessionVersion) return generic();
  const token = await admin.auth().createCustomToken(uid, { role: 'driver', tenantId: identity.tenantId, driverId: uid, sessionVersion: profile.sessionVersion });
  const timestamp = new Date().toISOString();
  await Promise.all([
    db.collection('users').doc(identity.tenantId).collection('drivers').doc(uid).set({ lastLoginAt: timestamp }, { merge: true }),
    Promise.all(attempt.refs.map(ref => ref.delete()))
  ]);
  return new Response(JSON.stringify({ success: true, token }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export default async req => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  try {
    const body = await readJson(req);
    let username;
    try { username = normalizeDriverUsername(body.username); } catch { return generic(); }
    const pin = typeof body.pin === 'string' ? body.pin : '';
    const admin = getFirebaseAdmin(), db = admin.firestore();
    const ip = String(req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').slice(0, 80);
    return await authenticateDriver({ admin, db, username, pin, ip });
  } catch (error) {
    console.error('Driver login failed:', error.code || error.message);
    return jsonResponse({ success: false, error: 'Driver sign-in is unavailable right now.' }, 503);
  }
};

export { reserveAttempt };
