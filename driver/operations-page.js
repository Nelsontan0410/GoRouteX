// Live Route View (Dispatch → View live): read-only operations dashboard for one dispatched route.
// Data comes from the existing monitor endpoint (dispatch document, driver execution, live GPS, PODs);
// driver/live-view-model.js turns it into what is shown. Nothing here writes data.
import { buildLiveView, matchesSearch } from './live-view-model.js';
import { navigationUrl, callUrl } from './navigation.js';

const $ = id => document.getElementById(id);
const routeId = new URLSearchParams(location.search).get('dispatchId');
const REFRESH_MS = 15000;
const state = { view: null, selectedId: null, search: '', loading: false, loadedAt: null, map: null, markers: new Map(), extraMarkers: [], info: null, fittedKey: '' };

const text = value => String(value ?? '').trim();
const dash = value => (text(value) ? text(value) : '—');
const node = (tag, value = '', className = '') => { const item = document.createElement(tag); if (value !== '') item.textContent = value; if (className) item.className = className; return item; };
const clock = date => (date instanceof Date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const STATUS_LABEL = { PENDING: 'Pending', ARRIVED: 'Arrived', DELIVERED: 'Delivered', FAILED: 'Failed' };
const STATUS_COLOR = { PENDING: '#7b8798', ARRIVED: '#2456c4', DELIVERED: '#16834f', FAILED: '#c22b3f' };
const ROUTE_STATUS = { DISPATCHED: ['Dispatched · not started', 'is-dispatched'], IN_PROGRESS: ['In progress', 'is-progress'], PAUSED: ['Paused', 'is-paused'], STOPPED: ['Stopped early', 'is-stopped'], COMPLETED: ['Completed', 'is-completed'] };

function blocked(message) { $('trackingLoadingScreen').hidden = true; $('trackingWorkspace').hidden = true; $('trackingBlockedScreen').hidden = false; $('blockedTitle').textContent = 'Route unavailable'; $('blockedMessage').textContent = message; }

function whatsappUrl(phone) {
  let digits = text(phone).replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (/^[689]\d{7}$/.test(digits)) digits = `65${digits}`; // Singapore local number
  return /^\d{8,15}$/.test(digits) ? `https://wa.me/${digits}` : null;
}

function pill(status) { return node('span', STATUS_LABEL[status] || status, `live-pill is-${status.toLowerCase()}`); }

// ---- Header and driver card ----
function renderHeader(view) {
  const [label, cls] = ROUTE_STATUS[view.status] || [view.status, ''];
  const chip = $('liveStatusChip');
  chip.textContent = label;
  chip.className = `live-chip ${cls}`;
  $('liveSubtitle').textContent = [view.routeName, view.date, view.driverName ? `Driver: ${view.driverName}` : ''].filter(Boolean).join(' · ');
  $('operationsDriver').textContent = view.driverName || 'Driver not named';
  $('liveDriverAvatar').textContent = (view.driverName || '?').slice(0, 1).toUpperCase();
  $('liveRouteRef').textContent = view.routeRef ? `Route ${view.routeRef}` : '';
  const done = view.counts.completed + view.counts.failed;
  $('liveRingText').textContent = `${done} / ${view.counts.total}`;
  $('liveRingValue').setAttribute('stroke-dasharray', `${view.counts.percent} 100`);
  $('liveRingValue').style.visibility = view.counts.percent > 0 ? 'visible' : 'hidden';
  $('liveRing').setAttribute('aria-label', `${done} of ${view.counts.total} stops processed (${view.counts.percent}%)`);
  $('liveTotal').textContent = view.counts.total;
  $('liveDone').textContent = view.counts.completed;
  $('liveFailed').textContent = view.counts.failed;
  $('livePending').textContent = view.counts.pending;
  const facts = [
    ['Status', view.started ? label : 'Route not started'],
    view.vehicle ? ['Vehicle', view.vehicle] : null,
    view.actualStart ? ['Started', clock(view.actualStart)] : ['Planned start', dash(view.plannedStart)],
    view.actualEnd ? [view.status === 'COMPLETED' ? 'Finished' : 'Stopped', clock(view.actualEnd)] : ['Planned end', dash(view.plannedEnd)],
    ['Last GPS update', view.gps.updatedAt ? clock(view.gps.updatedAt) : '—'],
    ['GPS', view.gps.label]
  ].filter(Boolean);
  $('liveFacts').replaceChildren(...facts.map(([term, value]) => { const row = node('div'); row.append(node('dt', term), node('dd', value)); return row; }));
}

function renderGpsLine(view) {
  const line = $('liveGpsLine');
  const { gps } = view;
  const tone = gps.state === 'live' ? (gps.approximate ? 'is-warn' : 'is-live') : gps.state === 'stale' && gps.warn ? 'is-bad' : ['stale', 'offline', 'paused'].includes(gps.state) ? 'is-warn' : ['denied', 'error'].includes(gps.state) ? 'is-bad' : 'is-none';
  line.className = `live-gps-line ${tone}`;
  if (!view.started) line.textContent = 'Live GPS unavailable: the driver has not started this route.';
  else if (gps.state === 'live') line.textContent = `${gps.approximate ? gps.label : 'GPS live'} · updated ${Math.max(1, Math.round(gps.ageMs / 1000))}s ago`;
  else if (gps.state === 'stale') line.textContent = `${gps.label} · last position ${clock(gps.updatedAt)} (shown grey).${gps.hint ? '' : ' A browser pauses GoRouteX while Google Maps is open; it updates when the driver opens GoRouteX again.'}`;
  else line.textContent = gps.updatedAt ? `${gps.label} · last update ${clock(gps.updatedAt)}` : gps.label;
}

// ---- Current / next stop ----
function stopCard(title, stop, badge) {
  const card = node('article', '', 'live-stop-card');
  const head = node('header');
  head.append(node('h3', title), badge);
  const row = node('div', '', 'live-stop-row');
  row.append(node('span', String(stop.sequence), `live-stop-number${stop.status === 'ARRIVED' ? ' is-arrived' : ''}`));
  const body = node('div');
  body.append(node('strong', stop.name), node('span', dash(stop.address), 'live-muted'));
  if (stop.contactName || stop.contactPhone) body.append(node('span', [stop.contactName, stop.contactPhone].filter(Boolean).join(' · '), 'live-muted'));
  const eta = node('div', '', 'live-stop-eta');
  eta.append(node('small', stop.status === 'ARRIVED' ? 'Arrived' : 'ETA'), node('strong', stop.status === 'ARRIVED' ? clock(stop.arrivedAt) || '—' : dash(stop.eta)));
  row.append(body, eta);
  const actions = node('div', '', 'live-actions');
  const links = [['Open in Maps', navigationUrl(stop)], ['Call', callUrl(stop)], ['WhatsApp', whatsappUrl(stop.contactPhone)]];
  for (const [label, href] of links) {
    if (!href) continue;
    const link = node('a', label, 'live-button');
    link.href = href;
    if (href.startsWith('http')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    actions.append(link);
  }
  card.append(head, row);
  if (actions.childElementCount) card.append(actions);
  return card;
}

function emptyState(title, message) { const box = node('div', '', 'live-empty'); box.append(node('strong', title), node('span', message)); return box; }

function renderActivity(view) {
  const box = $('liveActivity');
  const title = node('h2', 'Current activity', 'live-card-title');
  const pending = view.counts.pending;
  if (!view.started) return box.replaceChildren(title, emptyState('No active delivery', 'The driver has not started this route.'));
  if (view.status === 'COMPLETED') return box.replaceChildren(title, emptyState('Route completed', `Finished at ${clock(view.actualEnd) || '—'}.`));
  if (view.status === 'STOPPED') return box.replaceChildren(title, emptyState('Route stopped early', `Stopped at ${clock(view.actualEnd) || '—'} · ${pending} stop(s) not delivered.`));
  const parts = [title];
  if (view.status === 'PAUSED') parts.push(emptyState('Route paused', 'The driver paused this route.'));
  if (view.current) parts.push(stopCard('Current stop', view.current, pill('ARRIVED')));
  else if (view.status !== 'PAUSED') parts.push(emptyState('Between stops', 'No arrival is recorded right now.'));
  if (view.next) parts.push(stopCard('Next stop', view.next, pill('PENDING')));
  box.replaceChildren(...parts);
}

// ---- Timeline ----
function renderTimeline(view) {
  const list = $('liveTimeline');
  if (!view.timeline.length) {
    const item = node('li', '', 'live-empty');
    item.append(node('strong', 'No activity yet'), node('span', 'Route activity will appear after the driver starts.'));
    return list.replaceChildren(item);
  }
  list.replaceChildren(...view.timeline.map(event => {
    const item = node('li');
    const copy = node('div');
    copy.append(node('strong', event.title));
    if (event.detail) copy.append(node('span', event.detail));
    item.append(node('time', clock(event.at)), node('span', '', `mark is-${event.kind}`), copy);
    return item;
  }));
}

// ---- Stops table and detail ----
function renderStops(view) {
  const rows = view.stops.filter(stop => matchesSearch(stop, state.search));
  $('liveStopsTitle').textContent = state.search ? `Stops (${rows.length} of ${view.stops.length})` : `Stops (${view.stops.length})`;
  const body = $('operationsStops');
  if (!rows.length) {
    const row = node('tr');
    const cell = node('td', view.stops.length ? 'No stop matches this search.' : 'This route has no stops.');
    cell.colSpan = 7;
    row.append(cell);
    return body.replaceChildren(row);
  }
  body.replaceChildren(...rows.map(stop => {
    const row = node('tr');
    row.dataset.stopId = stop.id;
    row.tabIndex = 0;
    if (stop.id === state.selectedId) row.classList.add('is-selected');
    const main = node('td', '', 'cell-main');
    const name = node('strong', stop.name);
    name.title = stop.name;
    const address = node('span', dash(stop.address));
    address.title = stop.address || '';
    main.append(name, address);
    const status = node('td', '', 'cell-status');
    status.append(pill(stop.status));
    const actual = stop.completedAt ? clock(stop.completedAt) : stop.failedAt ? clock(stop.failedAt) : stop.arrivedAt ? `Arrived ${clock(stop.arrivedAt)}` : '—';
    const details = node('td', '', 'cell-view');
    details.append(node('button', 'View', 'live-button'));
    row.append(node('td', String(stop.sequence), 'cell-seq'), status, main, node('td', dash(stop.contactPhone || stop.contactName), 'cell-contact'), node('td', dash(stop.eta), 'cell-eta'), node('td', actual, `cell-actual${stop.completedAt ? ' is-done' : stop.failedAt ? ' is-failed' : ''}`), details);
    return row;
  }));
}

function renderDetail(view) {
  const box = $('liveStopDetail');
  const stop = view.stops.find(item => item.id === state.selectedId);
  if (!stop) { box.hidden = true; return; }
  const head = node('header');
  head.append(node('h3', `${stop.sequence}. ${stop.name}`));
  const close = node('button', 'Close', 'live-button');
  close.type = 'button';
  close.addEventListener('click', () => select(null));
  head.append(close);
  const fields = [
    ['Status', STATUS_LABEL[stop.status] || stop.status], ['Customer', stop.customer || stop.name], ['Address', stop.address], ['Orders', stop.orders.join(', ')],
    ['Delivery window', stop.window], ['Contact', [stop.contactName, stop.contactPhone].filter(Boolean).join(' · ')], ['ETA (planned)', stop.eta],
    ['Arrived', clock(stop.arrivedAt)], ['Delivered', clock(stop.completedAt)], ['Failed', clock(stop.failedAt)], ['Failure reason', [stop.failureReason, stop.failureNotes].filter(Boolean).join(' · ')],
    ['Received by', stop.pod?.recipient], ['POD notes', stop.pod?.notes], ['Notes', stop.notes]
  ];
  const list = node('dl');
  for (const [term, value] of fields) {
    if (!text(value) && !['Address', 'Contact', 'ETA (planned)'].includes(term)) continue;
    const row = node('div');
    row.append(node('dt', term), node('dd', dash(value)));
    list.append(row);
  }
  box.replaceChildren(head, list);
  box.hidden = false;
}

function select(stopId, { fromMap = false } = {}) {
  state.selectedId = stopId;
  if (!state.view) return;
  renderStops(state.view);
  renderDetail(state.view);
  const marker = stopId ? state.markers.get(stopId) : null;
  if (marker && state.map) {
    if (!fromMap) state.map.panTo(marker.getPosition());
    openInfo(marker, state.view.stops.find(stop => stop.id === stopId));
  } else state.info?.close();
}

// ---- Map (Google Maps, already loaded by this page) ----
function mapsReady() { return Boolean(window.google?.maps?.Map); }

function markerIcon(color, scale = 13, stroke = '#ffffff') {
  return { path: window.google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeColor: stroke, strokeWeight: 2, scale };
}

function openInfo(marker, stop) {
  if (!stop || !state.map) return;
  const content = node('div');
  content.style.maxWidth = '240px';
  content.append(node('strong', `${stop.sequence}. ${stop.name}`), node('div', dash(stop.address)), node('div', `${STATUS_LABEL[stop.status] || stop.status} · ETA ${dash(stop.eta)}`));
  state.info = state.info || new window.google.maps.InfoWindow();
  state.info.setContent(content);
  state.info.open({ map: state.map, anchor: marker });
}

function renderMap(view) {
  const empty = $('liveMapEmpty');
  const located = view.stops.filter(stop => stop.lat !== null && stop.lng !== null);
  if (!located.length) {
    empty.textContent = 'These stops have no saved map positions, so they cannot be shown on the map.';
    empty.hidden = false;
    return;
  }
  if (!mapsReady()) {
    empty.textContent = 'Loading map…';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const { maps } = window.google;
  if (!state.map) {
    state.map = new maps.Map($('liveMap'), { center: { lat: located[0].lat, lng: located[0].lng }, zoom: 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false });
  }
  // Stop markers: update in place so a refresh keeps the user's zoom, pan and open info window.
  const seen = new Set();
  for (const stop of located) {
    seen.add(stop.id);
    const options = { position: { lat: stop.lat, lng: stop.lng }, icon: markerIcon(STATUS_COLOR[stop.status] || STATUS_COLOR.PENDING), label: { text: String(stop.sequence), color: '#ffffff', fontSize: '11px', fontWeight: '700' }, title: `${stop.sequence}. ${stop.name}`, zIndex: 10 + stop.sequence };
    let marker = state.markers.get(stop.id);
    if (marker) marker.setOptions(options);
    else {
      marker = new maps.Marker({ ...options, map: state.map });
      marker.addListener('click', () => select(stop.id, { fromMap: true }));
      state.markers.set(stop.id, marker);
    }
  }
  for (const [id, marker] of state.markers) if (!seen.has(id)) { marker.setMap(null); state.markers.delete(id); }
  // Start, end and driver are redrawn each time (few markers).
  state.extraMarkers.forEach(marker => marker.setMap(null));
  state.extraMarkers = [];
  const place = (point, label, color, title, zIndex) => state.extraMarkers.push(new maps.Marker({ map: state.map, position: { lat: point.lat, lng: point.lng }, icon: { ...markerIcon(color, 11), path: maps.SymbolPath.CIRCLE }, label: { text: label, color: '#ffffff', fontSize: '10px', fontWeight: '700' }, title, zIndex }));
  if (view.origin) place(view.origin, 'S', '#0f172a', `Start: ${view.origin.label}`, 5);
  if (view.end && !(view.origin && Math.abs(view.end.lat - view.origin.lat) < 1e-6 && Math.abs(view.end.lng - view.origin.lng) < 1e-6)) place(view.end, 'E', '#0f172a', `End: ${view.end.label}`, 5);
  // The driver marker only for a position of this route; an old position is grey and titled "last known".
  const { gps } = view;
  if (view.started && gps.position && ['live', 'stale', 'offline', 'paused'].includes(gps.state)) {
    const live = gps.state === 'live';
    state.extraMarkers.push(new maps.Marker({ map: state.map, position: { lat: gps.position.lat, lng: gps.position.lng }, icon: markerIcon(live ? '#7c3aed' : '#9aa3b2', 10, live ? '#ede9fe' : '#ffffff'), title: live ? 'Driver (live)' : `Driver last known position · ${clock(gps.updatedAt)}`, zIndex: 1000, opacity: live ? 1 : 0.75 }));
  }
  // Fit once per set of stops, not on every refresh.
  const key = located.map(stop => stop.id).join('|');
  if (state.fittedKey !== key) {
    const bounds = new maps.LatLngBounds();
    located.forEach(stop => bounds.extend({ lat: stop.lat, lng: stop.lng }));
    if (view.origin) bounds.extend(view.origin);
    state.map.fitBounds(bounds, 48);
    state.fittedKey = key;
  }
}

function render() {
  const view = state.view;
  if (!view) return;
  renderHeader(view);
  renderGpsLine(view);
  renderActivity(view);
  renderTimeline(view);
  if (state.selectedId && !view.stops.some(stop => stop.id === state.selectedId)) state.selectedId = null;
  renderStops(view);
  renderDetail(view);
  renderMap(view);
}

// ---- Data ----
async function load() {
  const user = window.FirebaseApp?.auth?.getCurrentUser?.();
  if (!user) return blocked('Sign in to view this route.');
  if (!routeId) return blocked('No dispatched route was selected.');
  if (state.loading) return;
  state.loading = true;
  $('operationsStatus').textContent = 'Refreshing…';
  try {
    const token = await user.getIdToken();
    const response = await fetch(`/.netlify/functions/dispatch?action=monitor&dispatchId=${encodeURIComponent(routeId)}`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok || !result.success || !result.routes?.[0]) throw Error(result.error || 'Route is unavailable.');
    const route = result.routes[0];
    state.view = buildLiveView({ route, execution: route.execution, gps: route.gps, pods: route.pods });
    state.loadedAt = new Date();
    $('liveError').hidden = true;
    $('trackingLoadingScreen').hidden = true;
    $('trackingBlockedScreen').hidden = true;
    $('trackingWorkspace').hidden = false;
    render();
    $('operationsStatus').textContent = `Last updated ${state.loadedAt.toLocaleTimeString()}`;
  } catch (error) {
    // After a first successful load keep showing that data and say the refresh failed.
    if (!state.view) blocked(error.message || 'Could not load route status.');
    else {
      $('liveError').textContent = `Could not refresh: ${error.message || 'network error'}. Showing data from ${state.loadedAt.toLocaleTimeString()}.`;
      $('liveError').hidden = false;
      $('operationsStatus').textContent = `Last updated ${state.loadedAt.toLocaleTimeString()}`;
    }
  } finally {
    state.loading = false;
  }
}

// ---- Page setup ----
document.body.classList.add('is-live-view');
document.title = 'Live Route View · GoRouteX';
$('operationsReadOnly').hidden = false;
$('driverExecution').hidden = true;
document.querySelector('.driver-tracking-details').hidden = true;
$('trackingContextNotice').hidden = true;
$('driverSignOutBtn').hidden = true;
// Live view opens in the same tab: give a way back to the app (the Dispatch page it came from, or home).
const back = $('operationsBackLink');
try { const from = new URL(document.referrer); if (from.origin === location.origin && from.pathname.endsWith('/dispatch.html')) back.href = from.pathname + from.search; } catch {}
$('blockedSecondaryAction').href = back.href;
$('blockedSecondaryAction').textContent = 'Back to Dispatch';

$('operationsRefresh').addEventListener('click', load);
$('operationsStops').addEventListener('click', event => { const row = event.target.closest('tr[data-stop-id]'); if (row) select(row.dataset.stopId === state.selectedId && !event.target.closest('button') ? null : row.dataset.stopId); });
$('operationsStops').addEventListener('keydown', event => { const row = event.target.closest('tr[data-stop-id]'); if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(row.dataset.stopId); } });
$('liveSearch').addEventListener('input', event => { state.search = event.target.value; if (state.view) renderStops(state.view); });

const auto = $('liveAutoRefresh');
try { auto.checked = localStorage.getItem('grxLiveAutoRefresh') !== 'off'; } catch {}
auto.addEventListener('change', () => { try { localStorage.setItem('grxLiveAutoRefresh', auto.checked ? 'on' : 'off'); } catch {} });
// One timer; skipped while hidden, switched off, or a request is still running.
const timer = window.setInterval(() => { if (auto.checked && !document.hidden && !$('trackingWorkspace').hidden) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && auto.checked && state.view) load(); });
window.addEventListener('pagehide', () => window.clearInterval(timer));

// Google Maps calls this when the key is rejected for this site: say so instead of Google's grey error box.
window.gm_authFailure = () => { $('liveMapEmpty').textContent = 'Map unavailable (Google Maps rejected the key for this address). The stop list below is complete.'; $('liveMapEmpty').hidden = false; };
// Google Maps loads asynchronously with the page; draw the map when it is ready.
const onMapsReady = () => { if (state.view) renderMap(state.view); };
if (window.__driverTrackingMapReady) onMapsReady();
else window.DriverTrackingPage = { onMapApiReady: onMapsReady };
window.setTimeout(() => { if (!mapsReady() && state.view) { $('liveMapEmpty').textContent = 'Map unavailable right now. The stop list below is complete.'; $('liveMapEmpty').hidden = false; } }, 12000);

window.FirebaseApp?.auth?.onAuthStateChange?.(() => load());
