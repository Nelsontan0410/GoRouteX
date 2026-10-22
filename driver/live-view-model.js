/**
 * Live Route View: turns the monitor response (dispatch document, driver execution, live GPS, PODs) into what
 * the page shows. Pure: no DOM, no network, so every state can be tested. Nothing is invented: a value that
 * is not in the stored data is null and the page shows "—".
 */
import { snapshotRouteStops } from './route-model.js';

/** A position at most this old is live; older is stale; older than LIVE_STALE_WARN_MS is a warning. */
export const LIVE_FRESH_MS = 120000;
export const LIVE_STALE_WARN_MS = 600000;
export const GPS_FRESH_MS = LIVE_FRESH_MS;

/** Why the driver's phone may not be sending (gpsHint, written by driver-tracking.js). */
export const GPS_HINT_LABELS = {
  WAITING_FIRST_FIX: 'Waiting for the driver’s first GPS fix',
  UPLOAD_FAILED: 'The driver’s phone could not upload its position',
  PAGE_BACKGROUND: 'The driver’s phone has GoRouteX in the background (probably using Google Maps)',
  PERMISSION_DENIED: 'Location permission denied on the driver’s phone',
  OFFLINE: 'Driver’s phone is offline'
};

const text = (value) => String(value ?? '').trim();
const time = (value) => {
  if (!value) return null;
  const date = new Date(typeof value === 'object' && typeof value.toDate === 'function' ? value.toDate() : value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Planned arrival per stop id from the saved schedule (detailedStopTimes). */
function scheduleById(route) {
  const rows = (route?.plannedRoutes || []).flatMap((group) => (Array.isArray(group?.detailedStopTimes) ? group.detailedStopTimes : []));
  const map = new Map();
  for (const row of rows) if (text(row?.stopId) && !map.has(text(row.stopId))) map.set(text(row.stopId), row);
  return { map, rows };
}

/**
 * GPS state, from the live document only when it belongs to this route (the server already checks routeId).
 * Age is the position's own time (positionAt; older documents: lastUploadedClientAt / lastUpdatedAt).
 * live: within LIVE_FRESH_MS. stale: older; warn: older than LIVE_STALE_WARN_MS. none: no position yet.
 * offline / paused / stopped / denied / error: as reported by the driver's phone. hint: gpsHint reason.
 */
export function gpsState(gps, now = Date.now()) {
  if (!gps) return { state: 'none', label: 'Live GPS unavailable', position: null, updatedAt: null };
  const updatedAt = time(gps.positionAt) || time(gps.lastUploadedClientAt) || time(gps.lastUpdatedAt);
  const lat = finite(gps.lat), lng = finite(gps.lng);
  const accuracy = finite(gps.accuracy);
  const approximate = gps.approximate === true;
  const position = lat !== null && lng !== null ? { lat, lng, accuracy, approximate } : null;
  const age = updatedAt ? now - updatedAt.getTime() : Infinity;
  const hint = GPS_HINT_LABELS[text(gps.gpsHint)] ? text(gps.gpsHint) : null;
  const reason = hint ? GPS_HINT_LABELS[hint] : null;
  const denied = String(gps.lastErrorCode) === '1' || /denied/i.test(text(gps.lastErrorMessage)) || (hint === 'PERMISSION_DENIED' && gps.status !== 'active');
  if (gps.status === 'error' || (denied && gps.status !== 'active')) {
    return { state: denied ? 'denied' : 'error', label: denied ? GPS_HINT_LABELS.PERMISSION_DENIED : `GPS error: ${text(gps.lastErrorMessage) || 'location unavailable'}`, position, updatedAt, hint };
  }
  if (gps.status === 'stopped') return { state: 'stopped', label: 'Tracking stopped', position, updatedAt, hint };
  if (gps.status === 'paused') return { state: 'paused', label: 'Tracking paused by the driver', position, updatedAt, hint };
  if (gps.networkStatus === 'offline') return { state: 'offline', label: GPS_HINT_LABELS.OFFLINE, position, updatedAt, hint };
  if (!position) return { state: 'none', label: reason || GPS_HINT_LABELS.WAITING_FIRST_FIX, position: null, updatedAt: null, hint };
  if (age >= 0 && age <= LIVE_FRESH_MS) {
    const label = approximate ? `Approximate position ±${Math.round(accuracy ?? 0)} m` : 'Live';
    return { state: 'live', label, position, updatedAt, ageMs: age, approximate, hint };
  }
  const minutes = Number.isFinite(age) ? Math.max(1, Math.round(age / 60000)) : null;
  const warn = !Number.isFinite(age) || age > LIVE_STALE_WARN_MS;
  const base = minutes === null ? 'GPS stale' : warn ? `No GPS update for ${minutes} min` : `Last position ${minutes} min ago`;
  const why = hint && hint !== 'WAITING_FIRST_FIX' ? reason : null;
  return { state: 'stale', label: why ? `${base} · ${why}` : base, position, updatedAt, ageMs: age, warn, approximate, hint };
}

/** Builds everything the Live Route View renders. */
export function buildLiveView({ route, execution = null, gps = null, pods = [] } = {}, now = Date.now()) {
  const planned = snapshotRouteStops(route || {});
  const executed = Array.isArray(execution?.stops) && execution.stops.length ? execution.stops : null;
  const { map: schedule, rows: scheduleRows } = scheduleById(route);
  const stops = (executed || planned).map((stop, index) => {
    const plan = planned.find((item) => item.savedStopId && item.savedStopId === stop.savedStopId) || planned[index] || {};
    const row = schedule.get(text(stop.savedStopId)) || null;
    const pod = (pods || []).find((item) => item.stopId === stop.id) || null;
    const status = executed ? text(stop.executionStatus) || 'PENDING' : 'PENDING';
    return {
      id: stop.id,
      sequence: stop.sequence || index + 1,
      name: text(stop.stopName || stop.customerName) || `Stop ${index + 1}`,
      customer: text(stop.customerName) && text(stop.customerName) !== text(stop.stopName) ? text(stop.customerName) : '',
      address: text(stop.deliveryAddress) || null,
      contactName: text(stop.contactName) || null,
      contactPhone: text(stop.contactPhone) || null,
      orders: (stop.orderNumbers?.length ? stop.orderNumbers : stop.orderIds || []).map(text).filter(Boolean),
      lat: finite(stop.lat) ?? finite(plan.lat),
      lng: finite(stop.lng) ?? finite(plan.lng),
      eta: text(stop.plannedEta || row?.arrivalTimeStr) || null,
      window: text(row?.deliveryConstraints?.receiving) || null,
      status,
      arrivedAt: time(stop.actualArrivalAt),
      completedAt: time(stop.actualCompletedAt),
      failedAt: time(stop.failedAt),
      failureReason: text(stop.failureReason) || null,
      failureNotes: text(stop.failureNotes) || null,
      notes: text(stop.notes) || null,
      pod: pod ? { recipient: text(pod.recipientName) || null, notes: text(pod.notes) || null } : null
    };
  });

  const counts = {
    total: stops.length,
    completed: stops.filter((stop) => stop.status === 'DELIVERED').length,
    failed: stops.filter((stop) => stop.status === 'FAILED').length,
    arrived: stops.filter((stop) => stop.status === 'ARRIVED').length
  };
  counts.pending = counts.total - counts.completed - counts.failed;
  counts.percent = counts.total ? Math.round((100 * (counts.completed + counts.failed)) / counts.total) : 0;

  const executionStatus = text(execution?.status) || null;
  const status = executionStatus || text(route?.status) || 'DISPATCHED';
  const started = Boolean(executed);
  const active = executionStatus === 'IN_PROGRESS';
  // Current stop only when the driver recorded an arrival; otherwise only the next stop in sequence is known.
  const current = active ? stops.find((stop) => stop.status === 'ARRIVED') || null : null;
  const outstanding = stops.filter((stop) => stop.status === 'PENDING');
  const next = active ? outstanding[0] || null : null;

  const timeline = [];
  if (started && time(execution.actualStartAt)) timeline.push({ at: time(execution.actualStartAt), kind: 'start', title: 'Route started', detail: text(route?.originName) || null });
  for (const stop of stops) {
    if (stop.arrivedAt) timeline.push({ at: stop.arrivedAt, kind: 'arrived', title: `Arrived at stop ${stop.sequence}`, detail: stop.name, stopId: stop.id });
    if (stop.completedAt) timeline.push({ at: stop.completedAt, kind: 'delivered', title: `Stop ${stop.sequence} delivered`, detail: stop.name, stopId: stop.id });
    if (stop.failedAt) timeline.push({ at: stop.failedAt, kind: 'failed', title: `Stop ${stop.sequence} failed`, detail: [stop.name, stop.failureReason].filter(Boolean).join(' · '), stopId: stop.id });
  }
  if (time(execution?.pausedAt) && executionStatus === 'PAUSED') timeline.push({ at: time(execution.pausedAt), kind: 'paused', title: 'Route paused', detail: null });
  if (time(execution?.actualEndAt)) timeline.push({ at: time(execution.actualEndAt), kind: executionStatus === 'COMPLETED' ? 'finish' : 'stopped', title: executionStatus === 'COMPLETED' ? 'Route completed' : 'Route stopped early', detail: null });
  timeline.sort((a, b) => a.at - b.at);

  const lastPlanned = scheduleRows[scheduleRows.length - 1];
  return {
    routeName: text(route?.routeName) || (route?.routeId ? `Route ${route.routeId}` : 'Route'),
    routeRef: [text(route?.date || route?.planningDate), text(route?.routeId)].filter(Boolean).join('_') || null,
    driverName: text(route?.driverName) || null,
    vehicle: text(route?.vehicleDriver) || null,
    date: text(route?.date || route?.planningDate) || null,
    status,
    started,
    active,
    actualStart: started ? time(execution.actualStartAt) : null,
    plannedStart: text(route?.startTime || route?.routeStartTime) || null,
    plannedEnd: text(lastPlanned?.departureTimeStr || lastPlanned?.arrivalTimeStr) || null,
    actualEnd: time(execution?.actualEndAt),
    origin: route?.originLatLng && finite(route.originLatLng.lat) !== null ? { lat: route.originLatLng.lat, lng: route.originLatLng.lng, label: text(route.originName) || 'Start' } : null,
    end: route?.endLatLng && finite(route.endLatLng.lat) !== null ? { lat: route.endLatLng.lat, lng: route.endLatLng.lng, label: text(route.endLocationLabel) || 'End' } : null,
    stops,
    counts,
    current,
    next,
    timeline,
    gps: gpsState(gps, now)
  };
}

/** Case-insensitive search over customer, address, orders and contact. */
export function matchesSearch(stop, query) {
  const q = text(query).toLowerCase();
  if (!q) return true;
  return [stop.name, stop.customer, stop.address, stop.contactName, stop.contactPhone, ...(stop.orders || [])].some((value) => text(value).toLowerCase().includes(q));
}
