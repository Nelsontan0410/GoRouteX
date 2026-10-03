import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../route-safety.js', import.meta.url), 'utf8');
const start = source.indexOf("  const PANEL_STATE_VERSION = 'v1';");
const end = source.indexOf('  function placeOptions', start);
assert.ok(start >= 0 && end > start, 'panel-state implementation must exist');

function setup({ sessionThrows = false } = {}) {
  const storage = new Map();
  const events = [];
  const summaryText = { textContent: '' };
  const codeControl = { focus: () => events.push('code-focus') };
  const panelToggleButton = { parentElement: null, attributes: new Map(), setAttribute(k, v) { this.attributes.set(k, v); }, focus: () => events.push('button-focus') };
  const optionsSummary = { hidden: false, querySelector: () => summaryText, append(node) { node.parentElement = this; } };
  const optionsContent = { hidden: false, querySelector: () => codeControl, append(node) { node.parentElement = this; } };
  const context = {
    optionsSection: { classList: { toggle() {} } }, optionsSummary, optionsContent, panelToggleButton,
    sessionStorage: {
      getItem(key) { if (sessionThrows) throw new Error('blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (sessionThrows) throw new Error('blocked'); storage.set(key, value); }
    },
    config: { enabled: true, selectedCodes: ['4002', '1011'] },
    settings() { return context.config; },
    global: { FirebaseApp: { auth: { getCurrentUser: () => context.user } } }
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)};global.__panel = { panelStorageKey, readPanelCollapsed, writePanelCollapsed, panelSummaryText, renderPanelPresentation, collapseOptions, expandOptions };`, context);
  context.panel = context.global.__panel;
  return { context, storage, events, summaryText, optionsSummary, optionsContent, panelToggleButton };
}

test('Done preserves selected codes and collapses to a compact account-scoped summary', () => {
  const fixture = setup(); fixture.context.user = { uid: 'account-a' };
  fixture.context.panel.collapseOptions();
  assert.equal(fixture.optionsSummary.hidden, false);
  assert.equal(fixture.optionsContent.hidden, true);
  assert.equal(fixture.summaryText.textContent, 'Singapore restrictions · 2 codes selected');
  assert.equal(fixture.storage.get('goroutex.lorry.panel.v1.account-account-a'), 'collapsed');
  assert.deepEqual(fixture.context.config.selectedCodes, ['4002', '1011']);
  assert.deepEqual(fixture.events, ['button-focus']);
});

test('Edit restores controls and focus without changing enabled or selected codes', () => {
  const fixture = setup(); fixture.context.user = { uid: 'account-a' };
  fixture.context.panel.collapseOptions(); fixture.events.length = 0;
  fixture.context.panel.expandOptions();
  assert.equal(fixture.optionsSummary.hidden, false);
  assert.equal(fixture.panelToggleButton.parentElement, fixture.optionsSummary);
  assert.equal(fixture.optionsContent.hidden, false);
  assert.equal(fixture.storage.get('goroutex.lorry.panel.v1.account-account-a'), 'expanded');
  assert.equal(fixture.panelToggleButton.attributes.get('aria-expanded'), 'true');
  assert.deepEqual(fixture.context.config, { enabled: true, selectedCodes: ['4002', '1011'] });
  assert.deepEqual(fixture.events, ['code-focus']);
});

test('selection count is the restriction activation state', () => {
  const fixture = setup(); fixture.context.user = { uid: 'account-a' };
  fixture.context.config = { enabled: true, selectedCodes: ['4002'] };
  assert.equal(fixture.context.panel.panelSummaryText(), 'Singapore restrictions · 1 code selected');
  fixture.context.config = { enabled: false, selectedCodes: [] };
  assert.equal(fixture.context.panel.panelSummaryText(), 'Singapore restrictions · Select restriction codes');
});

test('anonymous and signed-in accounts do not share a folding preference', () => {
  const fixture = setup();
  fixture.context.user = null; fixture.context.panel.writePanelCollapsed(true);
  fixture.context.user = { uid: 'account-a' };
  assert.equal(fixture.context.panel.readPanelCollapsed(), false);
  fixture.context.panel.writePanelCollapsed(false);
  fixture.context.user = null;
  assert.equal(fixture.context.panel.readPanelCollapsed(), true);
});

test('blocked session storage still supports Done and Edit for the open page', () => {
  const fixture = setup({ sessionThrows: true }); fixture.context.user = { uid: 'account-a' };
  fixture.context.panel.collapseOptions();
  assert.equal(fixture.optionsContent.hidden, true);
  fixture.context.panel.expandOptions();
  assert.equal(fixture.optionsContent.hidden, false);
});
