import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../route-storage.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('async function maybeHydrateIndexedDbFromCloud('), source.indexOf('const HYDRATION_RETRY_COOLDOWN_MS'));

function setup(cloud) {
  const local = { stops: [], selection: null, meta: null, writes: [] };
  const adapter = {
    getMeta: async () => local.meta,
    setMeta: async (_key, value) => { local.meta = value; },
    loadStops: async () => ({ stops: local.stops }),
    loadHistory: async () => ({ routes: [] }),
    loadSelection: async () => ({ session: local.selection }),
    saveStops: async (stops) => { local.writes.push('stops'); local.stops = stops; },
    saveHistory: async () => { local.writes.push('history'); },
    saveSelection: async (session) => { local.writes.push('selection'); local.selection = session; },
    saveActiveRoutes: async () => { local.writes.push('active'); }
  };
  const context = vm.createContext({ RECORD_MIGRATION: 'migration', createCloudAdapter: () => cloud(local) });
  vm.runInContext(`${block}\nthis.hydrate = maybeHydrateIndexedDbFromCloud;`, context);
  return { hydrate: () => context.hydrate(adapter), local };
}

test('hydration never overwrites a local save made while cloud reads were in flight', async () => {
  const { hydrate, local } = setup((state) => ({
    async loadStops() { state.stops = [{ id: 'local-new' }]; state.selection = { selectedCustomers: ['x'] }; return { success: true, stops: [{ id: 'cloud' }] }; },
    loadHistory: async () => ({ success: true, routes: [] }),
    loadSelection: async () => ({ success: true, session: { selectedCustomers: ['cloud'] } }),
    loadActiveRoutes: async () => ({ success: true, data: null })
  }));
  await hydrate();
  assert.deepEqual(local.writes, []);
  assert.equal(local.stops[0].id, 'local-new');
  assert.equal(local.meta.source, 'cloud');
});

test('a cloud load reporting failure is marked cloud-failed so it retries', async () => {
  const { hydrate, local } = setup(() => ({
    loadStops: async () => ({ success: false, error: 'offline' }),
    loadHistory: async () => ({ success: true, routes: [] }),
    loadSelection: async () => ({ success: true, session: null }),
    loadActiveRoutes: async () => ({ success: true, data: null })
  }));
  const result = await hydrate();
  assert.equal(result.success, false);
  assert.equal(local.meta.source, 'cloud-failed');
});
