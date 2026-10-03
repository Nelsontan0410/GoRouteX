import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8');

function harness(initial = {}) {
  const records = new Map(Object.entries(initial));
  const calls = { reads: [], writes: [] };
  const firestore = () => ({
    enablePersistence: async () => {},
    collection(name) {
      return {
        doc(uid) {
          const path = name + '/' + uid;
          return {
            async get(options) {
              calls.reads.push({ path, source: options?.source || 'default' });
              const profile = records.get(path);
              return { exists: !!profile, data: () => profile, metadata: { fromCache: false } };
            },
            async set(profile, options) {
              calls.writes.push({ path, options });
              records.set(path, profile);
            }
          };
        }
      };
    }
  });
  firestore.Timestamp = { fromDate: value => value };
  firestore.FieldValue = { serverTimestamp: () => 'server-time' };
  const firebaseAuth = { currentUser: null };
  const firebase = {
    apps: [],
    initializeApp(config) { const app = { config }; this.apps.push(app); return app; },
    auth: () => firebaseAuth,
    firestore
  };
  const window = { addEventListener() {}, location: { origin: 'http://localhost' } };
  vm.runInContext(source, vm.createContext({ firebase, window, navigator: { onLine: true, userAgent: 'Test' }, console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams, setTimeout, clearTimeout }));
  return { api: window.FirebaseApp.auth, calls, records };
}

test('returning profile bootstrap uses default Firestore read and no passive write', async () => {
  const page = harness({ 'users/owner': { name: 'Owner', role: 'admin', productPlanKey: 'proplan' } });
  const result = await page.api.loadProfile({ uid: 'owner' });
  assert.equal(result.success, true);
  assert.equal(result.serverConfirmed, true);
  assert.deepEqual(page.calls.reads, [{ path: 'users/owner', source: 'default' }]);
  assert.equal(page.calls.writes.length, 0);
});

test('first-time signup provisions a workspace profile once, then returning bootstrap is read-only', async () => {
  const page = harness();
  const user = { uid: 'new-owner', email: 'owner@example.test', displayName: 'New Owner' };
  const created = await page.api.ensureInitialProfileForNewAccount(user, 'New Owner');
  assert.equal(created.success, true);
  assert.equal(created.created, true);
  assert.equal(page.records.get('users/new-owner').tenantId, 'new-owner');
  assert.equal(page.records.get('users/new-owner').role, 'admin');
  assert.equal(page.calls.writes.length, 1);
  const loaded = await page.api.loadProfile(user);
  assert.equal(loaded.success, true);
  assert.equal(page.calls.writes.length, 1);
  assert.equal(page.calls.reads.length, 2);
});
