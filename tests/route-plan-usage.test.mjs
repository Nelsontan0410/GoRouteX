import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTE_PLAN_LIMITS, consumeRoutePlan, routePlanLimit, usageDateKey } from '../netlify/functions/_shared/route-plan-usage.js';

function memoryDb() {
  const data = new Map();
  const ref = (path) => ({ path });
  return {
    data,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(fn) {
      const writes = [];
      const result = await fn({
        get: async (target) => ({ exists: data.has(target.path), data: () => structuredClone(data.get(target.path)) }),
        set: (target, value) => writes.push(() => data.set(target.path, structuredClone(value)))
      });
      writes.forEach((write) => write());
      return result;
    }
  };
}

test('server route plan limits match the product plan definitions', () => {
  const source = readFileSync(new URL('../route-planner-product.js', import.meta.url), 'utf8');
  for (const [plan, limit] of Object.entries(ROUTE_PLAN_LIMITS)) {
    const block = source.slice(source.indexOf(`key: '${plan}'`));
    assert.equal(Number(block.match(/maxSavedRoutesPerDay:\s*(\d+)/)[1]), limit, plan);
  }
});

test('limit follows the effective plan, so an expired paid plan falls back to basic', () => {
  assert.equal(routePlanLimit({ productPlanKey: 'proplan', planStatus: 'active' }), 50);
  assert.equal(routePlanLimit({ productPlanKey: 'goplan', planStatus: 'expired' }), 1);
  assert.equal(routePlanLimit({}), 1);
});

test('consume counts once per route ID and refuses past the daily limit', async () => {
  const db = memoryDb();
  const profile = { productPlanKey: 'basic' };
  const now = new Date('2026-10-04T10:00:00Z');
  assert.deepEqual(await consumeRoutePlan(db, 'u1', profile, 'r1', now), { allowed: true, used: 1, limit: 1 });
  assert.deepEqual(await consumeRoutePlan(db, 'u1', profile, 'r1', now), { allowed: true, used: 1, limit: 1 }, 'retry is free');
  assert.deepEqual(await consumeRoutePlan(db, 'u1', profile, 'r2', now), { allowed: false, used: 1, limit: 1 });
  assert.deepEqual(await consumeRoutePlan(db, 'u2', profile, 'r2', now), { allowed: true, used: 1, limit: 1 }, 'per user');
  assert.deepEqual(await consumeRoutePlan(db, 'u1', profile, 'r3', new Date('2026-10-05T10:00:00Z')), { allowed: true, used: 1, limit: 1 }, 'new day');
});

test('the usage day is the Singapore calendar day', () => {
  assert.equal(usageDateKey(new Date('2026-10-04T15:59:00Z')), '2026-10-04');
  assert.equal(usageDateKey(new Date('2026-10-04T16:00:00Z')), '2026-10-05');
});

test('route counters live in a collection firestore.rules never opens to clients', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.doesNotMatch(rules, /routePlanUsage/);
  // The only top-level catch-all denies everything.
  assert.match(rules, /\n    match \/\{document=\*\*\} \{\n      allow read, write: if false;/);
});

test('saving a route consumes the server count before writing and reuses the ID on retry', () => {
  const persistence = readFileSync(new URL('../planning/planning-persistence.js', import.meta.url), 'utf8');
  const save = persistence.slice(persistence.indexOf('const usageRouteId'));
  assert.ok(save.indexOf('consumeServerRoutePlan(usageRouteId)') < save.indexOf('RoutePlannerStorage.saveHistory(historyEntry)'));
  assert.match(save, /if \(serverUsage\?\.limitReached\) \{[\s\S]*?openRouteLimitReachedModal[\s\S]*?return \{ success: false, limitReached: true \};/);
  assert.match(save, /reservedRoutePlanId = null;/);
});
