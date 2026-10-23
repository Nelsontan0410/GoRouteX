import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const source = readFileSync(new URL('../orders/order-hub.js', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.split('setup();\n')[0].replace(/^import .*;\n/gm, '') + `
    let renders = 0;
    renderOrders = () => { renders++; };
    globalThis.fixture = { state, clear: clearSelectedOrders, renders: () => renders };
  `, context);
  return context.fixture;
}

test('clearing removes every selection across pages and filters without changing orders or import selections', () => {
  const { state, clear, renders } = fixture();
  state.orders = [{ internalId: 'visible', status: 'READY' }, { internalId: 'other-page', status: 'NEEDS_REVIEW' }, { internalId: 'filtered-out', status: 'READY' }];
  state.selected = new Set(state.orders.map(order => order.internalId));
  state.included = new Set(['import-row']);
  state.preview = [{ internalId: 'import-row', status: 'READY' }];
  state.page = 1; state.detailId = 'visible'; state.issueFilter = 'Address needed';
  state.store = new Proxy({}, { get() { throw Error('Clear selected must not access storage'); } });
  const before = JSON.stringify({ orders: state.orders, preview: state.preview, included: [...state.included], page: state.page, detailId: state.detailId, issueFilter: state.issueFilter });
  clear();
  assert.equal(state.selected.size, 0);
  assert.equal(renders(), 1);
  assert.equal(JSON.stringify({ orders: state.orders, preview: state.preview, included: [...state.included], page: state.page, detailId: state.detailId, issueFilter: state.issueFilter }), before);
});

test('clear selected respects an operation in progress and an empty selection', () => {
  const { state, clear, renders } = fixture();
  state.selected.add('order'); state.busy = true;
  clear(); assert.equal(state.selected.size, 1); assert.equal(renders(), 0);
  state.busy = false; clear(); clear();
  assert.equal(state.selected.size, 0); assert.equal(renders(), 1);
});
