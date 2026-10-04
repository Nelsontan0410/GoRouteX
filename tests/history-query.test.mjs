import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('function diagnosticClock('), source.indexOf('function serializeAddressNameMap('));

// docs: [{ id, createdAt?, updatedAt? }]. Records every query and how many were in flight together.
function setup(docs) {
  const queries = [];
  let inFlight = 0, peak = 0;
  const query = (spec) => ({
    orderBy: (field) => query({ ...spec, orderBy: field }),
    limit: (n) => query({ ...spec, limit: n }),
    startAfter: () => query({ ...spec, cursor: true }),
    async get() {
      queries.push(spec.orderBy || 'unordered');
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      const rows = docs.filter((d) => !spec.orderBy || d[spec.orderBy] !== undefined).slice(0, spec.limit || docs.length);
      return { empty: rows.length === 0, docs: rows.map((d) => ({ id: d.id, data: () => d })) };
    }
  });
  const context = vm.createContext({ console: { warn() {} }, HISTORY_LOAD_LIMIT: 20, _historyPageCursors: new Map(), getHistoryCollectionRef: () => query({}) });
  vm.runInContext(`${block}\nthis.load = loadHistoryWithFallback;`, context);
  return { load: (opts) => context.load('u1', 20, opts), queries, peak: () => peak };
}

test('empty history finishes after one parallel round trip, not three sequential queries', async () => {
  const page = setup([]);
  const result = await page.load();
  assert.equal(result.success, true);
  assert.equal(result.snapshot.empty, true);
  assert.deepEqual([...page.queries].sort(), ['createdAt', 'unordered']);
  assert.equal(page.peak(), 2, 'probe runs alongside the main query');
});

test('normal history is served by the createdAt query', async () => {
  const page = setup([{ id: 'a', createdAt: 2 }, { id: 'b', createdAt: 1 }]);
  const result = await page.load();
  assert.deepEqual(result.snapshot.docs.map((d) => d.id), ['a', 'b']);
  assert.deepEqual([...page.queries].sort(), ['createdAt', 'unordered']);
});

test('legacy documents without createdAt still load through the fallbacks', async () => {
  const page = setup([{ id: 'legacy', updatedAt: 5 }]);
  const result = await page.load();
  assert.deepEqual(result.snapshot.docs.map((d) => d.id), ['legacy']);
  assert.ok(page.queries.includes('updatedAt'));
});

test('load-more pages do not send the probe', async () => {
  const page = setup([{ id: 'a', createdAt: 2 }]);
  await page.load({ loadMore: true });
  assert.deepEqual(page.queries, ['createdAt']);
});

test('history diagnostics report query time, document count and approximate size, and never break loading', async () => {
  const notes = {};
  const page = setup([{ id: 'a', createdAt: 2, body: 'x'.repeat(2048) }]);
  // setup() builds its own context; rebuild with a timing sink to observe the notes.
  const queries = [];
  const doc = { id: 'a', data: () => ({ createdAt: 2, body: 'x'.repeat(2048) }) };
  const context = vm.createContext({
    console: { warn() {} }, HISTORY_LOAD_LIMIT: 20, _historyPageCursors: new Map(),
    globalThis: { GoRouteXTiming: { notes, note(name, value) { notes[name] = value; } } },
    getHistoryCollectionRef: () => {
      const q = { orderBy: () => q, limit: () => q, startAfter: () => q, get: async () => { queries.push(1); return { empty: false, docs: [doc] }; } };
      return q;
    }
  });
  vm.runInContext(`${block}\nthis.load = loadHistoryWithFallback;`, context);
  const result = await context.load('u1', 20, {});
  assert.equal(result.success, true);
  assert.equal(notes['history-docs'], 1);
  assert.ok(notes['history-approx-KB'] >= 2);
  assert.equal(typeof notes['history-query-ms'], 'number');
  assert.ok(page);
});
