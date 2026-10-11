(function (global) {
  const $ = id => document.getElementById(id);
  const state = { context: null, loadedPlan: null, drivers: [], driversLoaded: false, dispatched: [], loading: false, refreshTimer: null, options: null, generation: 0, refreshPromise: null, statusPollPromise: null, planLoadPromise: null, planLoadUid: null, driverCache: null, refreshKey: '', activeRouteId: null, authUnsubscribe: null, authUid: null };
  const text = value => String(value ?? '').trim();
  const counters = global.GoRouteXDispatchCounters = { refreshCalls: 0, mergedRefreshes: 0, staleResponses: 0, cacheHits: 0, cacheMisses: 0 };
  const dispatchTiming = name => { try { performance.mark(`grx:${name}`); } catch { /* Optional measurement. */ } };
  const element = (tag, value = '', className = '') => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };

  async function api(action, payload, query = {}) {
    const user = global.FirebaseApp?.auth?.getCurrentUser?.();
    if (!user) throw Error('Sign in to manage Dispatch.');
    const started = performance.now();
    const token = await user.getIdToken();
    const params = new URLSearchParams({ action, ...query });
    const response = await fetch(`/.netlify/functions/dispatch${payload ? '' : `?${params}`}`, {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload ? JSON.stringify({ action, ...payload }) : undefined
    });
    const result = await response.json();
    try {
      global.GoRouteXDispatchPerf = global.GoRouteXDispatchPerf || [];
      global.GoRouteXDispatchPerf.push({ action, durationMs: Math.round(performance.now() - started), serverTiming: response.headers.get('Server-Timing'), counts: response.headers.get('X-Dispatch-Counts'), responseBytes: response.headers.get('X-Dispatch-Response-Bytes') });
      if (global.GoRouteXDispatchPerf.length > 30) global.GoRouteXDispatchPerf.shift();
    } catch {}
    if (!response.ok || !result.success) throw Error(result.error || 'Dispatch request failed.');
    return result;
  }

  function notice(message, error = false) {
    const node = $('dispatchNotice');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', error);
    node.hidden = !message;
  }

  function isViewActive() {
    if (typeof state.options?.isActive === 'function') return state.options.isActive();
    return Boolean($('page-optimized-routes')?.classList.contains('active-page'));
  }

  function selectedDriver(routeId) {
    return text($(`dispatchDriver_${routeId}`)?.value);
  }

  // One driver runs Route 1, 2, 3 in turn: one choice fills every route. Remembered on this device.
  const DEFAULT_DRIVER_KEY = 'grxDispatchDefaultDriver';
  function defaultDriver() {
    let remembered = '';
    try { remembered = localStorage.getItem(DEFAULT_DRIVER_KEY) || ''; } catch {}
    if (remembered && state.drivers.some(driver => driver.uid === remembered)) return remembered;
    return state.drivers.length === 1 ? state.drivers[0].uid : '';
  }
  function renderAllDriverSelect(context, saved) {
    const select = $('dispatchAllDriver');
    if (!select) return;
    select.replaceChildren(new Option(state.drivers.length ? 'Select driver' : state.driversLoaded ? 'No active drivers' : 'Loading drivers...', ''));
    for (const driver of state.drivers) select.append(new Option(`${driver.name} · ${driver.username ? '@' + driver.username : driver.email}`, driver.uid));
    select.value = defaultDriver();
    select.disabled = !saved || state.loading || !state.drivers.length;
    select.onchange = () => {
      try { localStorage.setItem(DEFAULT_DRIVER_KEY, select.value); } catch {}
      for (const route of context?.routes || []) {
        const routeId = routeKey(route);
        if (dispatchOf(context, route)) continue;
        try { sessionStorage.setItem(`grxDispatchDriver:${context.planId}:${routeId}`, select.value); } catch {}
      }
      render();
    };
  }

  function routeKey(route) { return text(route?.id); }
  // The dispatch record of a route; the whole-day route also matches routes dispatched one by one earlier.
  function dispatchOf(context, route) {
    const ids = [routeKey(route), ...(route?.routeIds || []).map(text)];
    return state.dispatched.find(item => item.dispatchPlanId === context?.planId && ids.includes(String(item.routeId))) || null;
  }
  const statusRouteIds = context => [...new Set((context?.routes || []).flatMap(route => [routeKey(route), ...(route.routeIds || []).map(text)]))].join(',');
  function lookupTiming(route, stop) {
    const id = text(stop?.savedStopId || stop?.id || stop?.uniqueId);
    const timings = Array.isArray(route.detailedStopTimes) ? route.detailedStopTimes : [];
    return timings.find(item => text(item.stopId) === id && item.arrivalTimeStr)
      || timings.find(item => text(item.address).toLowerCase() === text(stop.deliveryAddress || stop.address || stop.Address).toLowerCase() && item.arrivalTimeStr);
  }
  function routeHasEta(route) { return routeStops(route).length > 0 && routeStops(route).every(stop => Boolean(lookupTiming(route, stop)?.arrivalTimeStr)); }
  function routeStops(route) {
    const source = Array.isArray(route.customerStops) ? route.customerStops : [];
    const byId = new Map(source.map(stop => [text(stop.savedStopId || stop.id || stop.uniqueId), stop]));
    const order = (Array.isArray(route.optimizedStops) ? route.optimizedStops.slice(1) : route.originalWaypoints || [])
      .map(id => byId.get(text(id))).filter(Boolean);
    const seen = new Set(order);
    return [...order, ...source.filter(stop => !seen.has(stop))];
  }
  // The whole day as one list for the printed schedule: start, every delivery stop in driving order
  // (Route 1, then Route 2, ...), end. totalStops counts delivery stops only.
  function scheduleList(context) {
    const routes = context?.routes || [];
    const rows = [];
    for (const route of routes) {
      for (const stop of routeStops(route)) {
        const timing = lookupTiming(route, stop);
        rows.push({
          number: rows.length + 1,
          route: `Route ${routeKey(route)}`,
          name: text(stop.customerName || stop.Name || stop.stopName || stop.name) || 'Stop',
          orders: Array.isArray(stop.orderNumbers) ? stop.orderNumbers.join(' / ') : '',
          address: text(stop.deliveryAddress || stop.address || stop.Address) || '—',
          contact: [stop.contactName, stop.contactPhone || stop.phone || stop['Hp No']].filter(Boolean).join(' · '),
          eta: text(timing?.arrivalTimeStr) || '—'
        });
      }
    }
    const first = routes[0]?.detailedStopTimes?.[0];
    const lastRoute = routes[routes.length - 1];
    const lastTimes = Array.isArray(lastRoute?.detailedStopTimes) ? lastRoute.detailedStopTimes : [];
    const deliveryIds = new Set(lastRoute ? routeStops(lastRoute).map(stop => text(stop.savedStopId || stop.id || stop.uniqueId)) : []);
    const endTiming = lastTimes.length && !deliveryIds.has(text(lastTimes[lastTimes.length - 1]?.stopId)) ? lastTimes[lastTimes.length - 1] : null;
    return {
      start: { name: text(context?.origin) || 'Start', time: text(first?.departureTimeStr) || text(context?.startTime) || '—' },
      rows,
      end: endTiming ? { name: text(context?.end) || 'End', time: text(endTiming.arrivalTimeStr) || '—' } : null,
      totalStops: rows.length
    };
  }

  function duration(route) {
    const legs = route.directionsResult?.routes?.[0]?.legs || [];
    const seconds = legs.reduce((sum, leg) => sum + Number(leg.duration?.value || 0), 0);
    const total = seconds || Number(route.estimatedDurationSeconds || 0);
    return total ? `${Math.floor(total / 3600)}h ${Math.round(total % 3600 / 60)}m` : '—';
  }
  function formatSeconds(seconds) {
    const total = Number(seconds);
    return total > 0 ? `${Math.floor(total / 3600)}h ${Math.round(total % 3600 / 60)}m` : '—';
  }
  function distance(route) {
    const legs = route.directionsResult?.routes?.[0]?.legs || [];
    const metres = legs.reduce((sum, leg) => sum + Number(leg.distance?.value || 0), 0);
    const total = metres || Number(route.estimatedDistanceMeters || 0);
    return total ? `${(total / 1000).toFixed(1)} km` : '—';
  }
  function gpsLabel(gps) {
    if (!gps) return 'GPS unavailable';
    const updated = new Date(gps.lastUpdatedAt || gps.lastUploadedClientAt || 0);
    const age = Date.now() - updated.getTime();
    if (!Number.isFinite(age) || age < 0) return 'GPS unavailable';
    if (gps.status === 'stopped') return 'Tracking stopped';
    if (age > 90000) return `GPS stale · ${Math.floor(age / 60000)}m ago`;
    return `GPS live · ${Math.max(1, Math.floor(age / 1000))}s ago`;
  }

  function render() {
    const board = $('dispatchBoard');
    const routesNode = $('dispatchRoutes');
    if (!board || !routesNode) return;
    const context = state.context;
    routesNode.replaceChildren();
    const tabsNode = $('dispatchRouteTabs');
    if (tabsNode) tabsNode.hidden = (state.context?.routes?.length || 0) <= 1; // one day route: no tabs
    tabsNode?.replaceChildren();
    if (!context?.routes?.length) {
      $('dispatchPlanSummary').textContent = '';
      $('dispatchAllBtn').disabled = true;
      routesNode.append(element('p', 'No finalized route plan available.', 'dispatch-empty'));
      const plan = element('button', 'Plan a route', 'action-button-primary');
      plan.type = 'button'; plan.onclick = () => { global.location.href = 'app.html#page-select-stops'; };
      routesNode.append(plan);
      return;
    }
    $('dispatchPlanSummary').textContent = `${context.date || 'Date unavailable'} · ${context.startTime || 'Start time unavailable'} · ${context.routes.length} route${context.routes.length === 1 ? '' : 's'} · ${context.routes.reduce((n, route) => n + routeStops(route).length, 0)} stops`;
    const saved = Boolean(context.planId);
    if (!context.routes.some(route => routeKey(route) === state.activeRouteId)) state.activeRouteId = routeKey(context.routes[0]);
    renderAllDriverSelect(context, saved);
    const printAll = $('dispatchPrintAllBtn');
    if (printAll) printAll.disabled = !context.routes.every(routeHasEta) || (state.options?.canPrintRoute && !state.options.canPrintRoute(context.routes[0]));
    $('dispatchAllBtn').disabled = !saved || state.loading || !state.drivers.length || context.routes.every(route => dispatchOf(context, route));
    for (const route of context.routes) {
      const routeId = routeKey(route);
      const dispatch = dispatchOf(context, route);
      const stops = routeStops(route);
      const card = element('article', '', 'dispatch-route-card');
      card.dataset.routeId = routeId;
      const head = element('div', '', 'dispatch-route-head');
      const title = element('h3', route.label || `Route ${routeId}`);
      const status = element('span', dispatch?.execution?.status || (dispatch ? 'DISPATCHED' : saved ? (routeHasEta(route) ? 'READY TO DISPATCH' : 'ETA REQUIRED') : 'SAVE PLAN FIRST'), 'dispatch-status');
      status.classList.add('dispatch-status-value');
      head.append(title, status);
      card.append(head, element('p', `${stops.length} stops · Total distance ${distance(route)} · Driving ${duration(route)} · Total time incl. service ${formatSeconds(route.dayElapsedSeconds)}`, 'dispatch-route-metrics'));
      card.append(element('p', `Planning date: ${context.date || '—'} · Start: ${context.startTime || '—'}`, 'dispatch-route-meta'));
      card.append(element('p', `From: ${context.origin || '—'} · To: ${context.end || '—'}`, 'dispatch-route-meta'));
      const assignment = element('div', '', 'dispatch-assignment');
      const label = element('label', 'Driver');
      const select = document.createElement('select');
      select.id = `dispatchDriver_${routeId}`;
      select.disabled = Boolean(dispatch) || !saved || state.loading;
      select.append(new Option(state.drivers.length ? 'Select driver' : state.driversLoaded ? 'No active drivers' : 'Loading drivers...', ''));
      for (const driver of state.drivers) select.append(new Option(`${driver.name} · ${driver.username ? '@' + driver.username : driver.email}`, driver.uid));
      if (dispatch?.assignedDriverUid) select.value = dispatch.assignedDriverUid;
      else { try { select.value = sessionStorage.getItem(`grxDispatchDriver:${context.planId}:${routeId}`) || defaultDriver(); } catch { select.value = defaultDriver(); } }
      select.addEventListener('change', () => { try { sessionStorage.setItem(`grxDispatchDriver:${context.planId}:${routeId}`, select.value); } catch {} });
      label.append(select);
      assignment.append(label);
      card.append(assignment);
      const actions = element('div', '', 'dispatch-actions');
      if (!dispatch) {
        // A plan of several routes (older plans) can still be sent route by route; one day route uses the toolbar button.
        if (context.routes.length > 1) {
          const send = element('button', 'Dispatch route', 'action-button-primary');
          send.type = 'button'; send.disabled = !saved || !routeHasEta(route) || state.loading || !state.drivers.length;
          send.onclick = () => dispatchRoutes([route]);
          actions.append(send);
        }
      } else {
        const live = element('a', 'View live', 'action-button-primary');
        live.href = `driver-tracking.html?mode=operations&dispatchId=${encodeURIComponent(dispatch.id)}`;
        actions.append(live);
        const done = Number(dispatch.execution?.completedStops || 0);
        const total = Number(dispatch.execution?.totalStops || stops.length);
        card.append(element('p', `Driver: ${dispatch.driverName || '—'} · Progress: ${done} / ${total}`, 'dispatch-progress'));
      }
      card.append(actions);
      const list = element('ol', '', 'dispatch-stop-list');
      for (const [index, stop] of stops.entries()) {
        const timing = lookupTiming(route, stop);
        const row = element('li', '', 'dispatch-stop');
        row.append(element('strong', `${index + 1}. ${text(stop.customerName || stop.Name || stop.stopName || stop.name) || 'Stop'}`));
        const location = text(stop.stopName || stop.label);
        const address = text(stop.deliveryAddress || stop.address || stop.Address);
        row.append(element('span', [location, address].filter(Boolean).join(' · ') || 'Address unavailable'));
        const detail = [stop.contactName, stop.contactPhone || stop.phone || stop['Hp No'], (stop.orderNumbers || []).join(' / ')].filter(Boolean).join(' · ');
        if (detail) row.append(element('small', detail));
        row.append(element('b', timing?.arrivalTimeStr ? `ETA ${timing.arrivalTimeStr}` : 'ETA unavailable'));
        list.append(row);
      }
      card.append(list);
      routesNode.append(card);
      if (tabsNode) {
        const tab = element('button', `Route ${routeId}`, 'dispatch-route-tab');
        tab.type = 'button';
        tab.dataset.routeId = routeId;
        tab.setAttribute('role', 'tab');
        tab.addEventListener('click', () => selectRoute(routeId));
        tabsNode.append(tab);
      }
    }
    selectRoute(state.activeRouteId);
  }

  function selectRoute(routeId) {
    state.activeRouteId = String(routeId);
    document.querySelectorAll('#dispatchRoutes .dispatch-route-card').forEach(card => {
      card.hidden = card.dataset.routeId !== state.activeRouteId;
    });
    document.querySelectorAll('#dispatchRouteTabs .dispatch-route-tab').forEach(tab => {
      const active = tab.dataset.routeId === state.activeRouteId;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
  }

  function contextFromPlan(plan) {
    // One driver's day: the planned 10-stop groups are dispatched as one 'All stops' route (dispatch/day-route.js).
    const groups = (plan.plannedRoutes || []).filter(route => route && Array.isArray(route.customerStops));
    const day = global.GoRouteXDayRoute?.mergeDayRoute(groups);
    return { planId: String(plan.id), routes: day ? [day] : groups,
      planVersion: plan.planVersion, snapshotSchemaVersion: plan.snapshotSchemaVersion,
      date: plan.date || plan.planningDate, startTime: plan.startTime || plan.routeStartTime,
      origin: plan.originName || plan.origin, end: plan.endLocationLabel || plan.end,
      vehicle: plan.vehicleDriver || plan.plannedRoutes?.find(route => route?.vehicleDriver)?.vehicleDriver || '' };
  }

  function currentContext() {
    const live = state.options?.getContext?.() || null;
    return live?.planId ? live : state.loadedPlan ? contextFromPlan(state.loadedPlan) : live;
  }

  function patchStatus(routes) {
    const prior = state.dispatched;
    state.dispatched = routes;
    if (prior.length !== routes.length || prior.some(item => !routes.some(next => next.id === item.id))) { render(); return; }
    const cardMap = new Map([...document.querySelectorAll('#dispatchRoutes .dispatch-route-card')].map(node => [node.dataset.routeId, node]));
    for (const route of routes) {
      const card = cardMap.get(String(route.routeId));
      if (!card) { render(); return; }
      const badge = card.querySelector('.dispatch-status-value');
      const progress = card.querySelector('.dispatch-progress');
      if (badge) badge.textContent = route.execution?.status || route.status || 'DISPATCHED';
      if (progress) progress.textContent = `Driver: ${route.driverName || '—'} · Progress: ${Number(route.execution?.completedStops || 0)} / ${Number(route.execution?.totalStops || 0)}`;
    }
  }

  async function refresh(forceDrivers = false) {
    counters.refreshCalls++;
    if (!state.options || document.hidden || !isViewActive()) return;
    const user = global.FirebaseApp?.auth?.getCurrentUser?.();
    if (state.refreshPromise && !forceDrivers && state.refreshKey === `${user?.uid || ''}:${currentContext()?.planId || ''}:${currentContext()?.planVersion || 0}:${currentContext()?.snapshotSchemaVersion || 0}:${(currentContext()?.routes || []).map(routeKey).join(',')}`) { counters.mergedRefreshes++; return state.refreshPromise; }
    if (!user) { state.context = null; state.drivers = []; state.dispatched = []; render(); return; }
    dispatchTiming('dispatchCacheRead');
    let context = currentContext();
    const generation = ++state.generation;
    if (!context?.planId) {
      dispatchTiming('dispatchLoadPlanStart');
      try {
        if (!state.planLoadPromise || state.planLoadUid !== user.uid) {
          state.planLoadUid = user.uid;
          state.planLoadPromise = global.RoutePlannerStorage?.loadLatestFinalizedPlan?.() || Promise.resolve({ success: false, error: 'Route storage unavailable.' });
        } else counters.mergedRefreshes++;
        const planPromise = state.planLoadPromise;
        const result = await planPromise;
        if (state.planLoadPromise === planPromise) state.planLoadPromise = null;
        if (generation !== state.generation) { counters.staleResponses++; return; }
        if (result?.success && result.plan) state.loadedPlan = result.plan;
        else if (result && !result.success) notice(result.error || 'Could not load saved route plan.', true);
      } catch (error) { if (generation === state.generation) notice(error.message, true); }
      dispatchTiming('dispatchLoadPlanEnd');
      context = currentContext();
    }
    if (generation !== state.generation) return;
    const key = `${user.uid}:${context?.planId || ''}:${context?.planVersion || 0}:${context?.snapshotSchemaVersion || 0}:${(context?.routes || []).map(routeKey).join(',')}`;
    state.refreshKey = key;
    state.context = context;
    render();
    if (!context?.planId || !context.routes?.length) return;
    dispatchTiming('dispatchRouteVisible');
    dispatchTiming('dispatchOpenStart');
    if (state.driverPrefetch && !forceDrivers) await state.driverPrefetch;
    if (generation !== state.generation) return;
    const cached = !forceDrivers && state.driverCache?.uid === user.uid && state.driverCache.expiresAt > Date.now();
    if (cached) { counters.cacheHits++; state.drivers = state.driverCache.drivers; state.driversLoaded = true; render(); if (state.drivers.length) dispatchTiming('dispatchDriversUsable'); } else counters.cacheMisses++;
    dispatchTiming('dispatchLoadDriversStart');
    const driversTask = cached ? Promise.resolve() : api('drivers').then(result => {
      if (generation !== state.generation) { counters.staleResponses++; return; }
      state.drivers = result.drivers || [];
      state.driversLoaded = true;
      dispatchTiming('dispatchLoadDriversEnd');
      if (state.drivers.length) dispatchTiming('dispatchDriversUsable');
      state.driverCache = { uid: user.uid, drivers: state.drivers, expiresAt: Date.now() + 30000 };
      render();
      notice(state.drivers.length ? '' : 'No active drivers. Manage Drivers in Settings to add one.');
    });
    dispatchTiming('dispatchLoadStatusStart');
    const statusTask = api('routes', null, { planId: context.planId, routeIds: statusRouteIds(context) }).then(result => {
      if (generation !== state.generation) { counters.staleResponses++; return; }
      patchStatus(result.routes || []);
      dispatchTiming('dispatchLoadStatusEnd');
      dispatchTiming('dispatchStatusReady');
    });
    const promise = Promise.allSettled([driversTask, statusTask]).then(results => {
      if (generation !== state.generation) { counters.staleResponses++; return; }
      const error = results.find(result => result.status === 'rejected');
      if (error) { notice(error.reason?.message || 'Dispatch refresh failed.', true); return; }
      dispatchTiming('dispatchPrimaryUsable');
      try { performance.measure('grx:dispatchControls', 'grx:dispatchOpenStart', 'grx:dispatchPrimaryUsable'); } catch {}
    }).finally(() => { if (state.refreshPromise === promise) state.refreshPromise = null; });
    state.refreshPromise = promise;
    return promise;
  }

  async function dispatchRoutes(routes) {
    const context = state.context;
    if (!context?.planId) return notice('Save this route plan before dispatching.', true);
    const assignments = [];
    for (const route of routes) {
      if (dispatchOf(context, route)) continue;
      const driverUid = selectedDriver(routeKey(route));
      if (!routeHasEta(route)) return notice(`Route ${routeKey(route)} is missing a finalized ETA. Replan before dispatching. No routes were changed.`, true);
      if (!driverUid) return notice(`Select a driver for Route ${routeKey(route)} before dispatching. No routes were changed.`, true);
      assignments.push({ routeId: routeKey(route), driverUid });
    }
    if (!assignments.length) return notice('All selected routes are already dispatched.', true);
    state.loading = true; render(); notice('Dispatching…');
    try {
      const planSnapshot = { date: context.date, planningDate: context.date, startTime: context.startTime, routeStartTime: context.startTime, originName: context.origin, endLocationLabel: context.end, plannedRoutes: context.routes.map(route => ({ id: route.id, customerStops: route.customerStops || [], originalWaypoints: route.originalWaypoints || [], optimizedStops: route.optimizedStops || [], detailedStopTimes: route.detailedStopTimes || [], routeStopConfigs: route.routeStopConfigs || [], endLocationId: route.endLocationId || null, estimatedDistanceMeters: (route.directionsResult?.routes?.[0]?.legs || []).reduce((sum, leg) => sum + Number(leg.distance?.value || 0), 0), estimatedDurationSeconds: (route.directionsResult?.routes?.[0]?.legs || []).reduce((sum, leg) => sum + Number(leg.duration?.value || 0), 0) })) };
      await api('dispatch', { planId: context.planId, assignments, planSnapshot });
      state.driverCache = null;
      await refresh(true);
      notice(`${assignments.length} route${assignments.length === 1 ? '' : 's'} dispatched.`);
    } catch (error) { notice(error.message, true); }
    finally { state.loading = false; render(); }
  }

  async function pollStatus() {
    if (document.hidden || !isViewActive() || !state.dispatched.length || state.refreshPromise || state.statusPollPromise) return;
    const uid = global.FirebaseApp?.auth?.getCurrentUser?.()?.uid;
    const context = state.context;
    if (!uid || !context?.planId) return;
    const generation = state.generation;
    const promise = api('routes', null, { planId: context.planId, routeIds: statusRouteIds(context) })
      .then(result => {
        if (generation !== state.generation || uid !== global.FirebaseApp?.auth?.getCurrentUser?.()?.uid || document.hidden || !isViewActive()) { counters.staleResponses++; return; }
        patchStatus(result.routes || []);
      })
      .catch(error => { if (generation === state.generation) notice(error.message, true); })
      .finally(() => { if (state.statusPollPromise === promise) state.statusPollPromise = null; });
    state.statusPollPromise = promise;
    return promise;
  }

  function reset() {
    state.generation++; state.context = null; state.loadedPlan = null; state.drivers = []; state.driversLoaded = false; state.dispatched = [];
    state.driverCache = null; state.driverPrefetch = null; state.refreshPromise = null; state.refreshKey = ''; state.activeRouteId = null;
    render();
  }

  // Started as soon as sign-in is known, in parallel with the account and plan reads, so the driver list is
  // usually ready when the board opens instead of being fetched after them.
  function prefetchDrivers() {
    const user = global.FirebaseApp?.auth?.getCurrentUser?.();
    if (!user || state.driverPrefetch || (state.driverCache?.uid === user.uid && state.driverCache.expiresAt > Date.now())) return;
    const prefetch = api('drivers').then(result => {
      if (state.driverPrefetch !== prefetch) return;
      state.driverCache = { uid: user.uid, drivers: result.drivers || [], expiresAt: Date.now() + 30000 };
    }).catch(() => { /* the board fetches again when it opens */ }).finally(() => { if (state.driverPrefetch === prefetch) state.driverPrefetch = null; });
    state.driverPrefetch = prefetch;
  }

  function suspend() {
    state.generation++; state.refreshPromise = null; state.refreshKey = '';
    if (state.refreshTimer) global.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    state.authUnsubscribe?.(); state.authUnsubscribe = null;
  }

  function init(options) {
    state.options = options;
    $('dispatchAllBtn')?.addEventListener('click', () => dispatchRoutes(state.context?.routes || []));
    $('dispatchPrintAllBtn')?.addEventListener('click', () => {
      const context = state.context;
      if (!context?.routes?.length) return;
      const firstRoute = routeKey(context.routes[0]);
      const dispatched = dispatchOf(context, context.routes[0]);
      const driverName = dispatched?.driverName || state.drivers.find(driver => driver.uid === selectedDriver(firstRoute))?.name || 'Unassigned';
      state.options.printPlan(scheduleList(context), driverName, context.date, context.vehicle);
    });
    $('dispatchRefreshBtn')?.addEventListener('click', () => refresh(true));
    state.authUid = global.FirebaseApp?.auth?.getCurrentUser?.()?.uid || null;
    state.authUnsubscribe = global.FirebaseApp?.auth?.onAuthStateChange?.(user => {
      const nextUid = user?.uid || null;
      if (nextUid === state.authUid) return;
      state.authUid = nextUid; state.loadedPlan = null; state.driverCache = null; state.generation++;
      if (isViewActive()) refresh();
    });
    global.addEventListener('goroutex:drivers-updated', () => { state.driverCache = null; if (isViewActive()) refresh(true); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && isViewActive()) refresh(); });
    render();
    state.refreshTimer = global.setInterval(() => {
      if (!document.hidden && isViewActive() && state.dispatched.length) pollStatus();
    }, 30000);
  }
  global.GoRouteXDispatch = { init, refresh, render, reset, suspend, selectRoute, contextFromPlan, routeStops, lookupTiming, prefetchDrivers, scheduleList };
})(window);
