import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
function board() {
  const ctx = vm.createContext({ console, performance: { mark() {}, measure() {}, now: () => 0 }, setTimeout, clearTimeout, sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} } });
  ctx.window = ctx;
  ctx.document = { getElementById: () => null, querySelectorAll: () => [], hidden: false, addEventListener() {} };
  vm.runInContext(read('dispatch/dispatch-board.js'), ctx);
  return ctx.GoRouteXDispatch;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the printed schedule is one list: start, every stop of every route in order with ETA, end; total excludes start/end', () => {
  const stop = (id, name) => ({ id, savedStopId: id, customerName: name, address: `${name} address`, contactName: 'Ah Ming', contactPhone: '9123 4567' });
  const routes = [
    { id: 1, customerStops: [stop('a', 'Tuas'), stop('b', 'Mandai')], optimizedStops: ['wh', 'a', 'b'],
      detailedStopTimes: [{ stopId: 'wh', departureTimeStr: '9:00 AM' }, { stopId: 'a', arrivalTimeStr: '9:22 AM' }, { stopId: 'b', arrivalTimeStr: '10:09 AM' }] },
    { id: 2, customerStops: [stop('c', 'Ubi')], optimizedStops: ['b', 'c', '__dispatch_base__'],
      detailedStopTimes: [{ stopId: 'b', departureTimeStr: '10:29 AM' }, { stopId: 'c', arrivalTimeStr: '11:00 AM' }, { stopId: '__dispatch_base__', arrivalTimeStr: '11:40 AM' }] }
  ];
  const list = plain(board().scheduleList({ routes, origin: 'Warehouse', end: 'Same as Start', startTime: '09:00' }));
  assert.equal(list.totalStops, 3);
  assert.deepEqual(list.start, { name: 'Warehouse', time: '9:00 AM' });
  assert.deepEqual(list.end, { name: 'Same as Start', time: '11:40 AM' });
  assert.deepEqual(list.rows.map((r) => [r.number, r.route, r.name, r.eta]), [[1, 'Route 1', 'Tuas', '9:22 AM'], [2, 'Route 1', 'Mandai', '10:09 AM'], [3, 'Route 2', 'Ubi', '11:00 AM']]);
  assert.equal(list.rows[0].contact, 'Ah Ming · 9123 4567');
});

test('without an end location the list has no End row', () => {
  const routes = [{ id: 1, customerStops: [{ id: 'a', customerName: 'A' }], optimizedStops: ['wh', 'a'], detailedStopTimes: [{ stopId: 'wh', departureTimeStr: '9:00 AM' }, { stopId: 'a', arrivalTimeStr: '9:20 AM' }] }];
  assert.equal(board().scheduleList({ routes }).end, null);
});

test('print is A4, one table for the whole plan, one button in the toolbar', () => {
  const page = read('dispatch/dispatch-page.js');
  assert.match(page, /@page\{size:A4 portrait;margin:12mm\}/);
  assert.match(page, /`Total stops: \$\{list\.totalStops\}`/);
  assert.match(page, /`Vehicle: \$\{vehicle \|\| '—'\}`/);
  assert.match(page, /<th>Customer \/ Orders<\/th><th>Address \/ Contact<\/th><th>ETA<\/th><th>Completed \/ Sign<\/th>/, 'no # or Route column');
  assert.match(page, /<div class="head"><h1>GoRouteX Schedule List<\/h1><span class="meta" id="meta"><\/span><\/div>/, 'details on the title row');
  assert.match(read('dispatch.html'), /id="dispatchPrintAllBtn"/);
  assert.doesNotMatch(read('dispatch/dispatch-board.js'), /state\.options\.printRoute\(/);
});

test('the schedule list can be shared to a WhatsApp group with the same content', () => {
  const list = { start: { name: 'Warehouse', time: '9:00 AM' }, end: { name: 'Warehouse', time: '5:50 PM' }, totalStops: 2,
    rows: [{ number: 1, name: 'Tuas', orders: 'DO-1', address: '61a Tuas Nexus Drive', contact: 'Ah Ming · 9124 5558', eta: '9:34 AM' }, { number: 2, name: 'Mandai', orders: '', address: '34 Mandai Estate', contact: '', eta: '10:33 AM' }] };
  const text = board().scheduleText(list, { date: '2026-10-12', driver: 'Ho Chee Kwan', vehicle: 'YQ3896B' });
  assert.equal(text, [
    'GoRouteX Schedule List',
    'Date: 2026-10-12 ; Total stops: 2 ; Driver: Ho Chee Kwan ; Vehicle: YQ3896B',
    '',
    'Start: Warehouse · departs 9:00 AM',
    '1. Tuas (Orders: DO-1)',
    '   61a Tuas Nexus Drive · Ah Ming · 9124 5558 · ETA 9:34 AM',
    '2. Mandai',
    '   34 Mandai Estate · ETA 10:33 AM',
    'End: Warehouse · arrives 5:50 PM'
  ].join('\n'));
  const page = read('dispatch/dispatch-page.js');
  assert.match(page, /<button id="shareWhatsApp">Share to WhatsApp group<\/button>/);
  assert.match(page, /popup\.open\(`https:\/\/wa\.me\/\?text=\$\{encodeURIComponent\(message\)\}`/);
});
