import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../planning/planning-persistence.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('// Selection saves are serialized'), source.indexOf('async function loadSessionFromCloud('));

test('selection saves are serialized and the last state always wins', async () => {
  const saves = [];
  const context = vm.createContext({
    console,
    Promise,
    markLocalSessionUpdated() {},
    selectedCustomers: new Set(['a']),
    selectedAddresses: new Set(),
    window: { RoutePlannerStorage: { saveSelection: (data) => new Promise((resolve) => saves.push({ data, resolve })) } }
  });
  vm.runInContext(`${block}\nthis.sync = syncSessionToCloud;`, context);

  context.sync();
  context.selectedCustomers = new Set(['a', 'b']);
  vm.runInContext('selectedCustomers = this.selectedCustomers', context);
  context.sync();
  context.sync();
  assert.equal(saves.length, 1, 'only one write in flight');

  saves[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saves.length, 2, 'one follow-up write for all queued changes');
  assert.deepEqual([...saves[1].data.selectedCustomers], ['a', 'b']);
  saves[1].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saves.length, 2);
});

test('restored cloud timestamp is stored as ISO text', () => {
  assert.match(source, /localStorage\.setItem\('bjsSessionUpdatedAt', new Date\(cloudUpdatedAtMs\)\.toISOString\(\)\)/);
});
