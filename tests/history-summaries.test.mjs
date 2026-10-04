import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8');
const slice = (from, to) => {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `${from} .. ${to}`);
  return source.slice(a, b);
};
const code = [
  slice('function diagnosticClock(', 'function serializeAddressNameMap('),
  slice('const HISTORY_SUMMARY_VERSION', 'async function saveHistoryBundle('),
  slice('const _historyListState', 'async function loadRoutesFromCloud(')
].join('\n');

// In-memory Firestore: collections are arrays of { id, createdAt(ms), data }, newest order is by createdAt.
function setup({ history = [], summaries = [], operations = null, denySummaries = false } = {}) {
  const store = { history: [...history], historySummaries: [...summaries], operationSnapshots: operations ?? history.map((h) => ({ id: h.id, createdAt: h.createdAt, data: {} })) };
  const reads = { history: 0, historySummaries: 0, operationSnapshots: 0 };
  const writes = [];
  const snap = (name, row) => ({ id: row.id, get: (field) => (field === 'createdAt' ? row.createdAt : row.data[field]), data: () => ({ createdAt: row.createdAt, ...row.data }), _row: row });
  const collection = (name) => {
    const build = (spec) => ({
      orderBy: (field, dir) => build({ ...spec, orderBy: field, dir }),
      limit: (n) => build({ ...spec, limit: n }),
      startAfter: (after) => build({ ...spec, after: typeof after === 'object' && after?._row ? after._row.createdAt : after }),
      async get() {
        if (denySummaries && name === 'historySummaries') throw Object.assign(new Error('denied'), { code: 'permission-denied' });
        let rows = store[name].filter((r) => r.createdAt !== undefined).sort((a, b) => b.createdAt - a.createdAt);
        if (spec.after !== undefined) rows = rows.filter((r) => r.createdAt < spec.after);
        rows = rows.slice(0, spec.limit ?? rows.length);
        reads[name] += rows.length;
        const docs = rows.map((r) => snap(name, r));
        return { empty: docs.length === 0, docs, forEach: (cb) => docs.forEach(cb) };
      }
    });
    return build({});
  };
  const context = vm.createContext({
    console: { warn() {} }, globalThis: undefined, HISTORY_LOAD_LIMIT: 20, _historyPageCursors: new Map(),
    db: { batch: () => { const sets = []; return { set: (ref, data) => sets.push({ ref, data }), commit: async () => { if (denySummaries) throw Object.assign(new Error('denied'), { code: 'permission-denied' }); writes.push(...sets); } }; } },
    getHistoryCollectionRef: () => collection('history'),
    getHistorySummariesCollectionRef: () => ({ ...collection('historySummaries'), doc: (id) => ({ id }) }),
    getOperationSnapshotsCollectionRef: () => collection('operationSnapshots')
  });
  context.globalThis = { GoRouteXTiming: undefined };
  vm.runInContext(`${code}\nthis.api = { loadHistoryPage, toHistorySummary, state: () => _historySummariesUnavailable };`, context);
  return { api: context.api, reads, writes };
}

const full = (id, createdAt) => ({ id, createdAt, data: { routeName: `Route ${id}`, successfulRoutesCount: 1, plannedRoutes: [{ id: 1, detailedStopTimes: [{ name: 'A' }], directionsResult: { routes: [{ big: 'x'.repeat(1000) }] } }] } });
const slim = (id, createdAt) => ({ id, createdAt, data: { routeName: `Route ${id}`, successfulRoutesCount: 1, plannedRoutes: [{ id: 1, hasDirectionsResult: true }] } });
const ids = (result) => result.snapshot.docs.map((doc) => doc.id);

test('toHistorySummary drops directionsResult, keeps the rest and the success count', () => {
  const { api } = setup();
  const summary = api.toHistorySummary({ routeName: 'R', plannedRoutes: [{ id: 1, detailedStopTimes: [1], directionsResult: { routes: [{}] } }, { id: 2 }] });
  assert.equal(summary.plannedRoutes[0].directionsResult, undefined);
  assert.equal(summary.plannedRoutes[0].hasDirectionsResult, true);
  assert.deepEqual(summary.plannedRoutes[0].detailedStopTimes, [1]);
  assert.equal(summary.plannedRoutes[1].hasDirectionsResult, undefined);
  assert.equal(summary.successfulRoutesCount, 1, 'derived from directionsResult for older documents');
  assert.equal(summary.summaryVersion, 1);
});

test('with current summaries the first page reads only summaries, never the full history', async () => {
  const rows = [5, 4, 3, 2, 1].map((n) => ({ ...slim(`r${n}`, n * 10) }));
  const history = rows.map((r) => full(r.id, r.createdAt));
  const { api, reads } = setup({ history, summaries: rows });
  const result = await api.loadHistoryPage('u1', 5, {});
  assert.deepEqual(ids(result), ['r5', 'r4', 'r3', 'r2', 'r1']);
  assert.equal(reads.history, 0);
  assert.equal(result.hasMore, true);
  assert.ok(result.snapshot.docs.every((doc) => !doc.data().plannedRoutes?.[0]?.directionsResult));
});

test('no summaries yet: reads the full history once, returns slim entries, backfills summaries', async () => {
  const history = [3, 2, 1].map((n) => full(`r${n}`, n * 10));
  const { api, reads, writes } = setup({ history });
  const result = await api.loadHistoryPage('u1', 5, {});
  assert.deepEqual(ids(result), ['r3', 'r2', 'r1']);
  assert.ok(reads.history > 0);
  assert.ok(result.snapshot.docs.every((doc) => !doc.data().plannedRoutes[0].directionsResult));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes.map((w) => w.ref.id).sort(), ['r1', 'r2', 'r3']);
  assert.ok(writes.every((w) => !w.data.plannedRoutes[0].directionsResult));
});

test('a newest route without a summary makes the summaries stale, so the full history is used', async () => {
  const history = [4, 3, 2, 1].map((n) => full(`r${n}`, n * 10));
  const summaries = [3, 2, 1].map((n) => slim(`r${n}`, n * 10)); // r4 saved by an older client: no summary
  const { api, reads } = setup({ history, summaries });
  const result = await api.loadHistoryPage('u1', 5, {});
  assert.ok(ids(result).includes('r4'), 'the newest route is not lost');
  assert.ok(reads.history > 0);
});

test('Load More continues from summaries into full history older than the oldest summary, without duplicates', async () => {
  const history = [8, 7, 6, 5, 4, 3, 2, 1].map((n) => full(`r${n}`, n * 10));
  const summaries = [8, 7, 6].map((n) => slim(`r${n}`, n * 10));
  const { api, writes } = setup({ history, summaries });
  const first = await api.loadHistoryPage('u1', 3, {});
  assert.deepEqual(ids(first), ['r8', 'r7', 'r6']);
  assert.equal(first.hasMore, true);
  const second = await api.loadHistoryPage('u1', 3, { loadMore: true });
  assert.deepEqual(ids(second), ['r5', 'r4', 'r3']);
  assert.equal(second.hasMore, true);
  const third = await api.loadHistoryPage('u1', 3, { loadMore: true });
  assert.deepEqual(ids(third), ['r2', 'r1']);
  assert.equal(third.hasMore, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes.map((w) => w.ref.id).sort(), ['r1', 'r2', 'r3', 'r4', 'r5'], 'older routes get summaries as they are loaded');
});

test('a page that straddles the summaries/full-history boundary is filled from both', async () => {
  const history = [5, 4, 3, 2, 1].map((n) => full(`r${n}`, n * 10));
  const summaries = [5, 4].map((n) => slim(`r${n}`, n * 10));
  const { api } = setup({ history, summaries });
  const result = await api.loadHistoryPage('u1', 4, {});
  assert.deepEqual(ids(result), ['r5', 'r4', 'r3', 'r2']);
  assert.equal(result.hasMore, true);
});

test('rules without historySummaries fall back to the plain history query and stop retrying', async () => {
  const history = [2, 1].map((n) => full(`r${n}`, n * 10));
  const { api, reads } = setup({ history, denySummaries: true });
  const result = await api.loadHistoryPage('u1', 5, {});
  assert.deepEqual(ids(result), ['r2', 'r1']);
  assert.equal(api.state(), true);
  assert.ok(result.snapshot.docs[0].data().plannedRoutes[0].directionsResult, 'unchanged legacy behaviour: full documents');
  const before = reads.historySummaries;
  await api.loadHistoryPage('u1', 5, {});
  assert.equal(reads.historySummaries, before, 'no further summary reads this session');
});

test('a user with no history at all gets an empty first page', async () => {
  const { api } = setup();
  const result = await api.loadHistoryPage('u1', 5, {});
  assert.equal(result.success, true);
  assert.equal(result.snapshot.docs.length, 0);
});

test('Load More page that exhausts the summaries mid-page fills the rest from older full history', async () => {
  const history = [7, 6, 5, 4, 3, 2, 1].map((n) => full(`r${n}`, n * 10));
  const summaries = [7, 6, 5, 4].map((n) => slim(`r${n}`, n * 10));
  const { api } = setup({ history, summaries });
  assert.deepEqual(ids(await api.loadHistoryPage('u1', 3, {})), ['r7', 'r6', 'r5']);
  const second = await api.loadHistoryPage('u1', 3, { loadMore: true });
  assert.deepEqual(ids(second), ['r4', 'r3', 'r2'], 'one summary, then two older full documents, no repeats');
  assert.equal(second.hasMore, true);
  assert.deepEqual(ids(await api.loadHistoryPage('u1', 3, { loadMore: true })), ['r1']);
});

// ---- Save and delete ----
function writeHarness({ failFirstCommitWith } = {}) {
  const commits = [];
  const log = [];
  let commitCount = 0;
  const ref = (path) => ({ path, set: async () => {}, delete: async () => { log.push(`delete ${path}`); } });
  const refs = (name) => ({ doc: (id) => ref(`${name}/${id}`) });
  const code = [
    slice('function serializeAddressNameMap(', 'async function saveRouteToCloud('),
    slice('async function deleteRouteFromCloud(', '// Save current session (selected stops')
  ].join('\n');
  const context = vm.createContext({
    console: { warn() {}, error() {} },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS' } } },
    getCurrentUser: () => ({ uid: 'u1' }),
    getHistoryCollectionRef: () => refs('history'),
    getPlannedRoutesCollectionRef: () => refs('plannedRoutes'),
    getOperationSnapshotsCollectionRef: () => refs('operationSnapshots'),
    getHistorySummariesCollectionRef: () => refs('historySummaries'),
    db: {
      batch() {
        const sets = [];
        return {
          set: (target, data) => sets.push({ path: target.path, data }),
          async commit() {
            commitCount++;
            if (commitCount === 1 && failFirstCommitWith) throw Object.assign(new Error('x'), { code: failFirstCommitWith });
            commits.push(sets);
          }
        };
      }
    }
  });
  vm.runInContext(`${code}\nthis.api = { save: saveHistoryBundle, remove: deleteRouteFromCloud, unavailable: () => _historySummariesUnavailable };`, context);
  return { api: context.api, commits, log };
}
const bigRoute = { id: 'r1', routeName: 'Route', plannedRoutes: [{ id: 1, directionsResult: { routes: [{ big: 'x' }] } }], addressNameMap: { a: 'A' } };

test('saving writes history, planned route, snapshot and summary in one atomic batch', async () => {
  const { api, commits } = writeHarness();
  assert.equal(JSON.stringify(await api.save(bigRoute)), JSON.stringify({ success: true, id: 'r1' }));
  assert.equal(commits.length, 1);
  assert.deepEqual([...commits[0].map((w) => w.path)], ['history/r1', 'plannedRoutes/r1', 'operationSnapshots/r1', 'historySummaries/r1']);
  assert.ok(commits[0][0].data.plannedRoutes[0].directionsResult, 'the full document keeps the route data');
  assert.equal(commits[0][3].data.plannedRoutes[0].directionsResult, undefined, 'the summary does not');
});

test('rules rejecting the summary never block saving a route: retry without it', async () => {
  const { api, commits } = writeHarness({ failFirstCommitWith: 'permission-denied' });
  assert.equal(JSON.stringify(await api.save(bigRoute)), JSON.stringify({ success: true, id: 'r1' }));
  assert.equal(commits.length, 1);
  assert.deepEqual([...commits[0].map((w) => w.path)], ['history/r1', 'plannedRoutes/r1', 'operationSnapshots/r1']);
  assert.equal(api.unavailable(), true);
});

test('other write failures are still reported as a failed save', async () => {
  const { api, commits } = writeHarness({ failFirstCommitWith: 'unavailable' });
  const result = await api.save(bigRoute);
  assert.equal(result.success, false);
  assert.equal(commits.length, 0);
});

test('deleting removes the summary first, then the history document', async () => {
  const { api, log } = writeHarness();
  assert.equal(JSON.stringify(await api.remove('r1')), JSON.stringify({ success: true }));
  assert.deepEqual([...log], ['delete historySummaries/r1', 'delete history/r1', 'delete plannedRoutes/r1', 'delete operationSnapshots/r1']);
});

test('cloud-to-device history migration asks for complete documents, not summaries', () => {
  assert.match(readFileSync(new URL('../route-storage.js', import.meta.url), 'utf8'), /cloudAdapter\.loadHistory\(\{ full: true \}\)/);
  assert.match(source, /const loadPage = options\.full === true \? loadHistoryWithFallback : loadHistoryPage;/);
});
