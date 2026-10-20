import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function setup() {
  const elements = new Map();
  const radios = { deliveryScheduleMode: 'default', serviceTimeMode: 'default', deliveryHours: 'full' };
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', dataset: {}, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; }, setAttribute() {} });
    return elements.get(id);
  };
  const document = { readyState: 'loading', addEventListener() {}, getElementById: get, querySelectorAll: () => [],
    querySelector(selector) {
      const name = selector.match(/name="([^"]+)"/)[1];
      const value = selector.match(/value="([^"]+)"/)?.[1];
      return value ? { set checked(v) { if (v) radios[name] = value; } } : { value: radios[name] };
    }
  };
  const context = vm.createContext({ document, addEventListener() {}, confirm: () => false });
  context.window = context;
  for (const file of ['delivery-constraints.js', 'customer-constraints-form.js']) vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  context.GoRouteXScheduleEditor = { render(el, value) { el.schedule = structuredClone(value); }, read(el) { return el.schedule; } };
  context.GoRouteXCustomerConstraints.init();
  return { api: context.GoRouteXCustomerConstraints, C: context.GoRouteXDeliveryConstraints, get, radios, context };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('new customer defaults to weekdays full day without changing Settings or service inheritance', () => {
  const { api, C } = setup();
  const result = api.read();
  assert.deepEqual(plain(result.errors), []);
  assert.equal(result.fields.serviceTimeMode, 'default');
  assert.deepEqual(plain(result.fields.customDeliverySchedule.monday), { open: true, windows: [{ start: '09:00', end: '18:00' }], breaks: [] });
  assert.equal(C.defaultSchedule().monday.breaks.length, 1);
});

test('all simple presets round-trip exactly and exclude unselected days', () => {
  const { api } = setup();
  for (const [weekdays, weekend, hours] of [[true, false, 'full'], [false, true, 'am'], [true, true, 'pm']]) {
    const schedule = api.simpleSchedule(weekdays, weekend, hours);
    api.set({ deliveryScheduleMode: 'custom', customDeliverySchedule: schedule });
    assert.deepEqual(plain(api.read().fields.customDeliverySchedule), plain(schedule));
    assert.deepEqual(plain(api.detectSimple(schedule)), { weekdays, weekend, hours });
  }
});

test('selecting neither day blocks saving', () => {
  const { api, get } = setup();
  get('deliveryWeekdays').checked = false;
  get('deliveryWeekend').checked = false;
  assert.equal(api.read().fields, null);
  assert.match(api.read().errors.join(' '), /Select Weekdays or Weekend/);
});

test('existing default customers keep live inheritance and custom schedules keep breaks and all windows', () => {
  const { api, C, get } = setup();
  api.set({ id: 'old' });
  assert.equal(api.read().fields.deliveryScheduleMode, 'default');
  assert.equal(api.read().fields.customDeliverySchedule, undefined);
  const schedule = C.defaultSchedule();
  schedule.monday.windows = [{ start: '08:00', end: '14:00' }, { start: '15:00', end: '19:00' }];
  api.set({ deliveryScheduleMode: 'custom', customDeliverySchedule: schedule });
  assert.equal(get('customDeliverySchedule').hidden, false);
  assert.deepEqual(plain(api.read().fields.customDeliverySchedule), plain(schedule));
  get('toggleAdvancedTimingBtn').listeners.click();
  assert.equal(get('customDeliverySchedule').hidden, false, 'declining replacement leaves the schedule intact');
  assert.deepEqual(plain(api.read().fields.customDeliverySchedule), plain(schedule));
});

test('simple to advanced retains exact hours and returning to default clears the override', () => {
  const { api, get } = setup();
  const original = plain(api.read().fields.customDeliverySchedule);
  get('toggleAdvancedTimingBtn').listeners.click();
  assert.deepEqual(plain(api.read().fields.customDeliverySchedule), original);
  get('toggleAdvancedTimingBtn').listeners.click();
  assert.deepEqual(plain(api.read().fields.customDeliverySchedule), original);
  get('resetDeliveryScheduleBtn').listeners.click();
  assert.equal(api.read().fields.deliveryScheduleMode, 'default');
  assert.equal(api.read().fields.customDeliverySchedule, undefined);
});

test('the shared editor reads additional receiving intervals and breaks without dropping them', () => {
  const { context, C } = setup();
  vm.runInContext(readFileSync(new URL('../delivery-schedule-editor.js', import.meta.url), 'utf8'), context);
  const schedule = C.defaultSchedule();
  schedule.monday.windows.push({ start: '19:00', end: '21:00' });
  schedule.monday.breaks.push({ start: '16:00', end: '16:30' });
  const container = { querySelector(selector) {
    const day = schedule[selector.match(/data-day="([^"]+)"/)[1]];
    return {
      querySelector(selector) {
        const field = selector.match(/data-field="([^"]+)"/)[1];
        if (field === 'open') return { checked: day.open };
        const range = field.startsWith('break') ? day.breaks[0] : day.windows[0];
        return { value: range?.[field.endsWith('End') || field === 'end' ? 'end' : 'start'] || '' };
      },
      querySelectorAll(selector) {
        return day[selector.match(/data-extra="([^"]+)"/)[1]].slice(1).map(range => ({
          querySelector(selector) { return { value: range[selector.includes('start') ? 'start' : 'end'] }; }
        }));
      }
    };
  } };
  assert.deepEqual(plain(context.GoRouteXScheduleEditor.read(container)), plain(schedule));
});
