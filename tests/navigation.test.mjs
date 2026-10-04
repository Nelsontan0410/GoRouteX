import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = read('app.html');
const sidebarSource = read('app-sidebar.js');
const pages = { 'app.html': app, 'order-hub.html': read('order-hub.html'), 'dispatch.html': read('dispatch.html') };

// Minimal DOM to run app-sidebar.js and inspect the markup it renders.
function renderSidebar(active, mobileNav) {
  const root = { dataset: { active, ...(mobileNav ? { mobileNav } : {}) }, setAttribute() {}, innerHTML: '', insertAdjacentElement() {} };
  const document = {
    readyState: 'complete',
    querySelectorAll: (selector) => (selector === '[data-app-sidebar]' ? [root] : []),
    querySelector: () => null,
    addEventListener() {},
    getElementById: () => null,
    createElement: () => ({ setAttribute() {}, innerHTML: '' })
  };
  const window = { document };
  vm.runInNewContext(sidebarSource, { window, document, console });
  return root.innerHTML;
}

test('Dashboard, Order Hub and Dispatch all mount the one shared sidebar with their own active item', () => {
  assert.match(pages['app.html'], /<aside class="operations-sidebar" data-app-sidebar data-active="dashboard"><\/aside>\s*<script src="app-sidebar\.js"><\/script>/);
  assert.match(pages['order-hub.html'], /<aside class="operations-sidebar" data-app-sidebar data-active="order-hub" data-mobile-nav="top"><\/aside><script src="app-sidebar\.js"><\/script>/);
  assert.match(pages['dispatch.html'], /<aside class="operations-sidebar" data-app-sidebar data-active="dispatch" data-mobile-nav="top"><\/aside>\s*<script src="app-sidebar\.js"><\/script>/);
  for (const [name, html] of Object.entries(pages)) assert.match(html, /styles\/app-sidebar\.css/, name);
});

test('the primary sidebar lists only Dashboard, Order Hub and Dispatch, keeps the logo and the account area', () => {
  const html = renderSidebar('order-hub');
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const labels = [...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]).filter((label) => label !== 'Driver Page');
  assert.deepEqual(labels, ['Dashboard', 'Order Hub', 'Dispatch']);
  assert.doesNotMatch(html, /Plan a route|Saved stops/);
  assert.match(html, /class="operations-brand"[^>]*>GoRoute<span>X<\/span>/);
  for (const piece of ['id="sidebarDisplayName"', 'id="sidebarCurrentPlan"', '>Account</a>', '>Settings</a>', '>Logout</button>']) assert.ok(html.includes(piece), piece);
});

test('the active item comes from the page markup, so it survives direct navigation and refresh', () => {
  assert.match(renderSidebar('dispatch'), /href="dispatch\.html" data-nav="dispatch" aria-current="page"/);
  assert.match(renderSidebar('order-hub'), /href="order-hub\.html" data-nav="order-hub" aria-current="page"/);
  assert.match(renderSidebar('dashboard'), /data-nav="dashboard" data-page="page-history-dashboard" aria-current="page"/);
});

test('every page reaches the other two through real links', () => {
  const html = renderSidebar('dashboard');
  for (const href of ['app.html#page-history-dashboard', 'order-hub.html', 'dispatch.html', 'app.html#page-account-access', 'settings.html']) assert.ok(html.includes(`href="${href}"`), href);
});

test('route planning steps keep Dashboard as the active primary item inside app.html', () => {
  assert.match(app, /window\.GoRouteXSidebar\?\.setActive\(activePageId === 'page-account-access' \? 'account' : 'dashboard'\);/);
});

test('Order Hub and Dispatch no longer carry duplicate cross-page navigation in their top areas', () => {
  assert.doesNotMatch(pages['order-hub.html'], /Route workspace|class="topbar"/);
  assert.doesNotMatch(pages['dispatch.html'], /dispatch-mobile-nav|Plan a route<\/a>\s*<a href="app\.html#page-add-stop"/);
  assert.doesNotMatch(pages['dispatch.html'], />Saved stops</);
});

test('Dashboard keeps Start Route Plan, adds Manage Customers, and keeps Load Route and recent plans', () => {
  const hero = app.slice(app.indexOf('class="dashboard-primary-actions"'), app.indexOf('</section>', app.indexOf('class="dashboard-primary-actions"')));
  assert.match(hero, /id="createNewRouteBtn"[^>]*>Start Route Plan</);
  assert.match(hero, /id="manageStopsBtn"[^>]*>Manage Customers</);
  assert.match(hero, /id="loadSelectedRouteBtn"[^>]*>Load Route</);
  assert.doesNotMatch(hero, /hidden>Load Route/);
  assert.match(app, /<section id="historyStatsPanel"[^>]*aria-busy="true">/, 'Recent route plans visible again');
  // Manage Customers opens the Customer Workspace in search mode (existing role-aware handler).
  assert.match(app, /manageStopsBtn\.addEventListener\('click', async \(\) => \{\s*await showPage\('page-add-stop'\);\s*setStopWorkspaceMode\('edit'\);/);
});

test('old bookmarks for Plan a route and Saved stops still resolve', () => {
  const aliases = app.slice(app.indexOf('PAGE_HASH_ALIASES'), app.indexOf('};', app.indexOf('PAGE_HASH_ALIASES')));
  assert.match(aliases, /plan: 'page-select-stops'/);
  assert.match(aliases, /customers: 'page-add-stop'/);
  assert.match(app, /<div id="page-select-stops"/);
  assert.match(app, /<div id="page-add-stop"/);
});

test('mobile tab bar mirrors the primary navigation', () => {
  const bar = app.slice(app.indexOf('<nav id="mobileTabBar"'), app.indexOf('</nav>', app.indexOf('<nav id="mobileTabBar"')));
  assert.match(bar, /order-hub\.html/);
  assert.match(bar, /openDispatchPage\(\)/);
  assert.doesNotMatch(bar, /data-page="page-select-stops"|data-page="page-add-stop"/);
});

test('the account gate also blocks the shared sidebar links while the workspace loads', () => {
  const shell = read('app-shell.js');
  assert.match(shell, /querySelectorAll\('\.operations-sidebar a\[data-nav\]'\)/);
  assert.match(sidebarSource, /function isBlocked\(anchor\) \{\s*return anchor\.getAttribute\('aria-disabled'\) === 'true';/);
});
