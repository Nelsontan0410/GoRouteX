import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTE_PLAN_LIMITS, TRIAL_ROUTE_PLAN_LIMIT, consumeRoutePlan, refundRoutePlan, getRoutePlanStatus, routePlanLimit, usageDateKey, isValidSessionId } from '../netlify/functions/_shared/route-plan-usage.js';

function memoryDb() {
  const data = new Map();
  const ref = (path) => ({ path, get: async () => ({ exists: data.has(path), data: () => structuredClone(data.get(path)) }) });
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

test('limits: Basic 2, Go 10, Pro 50; a Stripe trial gets 5; an expired paid plan falls back to Basic', () => {
  assert.equal(ROUTE_PLAN_LIMITS.basic, 2);
  assert.equal(routePlanLimit({ productPlanKey: 'basic' }), 2);
  assert.equal(routePlanLimit({ productPlanKey: 'goplan', planStatus: 'active' }), 10);
  assert.equal(routePlanLimit({ productPlanKey: 'proplan', planStatus: 'active' }), 50);
  assert.equal(routePlanLimit({ productPlanKey: 'proplan', planStatus: 'active', billingStatus: 'trialing' }), TRIAL_ROUTE_PLAN_LIMIT);
  assert.equal(TRIAL_ROUTE_PLAN_LIMIT, 5);
  assert.equal(routePlanLimit({ productPlanKey: 'goplan', planStatus: 'expired' }), 2);
});

test('every Review & Assign entry uses one automatic plan; the third Basic entry is refused', async () => {
  const db = memoryDb();
  const basic = { productPlanKey: 'basic' };
  const now = new Date('2026-10-06T02:00:00Z');
  assert.deepEqual(await consumeRoutePlan(db, 'u1', basic, 'session-aaa1', now), { allowed: true, used: 1, limit: 2, remaining: 1 });
  assert.deepEqual(await consumeRoutePlan(db, 'u1', basic, 'session-aaa1', now), { allowed: true, used: 1, limit: 2, remaining: 1 }, 'a retried request is free');
  assert.deepEqual(await consumeRoutePlan(db, 'u1', basic, 'session-bbb2', now), { allowed: true, used: 2, limit: 2, remaining: 0 }, 're-entering counts again');
  assert.deepEqual(await consumeRoutePlan(db, 'u1', basic, 'session-ccc3', now), { allowed: false, used: 2, limit: 2, remaining: 0 });
  assert.deepEqual(await consumeRoutePlan(db, 'u1', basic, 'session-ddd4', new Date('2026-10-07T02:00:00Z')), { allowed: true, used: 1, limit: 2, remaining: 1 }, 'new Singapore day');
  assert.deepEqual(await getRoutePlanStatus(db, 'u1', basic, now), { used: 2, limit: 2, remaining: 0 });
});

test('a failed automatic plan is refunded once; unknown sessions are not', async () => {
  const db = memoryDb();
  const basic = { productPlanKey: 'basic' };
  const now = new Date('2026-10-06T02:00:00Z');
  await consumeRoutePlan(db, 'u1', basic, 'session-aaa1', now);
  await consumeRoutePlan(db, 'u1', basic, 'session-bbb2', now);
  assert.equal((await refundRoutePlan(db, 'u1', basic, 'session-bbb2', now)).refunded, true);
  assert.equal((await refundRoutePlan(db, 'u1', basic, 'session-bbb2', now)).refunded, false, 'only once');
  assert.equal((await refundRoutePlan(db, 'u1', basic, 'session-zzz9', now)).refunded, false);
  assert.equal((await consumeRoutePlan(db, 'u1', basic, 'session-ccc3', now)).allowed, true, 'the refunded plan can be used again');
});

test('session IDs are validated', () => {
  assert.equal(isValidSessionId('3f2a9c1e-7b4d-4e8a-9f21-0c5d6e7f8a9b'), true);
  assert.equal(isValidSessionId('short'), false);
  assert.equal(isValidSessionId('bad/session/id'), false);
});

test('the client starts a session before automatic planning, and saving no longer uses the allowance', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const persistence = read('planning/planning-persistence.js');
  const entry = read('planning/manual-assignment-page.js');
  const flow = entry.slice(entry.indexOf('async function handleGoToManualAssignPageLegacy('));
  assert.ok(flow.indexOf('await startAutoPlanSession()') < flow.indexOf('await generateOptimizedActiveRoutesFromSelection('));
  assert.match(flow, /if \(autoPlan\.mode === 'manual'\) \{\s*unassignedStops = Array\.from\(selectedCustomers\);\s*resetManualRouteSlots\(\);/);
  assert.match(flow, /await refundAutoPlanSession\(autoPlan\.sessionId\);/);
  assert.doesNotMatch(persistence, /consumeServerRoutePlan|reservedRoutePlanId|projectedRouteCount/);
  const finalization = read('planning/route-finalization.js');
  assert.doesNotMatch(finalization, /Quota Reached|Daily route confirm quota/);
});
