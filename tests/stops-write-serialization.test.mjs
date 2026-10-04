import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return source.slice(start, end);
}

function harness() {
  const written = [];
  const pending = [];
  const context = {
    STOPS_WRITE_DEBOUNCE_MS: 10,
    setTimeout,
    clearTimeout,
    getCurrentUser: () => ({ uid: 'u1' }),
    normalizeStop: (stop) => stop,
    normalizeFirestoreError: (error) => ({ displayMessage: String(error) }),
    __write(snapshot) {
      // Resolves only when the test releases it, to simulate a slow network write.
      return new Promise((resolve) => {
        pending.push(() => { written.push([...snapshot]); resolve({ success: true, totalStops: snapshot.length }); });
      });
    }
  };
  const code = [
    'let _stopsMem = []; let _stopsLoaded = true; let _stopsStorageMode = "single"; let _stopsCacheUid = null;',
    'let _stopsWriteTimer = null; let _stopsFlushPromise = null; let _stopsPendingWrite = false; let _stopsDirtyGen = 0;',
    'function writeStopsToFirestore() { return __write(_stopsMem.map((stop) => stop.name)); }',
    'function clearStopsWriteTimer() { if (_stopsWriteTimer) { clearTimeout(_stopsWriteTimer); _stopsWriteTimer = null; } }',
    extract('function markStopsDirty()', 'async function loadStopsCache('),
    extract('async function saveStopsCache(', 'async function addStop('),
    'this.api = { saveStopsCache, state: () => JSON.stringify({ pending: _stopsPendingWrite, inFlight: !!_stopsFlushPromise }) };'
  ].join('\n');
  vm.createContext(context);
  vm.runInContext(code, context);
  return { api: context.api, written, pending };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('immediate save during an in-flight write is written after it, not dropped', async () => {
  const { api, written, pending } = harness();
  const first = api.saveStopsCache([{ name: 'A' }], { immediate: true });
  await tick();
  assert.equal(pending.length, 1);

  const second = api.saveStopsCache([{ name: 'A' }, { name: 'B' }], { immediate: true });
  await tick();
  assert.equal(pending.length, 1, 'second write must wait for the first');

  pending.shift()();
  await first;
  await tick();
  assert.equal(pending.length, 1, 'newer data triggers a follow-up write');
  pending.shift()();
  await second;

  assert.deepEqual(written, [['A'], ['A', 'B']]);
  assert.equal(api.state(), JSON.stringify({ pending: false, inFlight: false }));
});

test('flush with no newer changes reuses the in-flight write', async () => {
  const { api, written, pending } = harness();
  const first = api.saveStopsCache([{ name: 'A' }], { immediate: true });
  await tick();
  pending.shift()();
  await first;
  assert.deepEqual(written, [['A']]);
  assert.equal(pending.length, 0);
  assert.equal(api.state(), JSON.stringify({ pending: false, inFlight: false }));
});
