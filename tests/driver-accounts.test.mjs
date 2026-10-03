import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDriverUsername, validateDriverPin, hashDriverPin, verifyDriverPin, driverEntitlement, publicDriver, requireOwner } from '../netlify/functions/_shared/driver-domain.js';
import { createDriver, setStatus, resetPin, listed, classifyDriverServiceFailure } from '../netlify/functions/driver-accounts.js';
import { reserveAttempt, authenticateDriver } from '../netlify/functions/driver-login.js';

class MemoryFirestore {
  constructor() { this.data = new Map(); this.tail = Promise.resolve(); }
  collection(path) { return new Collection(this, path); }
  async runTransaction(action) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const writes = [];
      const tx = {
        get: ref => ref.get(),
        create: (ref, value) => writes.push(() => { if (this.data.has(ref.path)) throw Error('already exists'); this.data.set(ref.path, structuredClone(value)); }),
        update: (ref, value) => writes.push(() => { if (!this.data.has(ref.path)) throw Error('not found'); this.data.set(ref.path, { ...this.data.get(ref.path), ...structuredClone(value) }); }),
        set: (ref, value, options) => writes.push(() => this.data.set(ref.path, options?.merge ? { ...this.data.get(ref.path), ...structuredClone(value) } : structuredClone(value)))
      };
      const result = await action(tx);
      for (const write of writes) write();
      return result;
    } finally { release(); }
  }
}
class Collection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`); }
  async get() {
    const prefix = this.path + '/';
    const docs = [...this.db.data.keys()].filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/')).map(key => new Ref(this.db, key)).map(ref => ({ id: ref.path.slice(prefix.length), data: () => structuredClone(this.db.data.get(ref.path)) }));
    return { docs };
  }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
  async get() { const data = this.db.data.get(this.path); return { exists: Boolean(data), data: () => data ? structuredClone(data) : undefined }; }
  async set(value, options) { this.db.data.set(this.path, options?.merge ? { ...this.db.data.get(this.path), ...structuredClone(value) } : structuredClone(value)); }
  async delete() { this.db.data.delete(this.path); }
}
function fakeAdmin() {
  const users = new Map(), tokens = [];
  return { users, tokens, auth: () => ({
    async createUser(input) { users.set(input.uid, { ...input }); },
    async setCustomUserClaims(uid, claims) { users.get(uid).customClaims = claims; },
    async deleteUser(uid) { users.delete(uid); },
    async updateUser(uid, changes) { Object.assign(users.get(uid), changes); },
    async getUser(uid) { return users.get(uid); },
    async createCustomToken(uid, claims) { tokens.push({ uid, claims }); return `test-token-${uid}`; },
    async revokeRefreshTokens() {}
  }) };
}
function context(uid = 'owner-a', plan = 'basic') {
  const db = new MemoryFirestore(), admin = fakeAdmin(), profile = { role: 'admin', productPlanKey: plan, active: true };
  db.data.set(`users/${uid}`, profile);
  return { db, admin, owner: { ownerUid: uid, profile }, profile };
}
function input(username = 'ahmad01', pin = '00123456') { return { name: 'Ahmad', username, pin, confirmPin: pin, active: true }; }

test('username and PIN validation preserve leading zeros and reject lookalikes', async () => {
  assert.equal(normalizeDriverUsername('  Ahmad01  '), 'ahmad01');
  for (const name of ['ab', 'a'.repeat(21), 'has space', 'аhmad', 'bad-name']) assert.throws(() => normalizeDriverUsername(name));
  for (const pin of ['1234', '123456789', 'abcdefgh', '1234abcd', 12345678]) assert.throws(() => validateDriverPin(pin));
  assert.throws(() => validateDriverPin('00123456', '00123457'), /confirmation/);
  const hash = await hashDriverPin('00123456');
  assert.ok(hash.startsWith('$2'));
  assert.equal(await verifyDriverPin('00123456', hash), true);
  assert.equal(await verifyDriverPin('12345678', hash), false);
});

test('free, Go, Pro and unknown plans have conservative active Driver limits', () => {
  for (const [plan, limit] of [['basic', 1], ['goplan', 3], ['proplan', 10], ['unknown', 1]]) assert.equal(driverEntitlement({ productPlanKey: plan }).maxActiveDrivers, limit);
  assert.equal(driverEntitlement({ productPlanKey: 'proplan', planStatus: 'expired' }).maxActiveDrivers, 1);
});

test('creation stores a separate bcrypt hash, only safe public data, and enforces global uniqueness across tenants', async () => {
  const { db, admin, owner } = context();
  const created = await createDriver(admin, db, owner, input('Ahmad01'));
  const uid = created.driver.uid;
  assert.equal(created.driver.username, 'ahmad01');
  assert.equal(created.driver.pinHash, undefined);
  assert.deepEqual(Object.keys(db.data.get('driverUsernames/ahmad01')).sort(), ['createdAt', 'driverId', 'tenantId']);
  const credential = db.data.get(`driverCredentials/${uid}`);
  assert.equal(credential.pinHash.includes('00123456'), false);
  assert.equal(await verifyDriverPin('00123456', credential.pinHash), true);
  assert.equal(db.data.get(`users/owner-a/drivers/${uid}`).pinHash, undefined);
  assert.equal(db.data.get(`users/${uid}`).pinHash, undefined);
  assert.equal(admin.users.get(uid).customClaims.tenantId, 'owner-a');
  db.data.set('users/owner-b', { role: 'admin', productPlanKey: 'goplan', active: true });
  await assert.rejects(() => createDriver(admin, db, { ownerUid: 'owner-b' }, input('AHMAD01')), /Username is unavailable/);
  assert.equal(admin.users.size, 1);
});

test('simultaneous case variants reserve only one global username', async () => {
  const { db, admin, owner } = context('owner-a', 'goplan');
  const results = await Promise.allSettled([createDriver(admin, db, owner, input('Ahmad01')), createDriver(admin, db, owner, input('ahmad01'))]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(admin.users.size, 1);
  assert.equal((await listed(db, 'owner-a')).length, 1);
});

test('active quota blocks creation/reactivation and inactive history remains visible', async () => {
  const { db, admin, owner } = context();
  const first = await createDriver(admin, db, owner, input());
  await assert.rejects(() => createDriver(admin, db, owner, input('jason88')), /Driver limit reached/);
  await setStatus(admin, db, owner, { driverUid: first.driver.uid, active: false });
  const second = await createDriver(admin, db, owner, input('jason88'));
  assert.equal((await listed(db, 'owner-a')).length, 2);
  assert.equal((await listed(db, 'owner-a')).filter(driver => driver.active).length, 1);
  await assert.rejects(() => setStatus(admin, db, owner, { driverUid: first.driver.uid, active: true }), /Driver limit reached/);
  await setStatus(admin, db, owner, { driverUid: second.driver.uid, active: false });
  await setStatus(admin, db, owner, { driverUid: first.driver.uid, active: true });
  assert.equal(admin.users.get(first.driver.uid).disabled, false);
});

test('owner cannot change another tenant Driver or elevate Driver credentials', async () => {
  const { db, admin, owner } = context();
  const created = await createDriver(admin, db, owner, input());
  await assert.rejects(() => setStatus(admin, db, { ownerUid: 'owner-b' }, { driverUid: created.driver.uid, active: false }), /not found/);
  assert.throws(() => requireOwner({ uid: created.driver.uid, role: 'driver' }, { role: 'admin' }), /Workspace account required/);
  assert.equal(publicDriver({ ...db.data.get(`users/owner-a/drivers/${created.driver.uid}`), pinHash: 'secret' }).pinHash, undefined);
});

test('PIN reset invalidates old PIN and rotates the session version', async () => {
  const { db, admin, owner } = context();
  const created = await createDriver(admin, db, owner, input());
  const uid = created.driver.uid, oldVersion = db.data.get(`users/${uid}`).sessionVersion;
  await resetPin(admin, db, owner, { driverUid: uid, pin: '87654321', confirmPin: '87654321' });
  const hash = db.data.get(`driverCredentials/${uid}`).pinHash;
  assert.equal(await verifyDriverPin('00123456', hash), false);
  assert.equal(await verifyDriverPin('87654321', hash), true);
  assert.notEqual(db.data.get(`users/${uid}`).sessionVersion, oldVersion);
});

test('five attempts lock the username for fifteen minutes; expired lockout resets', async () => {
  const db = new MemoryFirestore();
  for (let index = 0; index < 5; index++) assert.equal((await reserveAttempt(db, 'ahmad01', '127.0.0.1')).blocked, false);
  assert.equal((await reserveAttempt(db, 'ahmad01', '127.0.0.2')).blocked, true);
  for (const [key, value] of db.data) db.data.set(key, { ...value, lockoutUntil: Date.now() - 1, windowStartedAt: Date.now() - 16 * 60 * 1000 });
  assert.equal((await reserveAttempt(db, 'ahmad01', '127.0.0.2')).blocked, false);
});

test('login mints a token only after valid PIN, clears failures, and rejects inactive or tampered tenants', async () => {
  const { db, admin, owner } = context();
  const created = await createDriver(admin, db, owner, input());
  const uid = created.driver.uid;
  let response = await authenticateDriver({ admin, db, username: 'ahmad01', pin: '87654321', ip: '127.0.0.1' });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: 'Invalid username or PIN.' });
  assert.equal(admin.tokens.length, 0);
  response = await authenticateDriver({ admin, db, username: 'ahmad01', pin: '00123456', ip: '127.0.0.1' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).token, `test-token-${uid}`);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(admin.tokens[0].claims, { role: 'driver', tenantId: 'owner-a', driverId: uid, sessionVersion: db.data.get(`users/${uid}`).sessionVersion });
  assert.equal([...db.data.keys()].some(key => key.startsWith('driverLoginAttempts/')), false);
  await setStatus(admin, db, owner, { driverUid: uid, active: false });
  response = await authenticateDriver({ admin, db, username: 'ahmad01', pin: '00123456', ip: '127.0.0.1' });
  assert.equal(response.status, 401);
  assert.equal(admin.tokens.length, 1);
  await setStatus(admin, db, owner, { driverUid: uid, active: true });
  db.data.get('driverUsernames/ahmad01').tenantId = 'owner-b';
  response = await authenticateDriver({ admin, db, username: 'ahmad01', pin: '00123456', ip: '127.0.0.1' });
  assert.equal(response.status, 401);
  assert.equal(admin.tokens.length, 1);
});

test('Driver service distinguishes Firebase Auth, Firestore, and generic outages without exposing credentials', () => {
  const auth = classifyDriverServiceFailure({ code: 'auth/insufficient-permission' });
  assert.equal(auth.code, 'AUTH_PERMISSION');
  assert.match(auth.error, /Firebase Authentication/);
  assert.equal(classifyDriverServiceFailure({ code: 7 }).code, 'STORAGE_PERMISSION');
  assert.equal(classifyDriverServiceFailure({ code: 'unavailable' }).code, 'SERVICE_UNAVAILABLE');
  for (const result of [auth, classifyDriverServiceFailure({ code: 7 })]) assert.doesNotMatch(JSON.stringify(result), /private_key|pinHash|Bearer /);
});

test('legacy self-owned Pro Owner manages Drivers in the UID workspace under the server quota', async () => {
  const { db, admin, profile } = context('owner-a', 'proplan');
  Object.assign(profile, { uid: 'owner-a', tenantId: 'historical-metadata' });
  db.data.set('users/owner-a', profile);
  const ownerUid = requireOwner({ uid: 'owner-a' }, profile);
  assert.equal(ownerUid, 'owner-a');
  assert.deepEqual(driverEntitlement(profile), { plan: 'proplan', maxActiveDrivers: 10 });
  const result = await createDriver(admin, db, { ownerUid, profile }, input('legacy01'));
  assert.equal(result.driver.active, true);
  assert.equal(db.data.get(`users/owner-a/drivers/${result.driver.uid}`).tenantId, 'owner-a');
  assert.equal(db.data.get('users/owner-a').tenantId, 'historical-metadata', 'authorization does not rewrite the Owner profile');
  assert.equal((await listed(db, ownerUid)).length, 1);
});
