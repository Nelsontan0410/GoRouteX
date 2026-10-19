import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLiveView, gpsState, matchesSearch, GPS_FRESH_MS } from '../driver/live-view-model.js';
import { startExecution, arrive, deliver, fail, finish, stopRoute } from '../driver/execution.js';

const NOW = Date.parse('2026-10-19T03:00:00Z');
const stop = (id, extra = {}) => ({ id, name: `Customer ${id}`, address: `${id} Street, Singapore`, lat: 1.3 + id.length / 100, lng: 103.8, contactName: 'Tan', contactPhone: '91234567', orderNumbers: [`SO-${id}`], ...extra });
const route = (stops = [stop('a'), stop('b'), stop('c')]) => ({
  id: 'owner_plan_day', routeId: 'day', routeName: 'All stops', date: '2026-10-19', status: 'DISPATCHED', driverName: 'Ho Chee Kwan', vehicleDriver: '',
  assignedDriverUid: 'drv_1', startTime: '09:00', originName: 'Warehouse', originLatLng: { lat: 1.33, lng: 103.75 }, endLatLng: { lat: 1.33, lng: 103.75 },
  plannedRoutes: [{ id: 'day', customerStops: stops, optimizedStops: stops.map((s) => s.id),
    detailedStopTimes: [{ stopId: 'Warehouse' }, ...stops.map((s, i) => ({ stopId: s.id, arrivalTimeStr: `${9 + i}:30 AM`, departureTimeStr: `${9 + i}:45 AM`, deliveryConstraints: { receiving: '09:00–18:00' } }))] }]
});
const started = (r = route()) => startExecution(r, 'drv_1');
const live = (extra = {}) => ({ status: 'active', networkStatus: 'online', lat: 1.31, lng: 103.81, accuracy: 12, lastUpdatedAt: new Date(NOW - 20000).toISOString(), routeId: 'owner_plan_day', ...extra });

test('dispatched but not started: no start time, no current stop, 0%, no activity, planned values only', () => {
  const view = buildLiveView({ route: route() }, NOW);
  assert.equal(view.status, 'DISPATCHED');
  assert.equal(view.started, false);
  assert.equal(view.actualStart, null);
  assert.equal(view.plannedStart, '09:00');
  assert.equal(view.plannedEnd, '11:45 AM');
  assert.equal(view.current, null);
  assert.equal(view.next, null);
  assert.deepEqual(view.counts, { total: 3, completed: 0, failed: 0, arrived: 0, pending: 3, percent: 0 });
  assert.deepEqual(view.timeline, []);
  assert.equal(view.gps.state, 'none');
  assert.equal(view.gps.label, 'Live GPS unavailable');
  assert.equal(view.stops[0].eta, '9:30 AM');
  assert.equal(view.stops[0].window, '09:00–18:00');
  assert.equal(view.vehicle, null, 'no vehicle shown when none is stored');
  assert.ok(view.stops.every((s) => s.status === 'PENDING' && Number.isFinite(s.lat)));
});

test('started without GPS: in progress, route-started event, next stop known, no current stop until an arrival', () => {
  const execution = started();
  const view = buildLiveView({ route: route(), execution }, NOW);
  assert.equal(view.status, 'IN_PROGRESS');
  assert.equal(view.started, true);
  assert.ok(view.actualStart instanceof Date);
  assert.equal(view.current, null, 'the first pending stop is not assumed to be the current one');
  assert.equal(view.next.name, 'Customer a');
  assert.deepEqual(view.timeline.map((e) => e.kind), ['start']);
  assert.equal(view.gps.state, 'none');
});

test('GPS freshness: live within the tracking contract, stale after it, plus offline, paused, stopped and denied', () => {
  assert.equal(gpsState(live(), NOW).state, 'live');
  assert.equal(gpsState(live({ lastUpdatedAt: new Date(NOW - GPS_FRESH_MS - 1000).toISOString() }), NOW).state, 'stale');
  assert.equal(gpsState(live({ networkStatus: 'offline' }), NOW).state, 'offline');
  assert.equal(gpsState(live({ status: 'paused' }), NOW).state, 'paused');
  assert.equal(gpsState(live({ status: 'stopped' }), NOW).state, 'stopped');
  const denied = gpsState(live({ status: 'error', lastErrorCode: '1', lastErrorMessage: 'Location access was denied by the browser or device settings.' }), NOW);
  assert.equal(denied.state, 'denied');
  assert.match(denied.label, /permission denied/);
  assert.equal(gpsState(live({ lat: null, lng: null }), NOW).state, 'none');
  assert.equal(gpsState(null, NOW).position, null);
});

test('progress: arrived is current, delivered and failed are counted separately, timeline in order', () => {
  let execution = started();
  const [a, b, c] = execution.stops;
  execution = arrive(execution, a.id, null);
  execution = deliver(execution, a.id, { id: 'pod1' });
  execution = fail(execution, b.id, 'Customer closed', '');
  execution = arrive(execution, c.id, null);
  const view = buildLiveView({ route: route(), execution, gps: live(), pods: [{ stopId: a.id, recipientName: 'Lim' }] }, NOW);
  assert.deepEqual(view.counts, { total: 3, completed: 1, failed: 1, arrived: 1, pending: 1, percent: 67 });
  assert.equal(view.current.name, 'Customer c');
  assert.equal(view.next, null);
  assert.equal(view.stops[0].pod.recipient, 'Lim');
  assert.equal(view.stops[1].failureReason, 'Customer closed');
  assert.deepEqual(view.timeline.map((e) => e.kind).sort(), ['arrived', 'arrived', 'delivered', 'failed', 'start']);
  for (let i = 1; i < view.timeline.length; i++) assert.ok(view.timeline[i - 1].at <= view.timeline[i].at);
});

test('completed and stopped-early routes', () => {
  let execution = started(route([stop('a')]));
  execution = arrive(execution, execution.stops[0].id, null);
  execution = deliver(execution, execution.stops[0].id, { id: 'p' });
  const done = buildLiveView({ route: route([stop('a')]), execution: finish(execution) }, NOW);
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.counts.percent, 100);
  assert.equal(done.timeline.at(-1).kind, 'finish');
  const stopped = buildLiveView({ route: route(), execution: stopRoute(started()) }, NOW);
  assert.equal(stopped.status, 'STOPPED');
  assert.equal(stopped.counts.pending, 3);
  assert.equal(stopped.timeline.at(-1).title, 'Route stopped early');
});

test('missing contact, ETA, address and coordinates stay empty (shown as —), never invented', () => {
  const bare = { id: 'x', name: 'Bare stop' };
  const r = route([bare]);
  r.plannedRoutes[0].detailedStopTimes = [];
  const view = buildLiveView({ route: r }, NOW);
  const s = view.stops[0];
  assert.equal(s.address, null);
  assert.equal(s.contactPhone, null);
  assert.equal(s.eta, null);
  assert.equal(s.lat, null);
  assert.equal(view.plannedEnd, null);
});

test('search matches customer, address, order number and contact', () => {
  const view = buildLiveView({ route: route() }, NOW);
  const [a] = view.stops;
  for (const query of ['customer a', 'a street', 'SO-a', '9123', 'tan', '']) assert.equal(matchesSearch(a, query), true, query);
  assert.equal(matchesSearch(a, 'nothing like this'), false);
});

test('the page is read only and draws the driver only for a known GPS state', () => {
  const page = readFileSync(new URL('../driver/operations-page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /firestore|collection\(|method:\s*'(POST|PUT|PATCH|DELETE)'|store\.|DriverRouteStore/, 'no writes from the operations page');
  assert.match(page, /view\.started && gps\.position && \['live', 'stale', 'offline', 'paused'\]\.includes\(gps\.state\)/);
  assert.match(page, /if \(auto\.checked && !document\.hidden && !\$\('trackingWorkspace'\)\.hidden\) load\(\);/);
  assert.match(page, /if \(state\.loading\) return;/, 'no overlapping refreshes');
});
