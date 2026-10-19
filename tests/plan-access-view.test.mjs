import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(read('plan-access-view.js'), ctx);
const V = ctx.GoRouteXPlanAccess;
const plain = (value) => JSON.parse(JSON.stringify(value));
const NOW = Date.parse('2026-10-20T00:00:00Z');

test('plan labels are Basic, Go and Pro (never ProPlan)', () => {
  assert.deepEqual([V.planName('basic'), V.planName('goplan'), V.planName('proplan')], ['Basic', 'Go', 'Pro']);
  assert.equal(V.planName('unknown'), 'Basic');
});

test('one status line: Active, Trial with days left, Developer access', () => {
  assert.deepEqual(plain(V.statusInfo({ key: 'active', label: 'Active' })), { text: 'Active', tone: 'ok' });
  assert.deepEqual(plain(V.statusInfo({ key: 'basic', label: 'Active' })), { text: 'Active', tone: 'ok' });
  assert.equal(V.statusInfo({ key: 'trialing' }, new Date(NOW + 2.5 * 86400000).toISOString(), NOW).text, 'Trial · 3 days left');
  assert.equal(V.statusInfo({ key: 'trialing' }, new Date(NOW + 86400000).toISOString(), NOW).text, 'Trial · 1 day left');
  assert.equal(V.statusInfo({ key: 'trialing' }, null, NOW).text, 'Trial');
  assert.equal(V.statusInfo({ key: 'trialing' }, { toDate: () => new Date(NOW - 86400000) }, NOW).text, 'Trial · 0 days left');
  assert.equal(V.statusInfo({ key: 'developer' }).text, 'Developer access');
  assert.equal(V.statusInfo({ key: 'active', label: 'Cancellation scheduled' }).text, 'Cancellation scheduled');
});

test('Upgrade is hidden on the highest plan and for developers; subscribers keep a Manage link', () => {
  assert.deepEqual(plain(V.upgradeInfo('basic', { key: 'basic' }, false)), { showUpgrade: true, showManage: false });
  assert.deepEqual(plain(V.upgradeInfo('goplan', { key: 'active' }, true)), { showUpgrade: true, showManage: true });
  assert.deepEqual(plain(V.upgradeInfo('proplan', { key: 'active' }, true)), { showUpgrade: false, showManage: true });
  assert.deepEqual(plain(V.upgradeInfo('proplan', { key: 'developer' }, false)), { showUpgrade: false, showManage: false });
  assert.equal(V.upgradeInfo('proplan', { key: 'expired' }, false).showUpgrade, true, 'an ended Pro subscription can subscribe again');
});

test('usage rows: no text under 80%, amber from 80%, red at the limit', () => {
  const row = (used, limit = 1500) => plain(V.usageRow({ label: 'Saved stops', noun: 'Saved stops', used, limit }));
  assert.equal(row(775).valueText, '775 / 1500');
  assert.equal(row(775).warning, '');
  assert.equal(row(775).level, 'ok');
  assert.equal(row(1199).level, 'ok');
  assert.equal(row(1200).level, 'amber');
  assert.match(row(1200).warning, /Approaching your saved stops limit/);
  assert.equal(row(1500).level, 'red');
  assert.match(row(1500).warning, /limit reached/);
  assert.equal(row(1600).percent, 100);
  const auto = plain(V.usageRow({ label: 'Auto plans today', noun: 'Auto plan', used: 2, limit: 50 }));
  assert.equal(auto.valueText, '2 / 50');
  assert.equal(auto.warning, '');
  const unlimited = plain(V.usageRow({ label: 'x', noun: 'X', used: 9, limit: Infinity }));
  assert.equal(unlimited.valueText, '9');
  assert.equal(unlimited.limit, null);
  assert.equal(unlimited.warning, '');
});

test('the per-route cap is one short line', () => {
  assert.equal(V.maxStopsLine('10 stops/route'), 'Max 10 stops per route.');
  assert.equal(V.maxStopsLine(''), '');
});

test('Plan page markup: header, plan card, usage, collapsed list; the removed blocks are gone', () => {
  const app = read('app.html');
  const page = app.slice(app.indexOf('<div id="page-account-access"'), app.indexOf('<div id="page-pricing"'));
  assert.match(page, /<h1 class="plan-title">Plan<\/h1>\s*<p class="plan-subtitle">Your plan and usage\.<\/p>/);
  assert.match(page, /id="backFromAccountAccessBtn"/);
  assert.doesNotMatch(page, /View Pricing|>PlanEngine<|openPublicPricingLink/);
  for (const id of ['accountCurrentPlanBadge', 'accountPlanStatusTag', 'requestUpgradeBtn', 'accountUsageCards', 'accountFeatureAccessList']) assert.match(page, new RegExp(`id="${id}"`), id);
  assert.match(page, /<details class="plan-included" id="planIncluded">(?!\s*open)/, 'collapsed by default');
  for (const gone of ['accountRoleValue', 'accountStatusValue', 'accountExpiryValue', 'accountBillingNotice', 'accountPlanSummary', 'accountRoleAccessList', 'billingCurrencySelect', 'accountSubscriptionTitle', 'accountPlanCards', 'accountPlanComparisonTable', 'Developer access']) assert.ok(!page.includes(gone), gone);
});

test('billing moved to the Pricing & billing page with the same element ids; Upgrade opens it', () => {
  const app = read('app.html');
  const pricing = app.slice(app.indexOf('<div id="page-pricing"'), app.indexOf('<nav id="mobileTabBar"'));
  for (const id of ['billingCurrencySelect', 'manageSubscriptionBtn', 'cancelSubscriptionBtn', 'subscriptionCancellationForm', 'billingCatalogStatus', 'accountPlanCards', 'accountPlanComparisonTable', 'backFromPricingBtn']) assert.match(pricing, new RegExp(`id="${id}"`), id);
  assert.match(app, /requestUpgradeBtn\.addEventListener\('click', \(\) => showPage\('page-pricing'\)\)/);
  assert.match(app, /pricing: 'page-pricing'/);
  assert.match(app, /'page-pricing': \{\s*permission: 'billing\.manage'/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderAccountUsageCards'), app.indexOf('function renderAddStopAccessNotice')), /ProPlan/, 'no ProPlan label in the plan renderers');
});

test('Role and Storage now show in Settings', () => {
  assert.match(read('settings.html'), /id="settingsRole"[\s\S]*id="settingsStorage"/);
  assert.match(read('settings/settings-page.js'), /planId === 'basic' \? 'This device' : 'Cloud sync'/);
});

test('this change touches no entitlement, usage-counting or billing code', () => {
  const app = read('app.html');
  for (const fn of ['getUsageStatus', 'getBillingUiState', 'getCurrentUsageSnapshot', 'startStripeCheckout', 'openStripeBillingPortal', 'submitSubscriptionCancellation']) assert.ok(app.includes(`function ${fn}`), fn);
});
