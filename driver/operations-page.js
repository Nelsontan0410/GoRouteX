const $ = id => document.getElementById(id);
const routeId = new URLSearchParams(location.search).get('dispatchId');
const content = $('operationsReadOnly');
const status = $('operationsStatus');
const list = $('operationsStops');
const text = value => String(value ?? '').trim();
const node = (tag, value = '', className = '') => { const item = document.createElement(tag); item.textContent = value; if (className) item.className = className; return item; };
function blocked(message) { $('trackingLoadingScreen').hidden = true; $('trackingWorkspace').hidden = true; $('trackingBlockedScreen').hidden = false; $('blockedTitle').textContent = 'Route unavailable'; $('blockedMessage').textContent = message; }
async function load() {
  const user = window.FirebaseApp?.auth?.getCurrentUser?.();
  if (!user) return blocked('Sign in to view this route.');
  if (!routeId) return blocked('No dispatched route was selected.');
  try {
    status.textContent = 'Loading route status…';
    const token = await user.getIdToken();
    const response = await fetch(`/.netlify/functions/dispatch?action=monitor&dispatchId=${encodeURIComponent(routeId)}`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok || !result.success || !result.routes?.[0]) throw Error(result.error || 'Route is unavailable.');
    const route = result.routes[0];
    const execution = route.execution;
    const stops = execution?.stops || (route.plannedRoutes?.[0]?.customerStops || []);
    const processed = execution?.stops?.filter(stop => ['DELIVERED', 'FAILED'].includes(stop.executionStatus)).length || 0;
    const delivered = execution?.stops?.filter(stop => stop.executionStatus === 'DELIVERED').length || 0;
    const failed = execution?.stops?.filter(stop => stop.executionStatus === 'FAILED').length || 0;
    const pending = (execution?.stops || []).filter(stop => !['DELIVERED', 'FAILED'].includes(stop.executionStatus));
    const current = pending[0];
    const next = pending[1];
    const gps = route.gps;
    const updated = gps ? new Date(gps.lastUpdatedAt || gps.lastUploadedClientAt || 0) : null;
    const age = updated && Number.isFinite(updated.getTime()) ? Date.now() - updated.getTime() : Infinity;
    const clock = (value) => { const date = new Date(value || NaN); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };
    // Latest thing the driver recorded (arrival, delivery or issue): shown when GPS is not live.
    const activity = (execution?.stops || []).flatMap(stop => [[stop.actualArrivalAt, 'arrived at', stop], [stop.actualCompletedAt, 'delivered', stop], [stop.failedAt, 'reported an issue at', stop]])
      .filter(([at]) => at).sort((a, b) => String(b[0]).localeCompare(String(a[0])))[0];
    const lastSeen = activity ? ` · Last activity ${clock(activity[0])}: ${activity[1]} ${activity[2].stopName || 'stop ' + activity[2].sequence}` : '';
    const gpsLabel = !execution ? 'No GPS: the driver has not started this route'
      : gps?.status === 'error' || gps?.lastErrorMessage && gps?.status !== 'active' ? `GPS problem on the driver's phone: ${gps.lastErrorMessage || 'location unavailable'}${lastSeen}`
      : !gps ? `No GPS update yet${lastSeen}`
      : gps.status === 'stopped' ? `Tracking stopped${lastSeen}`
      : age <= 90000 && age >= 0 ? `GPS live · ${Math.max(1, Math.floor(age / 1000))}s ago`
      : `Last GPS ${clock(updated)}${lastSeen}. Phones pause web pages while Google Maps is open; the position updates when the driver opens GoRouteX.`;
    $('operationsRouteName').textContent = route.routeName || `Route ${route.routeId}`;
    $('operationsDriver').textContent = `Driver: ${route.driverName || '—'}`;
    $('operationsProgress').textContent = `${processed} / ${stops.length} processed · ${delivered} delivered · ${failed} failed`;
    $('operationsCurrent').textContent = current ? `Current stop: ${current.stopName || 'Stop ' + current.sequence}${next ? ' · Next stop: ' + (next.stopName || 'Stop ' + next.sequence) : ''}` : execution ? 'All stops processed' : 'Driver has not started this route';
    $('operationsGps').textContent = gpsLabel;
    const map = $('operationsMap');
    map.hidden = !Number.isFinite(gps?.lat) || !Number.isFinite(gps?.lng);
    if (!map.hidden) map.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(gps.lat + ',' + gps.lng);
    $('operationsRouteState').textContent = execution?.status || route.status || 'DISPATCHED';
    list.replaceChildren();
    const times = route.plannedRoutes?.[0]?.detailedStopTimes || [];
    for (const [index, stop] of stops.entries()) {
      const item = node('li', '', 'operations-stop');
      const id = text(stop.savedStopId || stop.id || stop.uniqueId);
      const eta = times.find(row => text(row.stopId) === id && row.arrivalTimeStr);
      item.append(node('strong', `${index + 1}. ${text(stop.stopName || stop.customerName || stop.Name) || 'Stop'}`));
      item.append(node('span', [stop.deliveryAddress || stop.address || stop.Address, stop.contactName, stop.contactPhone || stop.phone].filter(Boolean).join(' · ') || 'Address unavailable'));
      item.append(node('small', [stop.plannedEta || eta?.arrivalTimeStr ? `ETA ${stop.plannedEta || eta?.arrivalTimeStr}` : '', stop.executionStatus || 'PENDING', (stop.orderNumbers || []).join(' / ')].filter(Boolean).join(' · ')));
      const pod = (route.pods || []).find(row => row.stopId === stop.id);
      if (pod) item.append(node('small', ['POD', pod.recipientName, pod.notes, pod.completedAt].filter(Boolean).join(' · ')));
      list.append(item);
    }
    $('trackingLoadingScreen').hidden = true;
    $('trackingBlockedScreen').hidden = true;
    $('trackingWorkspace').hidden = false;
    status.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
  } catch (error) { blocked(error.message || 'Could not load route status.'); }
}
content.hidden = false;
$('driverExecution').hidden = true;
document.querySelector('.driver-tracking-details').hidden = true;
$('trackingContextNotice').hidden = true;
document.querySelector('.tracking-hero h1').textContent = 'Live route view';
document.querySelector('.tracking-hero p').textContent = 'Read-only route progress for operations.';
$('driverSignOutBtn').hidden = true;
$('operationsRefresh').addEventListener('click', load);
window.FirebaseApp?.auth?.onAuthStateChange?.(() => load());
window.setInterval(() => { if (!$('trackingWorkspace').hidden) load(); }, 15000);
