import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../planning/route-finalization.js', import.meta.url), 'utf8');
const pick = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

function load() {
  const ctx = vm.createContext({ console });
  ctx.toasts = [];
  vm.runInContext(`
    var AppState = {}; var messageBarPg2 = { textContent: '' };
    function showToast(m) { toasts.push(m); }
    var modalOpened = 0;
    function openTimeWindowExceptionModal() { modalOpened++; return Promise.resolve({ action: 'adjust' }); }
    function showPage() {}
    ${pick('function deliveryWindowCheckGap(', 'async function handleProceedToOptimizeRoutes(')}
    this.enforce = enforceDeliveryWindows; this.state = () => ({ modalOpened, bar: messageBarPg2.textContent });
  `, ctx);
  return ctx;
}

test('missing arrival times or rules block confirmation instead of passing', async () => {
  for (const [eta, pattern] of [
    [undefined, /Arrival times could not be calculated/],
    [{ timeWindowViolations: [], rulesMissing: true }, /rules did not load/],
    [{ timeWindowViolations: [], unverifiedRouteIds: [2, 3] }, /Route 2, 3 has no arrival times/]
  ]) {
    const ctx = load();
    const result = await ctx.enforce(eta);
    assert.equal(result.proceed, false);
    assert.match(ctx.state().bar, pattern);
    assert.equal(ctx.state().modalOpened, 0, 'no override offered for an unchecked plan');
  }
});

test('a fully checked plan without violations still proceeds; violations still open the exception choice', async () => {
  const ok = load();
  assert.equal((await ok.enforce({ timeWindowViolations: [], unverifiedRouteIds: [], rulesMissing: false })).proceed, true);
  const late = load();
  const result = await late.enforce({ timeWindowViolations: [{ routeId: 1, customer: 'Tuas', eta: '1:05 PM', receiving: '09:00-13:00', message: 'late' }], unverifiedRouteIds: [], rulesMissing: false });
  assert.equal(result.proceed, false, 'Adjust does not save');
  assert.equal(late.state().modalOpened, 1);
});

test('the ETA step reports routes it could not check', () => {
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /return \{ timeWindowViolations, unverifiedRouteIds, rulesMissing: !DeliveryRules \};/);
});
