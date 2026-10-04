import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../delivery-constraints.js', import.meta.url), 'utf8'), context);
const C = context.GoRouteXDeliveryConstraints;
const plain = (value) => JSON.parse(JSON.stringify(value));
const at = (hhmm) => C.toMinutes(hhmm);

test('global default: Mon–Fri 09:00–18:00 with a 12:00–13:00 break, weekend closed', () => {
  const schedule = C.defaultSchedule();
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) {
    assert.deepEqual(plain(schedule[day]), { open: true, windows: [{ start: '09:00', end: '18:00' }], breaks: [{ start: '12:00', end: '13:00' }] });
  }
  assert.equal(schedule.saturday.open, false);
  assert.equal(schedule.sunday.open, false);
  assert.equal(C.describeSchedule(schedule), 'Mon–Fri 09:00–18:00 (break 12:00–13:00) · Sat–Sun closed');
  assert.equal(C.validateSchedule(schedule).valid, true);
});

test('a new customer inherits the current global values without storing a copy', () => {
  const fields = plain(C.customerConstraintFields({}));
  assert.deepEqual(fields, { deliveryScheduleMode: 'default', serviceTimeMode: 'default' });
  const effective = C.resolveCustomerConstraints(fields, { routePlanning: { serviceMinutes: 15 } });
  assert.equal(effective.scheduleMode, 'default');
  assert.equal(effective.serviceMinutes, 15, 'service time comes from Settings');
  assert.equal(C.describeSchedule(effective.schedule), 'Mon–Fri 09:00–18:00 (break 12:00–13:00) · Sat–Sun closed');
});

test('changing a global default reaches inheriting customers only; overrides are independent', () => {
  const custom = C.defaultSchedule();
  custom.saturday = { open: true, windows: [{ start: '08:00', end: '12:00' }], breaks: [] };
  const inheriting = { deliveryScheduleMode: 'default', serviceTimeMode: 'default' };
  const scheduleOnly = { deliveryScheduleMode: 'custom', customDeliverySchedule: custom, serviceTimeMode: 'default' };
  const serviceOnly = { deliveryScheduleMode: 'default', serviceTimeMode: 'custom', customServiceMinutes: 30 };
  const newGlobal = C.defaultSchedule();
  newGlobal.monday.windows = [{ start: '10:00', end: '17:00' }];
  const settings = { routePlanning: { serviceMinutes: 20, defaultDeliverySchedule: newGlobal } };

  assert.equal(C.resolveCustomerConstraints(inheriting, settings).schedule.monday.windows[0].start, '10:00');
  assert.equal(C.resolveCustomerConstraints(inheriting, settings).serviceMinutes, 20);
  const a = C.resolveCustomerConstraints(scheduleOnly, settings);
  assert.equal(a.scheduleMode, 'custom');
  assert.equal(a.schedule.monday.windows[0].start, '09:00', 'custom schedule unchanged by the new global');
  assert.equal(a.serviceMinutes, 20, 'but service time still inherits');
  const b = C.resolveCustomerConstraints(serviceOnly, settings);
  assert.equal(b.serviceMinutes, 30);
  assert.equal(b.schedule.monday.windows[0].start, '10:00', 'schedule still inherits');
});

test('Return to default clears the override', () => {
  const restored = plain(C.customerConstraintFields({ deliveryScheduleMode: 'default', customDeliverySchedule: C.defaultSchedule(), serviceTimeMode: 'default', customServiceMinutes: 30 }));
  assert.deepEqual(restored, { deliveryScheduleMode: 'default', serviceTimeMode: 'default' });
});

test('a 20-minute service cannot run into the 12:00–13:00 break: 12:30 and 11:50 both wait until 13:00', () => {
  const schedule = C.defaultSchedule();
  const atLunch = C.scheduleService(at('12:30'), 20, schedule, 'monday');
  assert.equal(atLunch.ok, true);
  assert.equal(C.fromMinutes(atLunch.start), '13:00');
  assert.equal(atLunch.waitMinutes, 30);
  const beforeLunch = C.scheduleService(at('11:50'), 20, schedule, 'monday');
  assert.equal(C.fromMinutes(beforeLunch.start), '13:00', 'service would cross noon');
  const fits = C.scheduleService(at('11:40'), 20, schedule, 'monday');
  assert.equal(C.fromMinutes(fits.start), '11:40');
  assert.equal(fits.waitMinutes, 0);
  const early = C.scheduleService(at('08:10'), 20, schedule, 'monday');
  assert.equal(C.fromMinutes(early.start), '09:00', 'arrivals before opening wait');
});

test('closed days and impossible windows are reported, never silently accepted', () => {
  const schedule = C.defaultSchedule();
  assert.equal(C.scheduleService(at('10:00'), 20, schedule, 'saturday').reason, 'closed');
  assert.equal(C.scheduleService(at('17:50'), 20, schedule, 'friday').reason, 'after-hours');
  assert.equal(C.scheduleService(at('09:00'), 400, schedule, 'friday').reason, 'service-too-long');
});

test('validation rejects bad schedules with clear messages', () => {
  const messages = (mutate) => {
    const schedule = C.defaultSchedule();
    mutate(schedule);
    return C.validateSchedule(schedule).errors.map((e) => e.message).join(' | ');
  };
  assert.match(messages((s) => { s.monday.windows = [{ start: '18:00', end: '09:00' }]; }), /end time must be after start time \(overnight hours are not supported\)/);
  assert.match(messages((s) => { s.monday.windows = [{ start: '09:00', end: '09:00' }]; }), /end time must be after start time/);
  assert.match(messages((s) => { s.monday.windows = [{ start: '09:00', end: '13:00' }, { start: '12:00', end: '18:00' }]; s.monday.breaks = []; }), /overlap/);
  assert.match(messages((s) => { s.monday.breaks = [{ start: '18:30', end: '19:00' }]; }), /must be inside the receiving hours/);
  assert.match(messages((s) => { s.saturday.windows = [{ start: '09:00', end: '12:00' }]; }), /closed day cannot have receiving hours/);
  assert.match(messages((s) => { s.monday.windows = []; s.monday.breaks = []; }), /needs receiving hours/);
  assert.match(messages((s) => { s.monday.windows = [{ start: '9am', end: '18:00' }]; }), /HH:MM/);
  for (const bad of [0, -5, 2.5, 'abc', 241]) assert.equal(C.validateServiceMinutes(bad).valid, false, String(bad));
  assert.equal(C.validateServiceMinutes(20).valid, true);
});

test('an invalid custom value falls back to the default rather than breaking planning', () => {
  const broken = C.defaultSchedule();
  broken.monday.windows = [{ start: '18:00', end: '09:00' }];
  const effective = C.resolveCustomerConstraints({ deliveryScheduleMode: 'custom', customDeliverySchedule: broken, serviceTimeMode: 'custom', customServiceMinutes: 0 }, { routePlanning: { serviceMinutes: 15 } });
  assert.equal(effective.scheduleMode, 'default');
  assert.equal(effective.serviceMode, 'default');
});

test('weekday key follows the local calendar day', () => {
  assert.equal(C.dayKeyFromDate(new Date(2026, 9, 5, 10, 0)), 'monday'); // 5 Oct 2026 is a Monday
  assert.equal(C.dayKeyFromDate(new Date(2026, 9, 10, 10, 0)), 'saturday');
  assert.equal(C.dayKeyFromDate(new Date(2026, 9, 11, 10, 0)), 'sunday');
});
