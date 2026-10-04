// Runs the real firebase-config.js history code (save, list, delete) against the Firestore emulator
// with the real security rules. Run with: pnpm test:rules
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const source = readFileSync('firebase-config.js', 'utf8');
const slice = (from, to) => {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `${from} .. ${to}`);
  return source.slice(a, b);
};
const code = [
  slice('function diagnosticClock(', 'async function saveRouteToCloud('),
  slice('const _historyListState', 'async function loadRoutesFromCloud('),
  slice('async function deleteRouteFromCloud(', '// Save current session (selected stops')
].join('\n');

const OWNER = 'owner1';
let env, api, db;

// Evaluated in this realm (not a vm sandbox): the Firestore SDK rejects objects from another realm.
function install(firestore) {
  const user = () => firestore.collection('users').doc(OWNER);
  const deps = {
    console: { warn() {}, error() {}, log() {} }, firebase, db: firestore, HISTORY_LOAD_LIMIT: 20, _historyPageCursors: new Map(),
    getCurrentUser: () => ({ uid: OWNER }),
    getHistoryCollectionRef: () => user().collection('history'),
    getPlannedRoutesCollectionRef: () => user().collection('plannedRoutes'),
    getOperationSnapshotsCollectionRef: () => user().collection('operationSnapshots'),
    getHistorySummariesCollectionRef: () => user().collection('historySummaries'),
    globalThis: { GoRouteXTiming: undefined }
  };
  const factory = new Function(...Object.keys(deps), `${code}\nreturn { save: saveHistoryBundle, remove: deleteRouteFromCloud, list: loadHistoryPage, unavailable: () => _historySummariesUnavailable };`);
  return factory(...Object.values(deps));
}

// A route plan whose Google directions data makes the document large, like production (~0.8 MB each).
const route = (id) => ({
  id, routeName: `Route ${id}`, timestamp: new Date().toISOString(), totalStops: 3, successfulRoutesCount: 1,
  plannedRoutes: [{ id: 1, detailedStopTimes: [{ name: 'A', arrivalTimeStr: '09:00' }], lorryValidation: { status: 'SAFE' },
    directionsResult: { routes: [{ overview_path: Array.from({ length: 4000 }, (_, i) => ({ lat: 1 + i / 1e5, lng: 103 + i / 1e5 })) }] } }],
  addressNameMap: { a: 'A' }
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sizeOf = (data) => JSON.stringify(data).length;
const ids = (result) => result.snapshot.docs.map((doc) => doc.id);

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-goroutex', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(OWNER).set({ role: 'admin', name: 'Owner', email: 'o@example.com', tenantId: OWNER });
  });
  db = env.authenticatedContext(OWNER).firestore();
  api = install(db);
});

// Summary backfill is a background write; let it land before the next test clears the emulator.
afterEach(async () => { await sleep(400); });

async function saveRoutes(count) {
  for (let n = 1; n <= count; n++) {
    const saved = await api.save(route(`r${n}`));
    assert.equal(saved.success, true, saved.error);
    await sleep(8);
  }
}

test('saving stores a large history document and a small summary; the owner rules allow both', async () => {
  await saveRoutes(1);
  const history = (await db.collection('users').doc(OWNER).collection('history').doc('r1').get()).data();
  const summary = (await db.collection('users').doc(OWNER).collection('historySummaries').doc('r1').get()).data();
  assert.ok(sizeOf(history) > 100000, 'history document is large');
  assert.ok(sizeOf(summary) < 2000, `summary is small (${sizeOf(summary)} bytes)`);
  assert.equal(summary.plannedRoutes[0].hasDirectionsResult, true);
  assert.deepEqual(summary.createdAt, history.createdAt, 'atomic batch: identical server timestamps');
});

test('the list pages newest-first from summaries only, and every page is small', async () => {
  await saveRoutes(7);
  const first = await api.list(OWNER, 5, {});
  assert.deepEqual([...ids(first)], ['r7', 'r6', 'r5', 'r4', 'r3']);
  assert.equal(first.hasMore, true);
  assert.ok(first.snapshot.docs.every((doc) => sizeOf(doc.data()) < 2000));
  const second = await api.list(OWNER, 5, { loadMore: true });
  assert.deepEqual([...ids(second)], ['r2', 'r1']);
  assert.equal(second.hasMore, false);
});

test('routes saved before summaries existed are listed, slimmed, and summarised as they load', async () => {
  await saveRoutes(7);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const batch = ctx.firestore().batch();
    (await ctx.firestore().collection('users').doc(OWNER).collection('historySummaries').get()).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  });
  const first = await api.list(OWNER, 5, {});
  assert.deepEqual([...ids(first)], ['r7', 'r6', 'r5', 'r4', 'r3']);
  assert.ok(first.snapshot.docs.every((doc) => sizeOf(doc.data()) < 2000), 'full documents are slimmed before reaching the UI');
  await sleep(300);
  const summarised = await db.collection('users').doc(OWNER).collection('historySummaries').get();
  assert.deepEqual(summarised.docs.map((d) => d.id).sort(), ['r3', 'r4', 'r5', 'r6', 'r7']);
  const second = await api.list(OWNER, 5, { loadMore: true });
  assert.deepEqual([...ids(second)], ['r2', 'r1']);
});

test('a route saved without a summary (older client) is not hidden by the existing summaries', async () => {
  await saveRoutes(3);
  // Simulate the old client: history + operation snapshot, no summary.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    const userDoc = admin.collection('users').doc(OWNER);
    const batch = admin.batch();
    const stamp = firebase.firestore.FieldValue.serverTimestamp();
    batch.set(userDoc.collection('history').doc('r4'), { ...route('r4'), createdAt: stamp, updatedAt: stamp });
    batch.set(userDoc.collection('operationSnapshots').doc('r4'), { id: 'r4', createdAt: stamp, updatedAt: stamp });
    await batch.commit();
  });
  const result = await api.list(OWNER, 5, {});
  assert.deepEqual([...ids(result)], ['r4', 'r3', 'r2', 'r1']);
});

test('deleting a route removes its summary, so it leaves the list', async () => {
  await saveRoutes(3);
  assert.equal((await api.remove('r2')).success, true);
  assert.deepEqual([...ids(await api.list(OWNER, 5, {}))], ['r3', 'r1']);
  assert.equal((await db.collection('users').doc(OWNER).collection('historySummaries').doc('r2').get()).exists, false);
});

test('a user with no history lists nothing and does not error', async () => {
  const result = await api.list(OWNER, 5, {});
  assert.equal(result.success, true);
  assert.equal(result.snapshot.docs.length, 0);
});

test('with rules that predate historySummaries, saving and listing still work (deploy-order safety)', async () => {
  const oldRules = readFileSync('firestore.rules', 'utf8').replace(", 'historySummaries'];", '];');
  assert.notEqual(oldRules, readFileSync('firestore.rules', 'utf8'));
  const legacyEnv = await initializeTestEnvironment({ projectId: 'demo-goroutex-old-rules', firestore: { rules: oldRules, host: '127.0.0.1', port: 8080 } });
  try {
    await legacyEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('users').doc(OWNER).set({ role: 'admin', name: 'Owner', email: 'o@example.com', tenantId: OWNER });
    });
    const legacyApi = install(legacyEnv.authenticatedContext(OWNER).firestore());
    assert.equal((await legacyApi.save(route('r1'))).success, true, 'saving must not fail');
    await sleep(8);
    assert.equal((await legacyApi.save(route('r2'))).success, true);
    const result = await legacyApi.list(OWNER, 5, {});
    assert.deepEqual([...ids(result)], ['r2', 'r1']);
    assert.equal(legacyApi.unavailable(), true);
  } finally {
    await legacyEnv.cleanup();
  }
});
