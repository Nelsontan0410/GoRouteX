(function (global) {
  'use strict';

  const core = global.LorryRestrictions;
  const RULES_VERSION = 'route-corridor-v1';
  const VALID_FOR_MS = 30 * 60 * 1000;
  const DATA_VALID_FOR_MS = 14 * 24 * 60 * 60 * 1000;
  const checked = new WeakMap();
  const overlays = new Map();
  const mapBindings = new Map();
  const validationCache = new Map();
  const contexts = new Map();
  let dataPromise;
  let dataset;
  let index;
  let codeContainer;
  let codeFilter;
  let optionsSection;
  let optionsHost;
  let regionRun = 0;
  let optionRoutes = [];
  let optionContext = null;
  let optionsSummary;
  let optionsContent;
  let panelToggleButton;
  const PANEL_STATE_VERSION = 'v1';
  const panelStateMemory = new Map();

  function panelScope() {
    const uid = global.FirebaseApp?.auth?.getCurrentUser?.()?.uid;
    return uid ? `account-${String(uid)}` : 'anonymous';
  }

  function panelStorageKey(scope = panelScope()) {
    return `goroutex.lorry.panel.${PANEL_STATE_VERSION}.${scope}`;
  }

  function readPanelCollapsed() {
    const scope = panelScope();
    if (panelStateMemory.has(scope)) return panelStateMemory.get(scope);
    let collapsed = false;
    try { collapsed = sessionStorage.getItem(panelStorageKey(scope)) === 'collapsed'; } catch { /* in-memory fallback */ }
    panelStateMemory.set(scope, collapsed);
    return collapsed;
  }

  function writePanelCollapsed(collapsed) {
    const scope = panelScope();
    panelStateMemory.set(scope, !!collapsed);
    try { sessionStorage.setItem(panelStorageKey(scope), collapsed ? 'collapsed' : 'expanded'); } catch { /* in-memory fallback */ }
  }

  function panelSummaryText() {
    const config = settings();
    if (!config.selectedCodes.length) return 'Singapore restrictions · Select restriction codes';
    return `Singapore restrictions · ${config.selectedCodes.length} code${config.selectedCodes.length === 1 ? '' : 's'} selected`;
  }

  function renderPanelPresentation({ focus = '' } = {}) {
    if (!optionsSection || !optionsSummary || !optionsContent || !panelToggleButton) return;
    const collapsed = readPanelCollapsed();
    optionsSection.classList?.toggle('is-collapsed', collapsed);
    optionsSummary.hidden = false;
    optionsContent.hidden = collapsed;
    optionsSummary.querySelector('[data-lorry-summary-text]').textContent = panelSummaryText();
    const buttonHost = optionsSummary;
    if (panelToggleButton.parentElement !== buttonHost) buttonHost.append(panelToggleButton);
    panelToggleButton.textContent = collapsed ? 'Edit' : 'Done';
    panelToggleButton.setAttribute('aria-expanded', String(!collapsed));
    if (focus === 'edit' && collapsed) panelToggleButton.focus();
    if (focus === 'first-control' && !collapsed) optionsContent.querySelector('[data-lorry-code]')?.focus();
  }

  function collapseOptions() {
    writePanelCollapsed(true);
    renderPanelPresentation({ focus: 'edit' });
  }

  function expandOptions() {
    writePanelCollapsed(false);
    renderPanelPresentation({ focus: 'first-control' });
  }

  function placeOptions(pageId) {
    if (pageId === 'page-manual-assign') optionContext = 'manual';
    else if (pageId === 'page-optimized-routes' || pageId === 'page-maps-preview') optionContext = 'final';
    const hosts = { 'page-manual-assign': '#manualLtaOptions', 'page-optimized-routes': '#finalLtaOptions', 'page-maps-preview': '#previewLtaOptions' };
    const host = hosts[pageId] ? document.querySelector(hosts[pageId]) : optionsHost;
    if (host && optionsSection) host.append(optionsSection);
    if (pageId === 'page-manual-assign') updateRegionOptions(contextState('manual').routes);
    else if (pageId === 'page-optimized-routes' || pageId === 'page-maps-preview') updateRegionOptions(global.AppState?.plannedRoutes || []);
  }

  async function updateRegionOptions(routes) {
    optionRoutes = Array.isArray(routes) ? routes : [];
    const run = ++regionRun;
    if (optionsSection) optionsSection.hidden = true;
    if (!optionsSection || !global.RouteRegion) return;
    try {
      const available = await global.RouteRegion.hasSingaporeRoute(optionRoutes);
      if (run !== regionRun) return;
      optionsSection.hidden = !available;
      renderPanelPresentation();
      if (available) {
        loadData().then(() => { if (run === regionRun) renderCodes(); }).catch(() => {
          if (run === regionRun) statusMessage('Singapore restriction data is unavailable.');
        });
      }
    } catch {
      // Unknown country coverage must not expose Singapore-only options.
      if (run === regionRun) optionsSection.hidden = true;
    }
  }

  const presetCodes = [
    ['4002', 'Exceeding 2500kg In Unladen Weight'],
    ['1011', 'Restriction on Lorry'],
    ['1012', 'Restriction Of Movement Of Vehicles With 3 Or More Axles'],
    ['1005', 'Width Limit'],
    ['1006', 'Weight Limit'],
    ['1007', 'Height Limit - 4.5m']
  ];
  const owner = () => global.FirebaseApp?.auth?.getCurrentUser?.()?.uid || 'device';
  const key = (kind) => `goroutex.lorry.${kind}.${owner()}`;
  const defaults = () => ({ enabled: true, selectedCodes: ['4002'] });

  function settings() {
    try {
      const saved = JSON.parse(localStorage.getItem(key('settings')));
      const selectedCodes = Array.isArray(saved?.selectedCodes)
          ? [...new Set(saved.selectedCodes.map(String))].filter((code) => /^\d{4}$/.test(code)).sort()
          : defaults().selectedCodes;
      return { enabled: selectedCodes.length > 0, selectedCodes };
    } catch { return defaults(); }
  }

  function contextState(name = 'final') {
    if (!contexts.has(name)) contexts.set(name, { name, run: 0, routes: [], inputKey: '', promise: null });
    return contexts.get(name);
  }

  function audit(event) {
    try {
      const events = JSON.parse(localStorage.getItem(key('audit')) || '[]');
      events.push({ date: new Date().toISOString(), rulesVersion: RULES_VERSION, ...event });
      localStorage.setItem(key('audit'), JSON.stringify(events.slice(-100)));
    } catch { statusMessage('Trial log could not be saved on this device.'); }
  }

  function resolvedStops(route) {
    return (route?.optimizedStops || []).map((stop) => ({
      address: typeof global.getAddressForMapsUrl === 'function' ? global.getAddressForMapsUrl(stop) : stop,
      location: typeof global.getDynamicRouteStopInput === 'function'
        ? global.getDynamicRouteStopInput(stop)
        : (typeof global.getLocationInput === 'function' ? global.getLocationInput(stop) : stop)
    }));
  }

  function signature(route) {
    return JSON.stringify({
      geometry: core.extractGeometry(route?.directionsResult),
      safetyWaypoints: route?.safetyWaypoints || [],
      manualWaypoints: route?.manualWaypoints || [],
      stops: route?.optimizedStops || [],
      resolvedStops: resolvedStops(route),
      settings: settings(),
      rulesVersion: RULES_VERSION
    });
  }

  function inputKey(routes) {
    return JSON.stringify({
      routes: (Array.isArray(routes) ? routes : []).map(signature),
      settings: settings(),
      rulesVersion: RULES_VERSION
    });
  }

  async function loadData(forceRefresh = false) {
    if (forceRefresh) dataPromise = null;
    if (!dataPromise) {
      dataPromise = (async () => {
        const response = await fetch('data/lta-restrictions.json', { cache: 'no-cache', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('LTA restriction data is unavailable.');
        const value = await response.json();
        if (value.schemaVersion !== 1 || !Array.isArray(value.signs) || !value.signs.length) throw new Error('Invalid LTA restriction dataset.');
        dataset = value;
        index = core.buildIndex(value.signs);
        return value;
      })().catch((error) => { dataPromise = null; throw error; });
    }
    return dataPromise;
  }

  function cacheCurrent(route, { allowStaleDataset = false } = {}) {
    if (!route || !dataset) return false;
    const cached = checked.get(route);
    try {
      return !!cached
        && cached.signature === signature(route)
        && cached.dataset === dataset.sourceSha256
        && cached.rulesVersion === RULES_VERSION
        && Date.now() - cached.at < VALID_FOR_MS
        && (allowStaleDataset || Date.now() - Date.parse(dataset.generatedAt) < DATA_VALID_FOR_MS);
    } catch { return false; }
  }

  function permitted(route) {
    // Restriction data guides dispatchers to pins. A route remains shareable and
    // navigable whenever Google has produced a usable route.
    return !!route?.directionsResult?.routes?.length;
  }

  function gate(route) {
    if (!permitted(route)) return false;
    const conflicts = route?.lorryValidation?.conflicts || [];
    if (settings().enabled && conflicts.length) {
      const hasManualDetour = (route.manualWaypoints || []).length > 0;
      global.dispatchEvent?.(new CustomEvent('restriction-navigation-reminder', {
        detail: { routeId: route.id, conflicts: conflicts.length, hasManualDetour }
      }));
    }
    return true;
  }

  function statusMessage(message) {
    document.querySelectorAll('[data-lorry-status]').forEach((node) => { node.textContent = message; });
  }

  function getBoundRoutes(binding) {
    return Array.isArray(binding?.routes) ? binding.routes : (global.AppState?.plannedRoutes || []);
  }

  function refreshMaps(contextName) {
    for (const map of overlays.keys()) {
      const binding = mapBindings.get(map);
      if (!contextName || (binding?.context || 'final') === contextName) paintMap(map);
    }
  }

  function bindRoutes(contextName, routes) {
    const context = contextState(contextName);
    context.routes = Array.isArray(routes) ? routes : [];
    if (!optionContext || optionContext === contextName) {
      optionContext = contextName; updateRegionOptions(context.routes);
    }
    refreshMaps(contextName);
    return context;
  }

  function invalidate(contextName = 'final', routes) {
    if (!optionContext || optionContext === contextName) updateRegionOptions([]);
    const context = contextState(contextName);
    context.run += 1;
    context.inputKey = '';
    context.promise = null;
    const affected = new Set([...(context.routes || []), ...(Array.isArray(routes) ? routes : [])]);
    for (const route of affected) {
      checked.delete(route);
      if (route) route.lorryValidation = { status: 'NOT_CHECKED', safe: false, conflicts: [], issues: [] };
    }
    if (Array.isArray(routes)) context.routes = routes;
    refreshMaps(contextName);
  }

  function invalidateAll() {
    for (const name of contexts.keys()) invalidate(name);
    refreshMaps();
  }

  function cloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function validationCacheKey(route) { return `${dataset?.sourceSha256 || ''}|${signature(route)}`; }

  function applyCachedValidation(route) {
    const cached = validationCache.get(validationCacheKey(route));
    if (!cached || Date.now() - cached.at >= VALID_FOR_MS) return false;
    route.lorryValidation = cloneValue(cached.validation);
    checked.set(route, { signature: signature(route), dataset: dataset.sourceSha256, rulesVersion: RULES_VERSION, at: cached.at });
    return true;
  }

  function rememberValidation(route) {
    validationCache.set(validationCacheKey(route), { at: Date.now(), validation: cloneValue(route.lorryValidation) });
  }

  function validateRoutes(routes = global.AppState?.plannedRoutes || [], options = {}) {
    const contextName = options.context || 'final';
    const context = bindRoutes(contextName, routes);
    const safeRoutes = context.routes;
    const requestedKey = inputKey(safeRoutes);
    if (context.promise && context.inputKey === requestedKey) return context.promise;

    const run = ++context.run;
    context.inputKey = requestedKey;
    const config = settings();
    let wrapped;
    const work = (async () => {
      if (!config.enabled) {
        for (const route of safeRoutes) {
          checked.delete(route);
          route.lorryValidation = { status: 'NOT_CHECKED', safe: false, conflicts: [], issues: [] };
          audit({ event: 'planned-without-validation', context: contextName, routeId: route.id, driver: route.driverId || '', selectedCodes: config.selectedCodes,
            originalRoute: { stops: route.optimizedStops || [] }, restrictionsDetected: null, reroutes: 0, finalStatus: 'NOT_CHECKED', manualOverride: false });
        }
        if (contextName === 'final') render(); else refreshMaps(contextName);
        return safeRoutes;
      }

      if (contextName === 'final') statusMessage('Checking selected LTA restriction codes…');
      for (const route of safeRoutes) {
        checked.delete(route);
        route.lorryValidation = { status: 'LOADING', safe: false, conflicts: [], issues: [] };
      }
      refreshMaps(contextName);

      try {
        await loadData(options.forceRefresh !== false);
        if (run !== context.run) return safeRoutes;
        renderCodes();
        let changed = false;
        for (const route of safeRoutes) {
          if (run !== context.run) return safeRoutes;
          if (options.reuse === true && applyCachedValidation(route)) continue;

          const baseline = signature(route);
          const isCurrent = () => run === context.run
            && JSON.stringify(config) === JSON.stringify(settings())
            && signature(route) === baseline;
          const validate = (result) => core.validateRouteAgainstLorryRestrictions(core.extractGeometry(result), config.selectedCodes, dataset, index);
          const initial = validate(route.directionsResult);
          // Restrictions now inform manual dispatcher choices. Do not let an
          // automatic request replace the route selected by the dispatcher.
          const outcome = {
            directionsResult: route.directionsResult,
            safetyWaypoints: [],
            validation: initial,
            reroutes: 0,
            changed: false,
            reason: null
          };
          if (!isCurrent()) {
            if (run !== context.run) return safeRoutes;
            route.lorryValidation = { status: 'WARNING', safe: false, conflicts: [], issues: ['Route or restriction selection changed during checking. Check again.'] };
            continue;
          }

          const originalStops = [...(route.optimizedStops || [])];
          // Older saved routes can contain automatic bypass points. They are no
          // longer part of route construction or navigation handoff.
          route.safetyWaypoints = [];
          if (outcome.changed) {
            route.directionsResult = outcome.directionsResult;
            route.safetyWaypoints = outcome.safetyWaypoints;
            route.detailedStopTimes = [];
            route.scheduleHtml = '';
            route.finalEtaAtLastStop = null;
            route.finalEtaAtHq = null;
            changed = true;
          }
          const result = outcome.validation;
          route.lorryValidation = {
            ...result,
            checkedAt: new Date().toISOString(), datasetVersion: dataset.sourceSha256, dataGeneratedAt: dataset.generatedAt,
            rulesVersion: RULES_VERSION, selectedCodes: config.selectedCodes, safetyWaypoints: route.safetyWaypoints || [], manualWaypoints: route.manualWaypoints || [],
            reroutes: outcome.reroutes, initialConflicts: initial.conflicts.length,
            avoidedConflicts: Math.max(0, initial.conflicts.length - result.conflicts.length), rerouteReason: outcome.reason || null
          };
          checked.set(route, { signature: signature(route), dataset: dataset.sourceSha256, rulesVersion: RULES_VERSION, at: Date.now() });
          rememberValidation(route);
          audit({
            event: 'validation', context: contextName, routeId: route.id, driver: route.driverId || route.vehicleDriver || '', selectedCodes: config.selectedCodes,
            originalRoute: { stops: originalStops }, conflictIds: initial.conflicts.map((item) => item.restrictionId), restrictionsDetected: initial.conflicts.length,
            remainingConflictIds: result.conflicts.map((item) => item.restrictionId), remainingConflicts: result.conflicts.length,
            extraRequests: outcome.reroutes, reroutes: outcome.reroutes, rerouteFailureReason: outcome.reason || null,
            finalStatus: result.status, safetyWaypoints: route.safetyWaypoints || [], manualWaypoints: route.manualWaypoints || [], manualOverride: false, datasetVersion: dataset.sourceSha256
          });
        }
        if (changed && typeof global.dispatchEvent === 'function') {
          global.dispatchEvent(new CustomEvent('restriction-route-updated', { detail: { context: contextName } }));
        }
      } catch (error) {
        if (run !== context.run) return safeRoutes;
        for (const route of safeRoutes) {
          checked.delete(route);
          route.lorryValidation = { status: 'WARNING', safe: false, conflicts: [], issues: [error.message] };
          audit({ event: 'validation-error', context: contextName, routeId: route.id, finalStatus: 'WARNING', reason: error.message, datasetVersion: dataset?.sourceSha256 || null });
        }
      }
      if (contextName === 'final') render(); else refreshMaps(contextName);
      return safeRoutes;
    })();
    wrapped = work.finally(() => { if (context.promise === wrapped) context.promise = null; });
    context.promise = wrapped;
    return wrapped;
  }

  function summary(routes = []) {
    const config = settings();
    const safeRoutes = Array.isArray(routes) ? routes : [];
    const conflicts = new Map();
    const issues = [];
    for (const route of safeRoutes) {
      for (const conflict of route?.lorryValidation?.conflicts || []) conflicts.set(conflict.restrictionId, conflict);
      issues.push(...(route?.lorryValidation?.issues || []));
      if (route?.lorryValidation?.rerouteReason) issues.push(route.lorryValidation.rerouteReason);
    }
    let state = 'PENDING';
    if (!config.enabled) state = 'OFF';
    else if (!safeRoutes.length) state = 'NO_ROUTE';
    else if (safeRoutes.some((route) => route?.lorryValidation?.status === 'LOADING')) state = 'CHECKING';
    else if (conflicts.size || issues.length || safeRoutes.some((route) => ['WARNING', 'BLOCKED'].includes(route?.lorryValidation?.status))) state = 'PENDING';
    // A usable Google route permits navigation, but it is not evidence that the
    // selected restriction data was checked. Only an explicit current SAFE
    // validation may use the Safe label.
    else if (safeRoutes.every((route) => route?.lorryValidation?.status === 'SAFE')) state = 'SAFE';
    return { state, config, routes: safeRoutes, conflicts: [...conflicts.values()], issues: [...new Set(issues.filter(Boolean))], dataset };
  }

  function render() {
    const routes = global.AppState?.plannedRoutes || [];
    const result = summary(routes);
    if (result.state === 'OFF') statusMessage('Restriction avoidance is off.');
    else if (!result.config.selectedCodes.length) statusMessage('Select at least one restriction code to avoid.');
    else if (result.state === 'NO_ROUTE') statusMessage('Plan a route to show selected restriction codes within 20 m of the route.');
    else if (result.state === 'CHECKING') statusMessage('Checking selected LTA restriction codes…');
    else if (result.state === 'SAFE' || result.state === 'REROUTED') statusMessage('✓ Route checked against selected codes. Google Maps may recalculate; follow road signs.');
    else statusMessage('⚠ Restriction reminder: inspect the pins and add a manual navigation point if needed.');

    if (typeof global.updateRouteSharePreview === 'function') global.updateRouteSharePreview();
    refreshMaps('final');
  }

  function paintMap(map) {
    for (const marker of overlays.get(map) || []) marker.setMap(null);
    const markers = [];
    overlays.set(map, markers);
    const config = settings();
    if (!global.google?.maps) return;
    const selected = new Set(config.selectedCodes);
    const conflicts = new Map();
    const binding = mapBindings.get(map) || { context: 'final', routes: null };
    for (const route of getBoundRoutes(binding)) {
      if (!route || route.lorryValidation?.status === 'LOADING' || !cacheCurrent(route, { allowStaleDataset: true })) continue;
      for (const conflict of route.lorryValidation?.nearbyRestrictions || []) {
        if (!Number.isFinite(conflict.distanceToRoute) || conflict.distanceToRoute > 20) continue;
        if (selected.has(conflict.signCode)) conflicts.set(conflict.restrictionId, { ...conflict, routeId: route.id, routeLabel: route.label || `Route ${route.id}` });
      }
    }
    const visible = config.enabled && dataset ? dataset.signs.filter((sign) => selected.has(sign.signCode) && conflicts.has(sign.id)) : [];
    for (const sign of visible) {
      const conflict = conflicts.get(sign.id);
      const marker = new google.maps.Marker({
        map, position: { lat: sign.latitude, lng: sign.longitude }, title: `${sign.signCode}: ${sign.signName}`,
        label: { text: sign.signCode, color: '#fff', fontSize: '10px' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 16, fillColor: '#b64520', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }, zIndex: 2000
      });
      marker.addListener('click', () => {
        const content = document.createElement('div');
        const location = `${Number(sign.latitude).toFixed(6)}, ${Number(sign.longitude).toFixed(6)}`;
        for (const text of [`${sign.signCode} · ${sign.signName}`, `Limit: ${sign.threshold ?? 'Not specified'} ${sign.unit || ''}`,
          `Location: ${location}`, conflict.reason, `LTA Sign ID: ${sign.id}`]) {
          const p = document.createElement('p'); p.textContent = text; content.append(p);
        }
        if ((binding.context || 'final') === 'manual' && Number.isInteger(conflict.legIndex)) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = 'Add manual detour';
          button.addEventListener('click', () => {
            global.dispatchEvent?.(new CustomEvent('restriction-manual-via-request', { detail: { conflict, routeId: conflict.routeId } }));
          });
          content.append(button);
        }
        new google.maps.InfoWindow({ content }).open({ map, anchor: marker });
      });
      markers.push(marker);
    }
    const manualIds = new Set();
    const showManualPointMarkers = (binding.context || 'final') !== 'manual';
    for (const route of showManualPointMarkers ? getBoundRoutes(binding) : []) for (const point of route?.manualWaypoints || []) {
      if (!core.point(point) || !Number.isInteger(point.legIndex)) continue;
      const key = point.id || `${route.id}|${point.legIndex}|${point.lat}|${point.lng}`;
      if (manualIds.has(key)) continue;
      manualIds.add(key);
      const marker = new google.maps.Marker({
        map, position: { lat: Number(point.lat), lng: Number(point.lng) }, title: `Manual detour · ${route.label || `Route ${route.id}`}`,
        label: { text: '↪', color: '#fff', fontSize: '13px' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#2458a6', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }, zIndex: 1900
      });
      marker.addListener('click', () => {
        const content = document.createElement('div');
        const p = document.createElement('p');
        p.textContent = `Manual detour point · ${route.label || `Route ${route.id}`} · leg ${point.legIndex + 1}`;
        content.append(p);
        new google.maps.InfoWindow({ content }).open({ map, anchor: marker });
      });
      markers.push(marker);
    }
  }

  function registerMap(map) {
    if (!map || overlays.has(map)) return;
    overlays.set(map, []);
    mapBindings.set(map, { context: 'final', routes: null });
    map.addListener?.('idle', () => paintMap(map));
    if (settings().enabled) loadData().then(() => paintMap(map)).catch((error) => statusMessage(error.message));
  }

  function showConflicts(map, routes, options = {}) {
    if (!map) return;
    registerMap(map);
    const contextName = options.context || 'final';
    mapBindings.set(map, {
      context: contextName,
      // Final-page maps follow AppState replacements. Manual preview maps own an
      // explicit route collection that is independent from AppState.
      routes: contextName === 'final' ? null : (Array.isArray(routes) ? routes : [])
    });
    paintMap(map);
  }

  function renderCodes() {
    if (!codeContainer) return;
    const config = settings();
    const selected = new Set(config.selectedCodes);
    const byCode = new Map(presetCodes.map(([code, name]) => [code, { name, count: 0 }]));
    for (const sign of dataset?.signs || []) {
      const entry = byCode.get(sign.signCode) || { name: sign.signName, count: 0 };
      entry.count += 1; byCode.set(sign.signCode, entry);
    }
    for (const code of selected) if (!byCode.has(code)) byCode.set(code, { name: 'Not present in this dataset — review required', count: 0 });
    codeContainer.replaceChildren();
    const query = codeFilter?.value.trim().toLowerCase() || '';
    const priority = new Map(presetCodes.map(([code], itemIndex) => [code, itemIndex]));
    const codes = [...byCode.keys()].sort((a, b) => (priority.get(a) ?? 99) - (priority.get(b) ?? 99) || a.localeCompare(b));
    for (const code of codes) {
      const entry = byCode.get(code);
      if (query && !`${code} ${entry.name}`.toLowerCase().includes(query)) continue;
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = code; input.checked = selected.has(code); input.dataset.lorryCode = code;
      label.className = 'lorry-code-option';
      const text = document.createElement('span'); text.textContent = `${code} · ${entry.name}`;
      label.append(input, text);
      input.addEventListener('change', () => {
        const config = settings(); const next = new Set(config.selectedCodes);
        input.checked ? next.add(code) : next.delete(code);
        config.selectedCodes = [...next].sort(); config.enabled = config.selectedCodes.length > 0; saveSelection(config);
      });
      codeContainer.append(label);
    }
  }

  function saveSelection(config) {
    const displayedRoutes = optionRoutes;
    config.selectedCodes = Array.isArray(config.selectedCodes) ? [...new Set(config.selectedCodes.map(String))].filter((code) => /^\d{4}$/.test(code)).sort() : [];
    config.enabled = config.selectedCodes.length > 0;
    try { localStorage.setItem(key('settings'), JSON.stringify(config)); }
    catch { statusMessage('Unable to save restriction selection on this device.'); return; }
    audit({ event: 'selection', selectedCodes: config.selectedCodes, enabled: config.enabled, manualOverride: !config.enabled });
    invalidateAll(); renderCodes(); render(); renderPanelPresentation();
    updateRegionOptions(displayedRoutes);
    if (typeof global.dispatchEvent === 'function') global.dispatchEvent(new CustomEvent('restriction-settings-changed', { detail: { settings: config } }));
    const finalRoutes = global.AppState?.plannedRoutes || [];
    if (config.enabled && finalRoutes.length) validateRoutes(finalRoutes, { context: 'final' });
  }

  function navigationText(route) {
    if (!permitted(route)) return null;
    const links = global.RestrictionRouting.navigationLinks(route);
    return links.map((link, itemIndex) => `${links.length > 1 ? `Part ${itemIndex + 1}/${links.length}: ` : ''}${link.url}`).join('\n');
  }

  function openNavigation(route) {
    if (!gate(route)) return;
    const links = global.RestrictionRouting.navigationLinks(route);
    if (links.length === 1) { global.open(links[0].url, '_blank', 'noopener'); return; }
    const dialog = document.createElement('dialog'); dialog.className = 'lorry-navigation-dialog';
    const heading = document.createElement('h2'); heading.textContent = 'Google Maps navigation'; dialog.append(heading);
    const note = document.createElement('p');
    note.textContent = 'Open these parts in order. Delivery stops and your manual navigation points are preserved. Google Maps can recalculate between those points.';
    dialog.append(note);
    for (const [itemIndex, link] of links.entries()) {
      const anchor = document.createElement('a'); anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener';
      anchor.textContent = `Open part ${itemIndex + 1} of ${links.length}`;
      anchor.addEventListener('click', (event) => { if (!gate(route)) { event.preventDefault(); dialog.close(); } });
      dialog.append(anchor);
    }
    const close = document.createElement('button'); close.textContent = 'Close'; close.addEventListener('click', () => dialog.close()); dialog.append(close);
    dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  }

  function mount() {
    const host = document.querySelector('.select-page-route-settings .route-settings-body') || document.querySelector('.select-page-route-settings');
    if (!host) return;
    const section = document.createElement('section'); section.className = 'lorry-safety-panel';
    section.hidden = true;
    optionsSection = section; optionsHost = host;
    const contentId = 'lorry-restriction-options-content';
    section.innerHTML = `<div class="lorry-options-summary" data-lorry-options-summary hidden><span data-lorry-summary-text></span></div><div id="${contentId}" data-lorry-options-content><p data-lorry-status role="status"></p><details open><summary>Restriction codes to avoid</summary><label class="lorry-search-label">Find code or description<input type="search" data-lorry-search placeholder="Search codes or descriptions"></label><div data-lorry-codes></div></details></div>`;
    host.append(section);
    optionsSummary = section.querySelector('[data-lorry-options-summary]');
    optionsContent = section.querySelector('[data-lorry-options-content]');
    panelToggleButton = document.createElement('button');
    panelToggleButton.type = 'button'; panelToggleButton.dataset.lorryOptionsToggle = 'true';
    panelToggleButton.setAttribute('aria-controls', contentId);
    codeContainer = section.querySelector('[data-lorry-codes]'); codeFilter = section.querySelector('[data-lorry-search]');
    codeFilter.addEventListener('input', renderCodes);
    const hydrate = () => {
      const config = settings();
      renderCodes(); render(); refreshMaps(); renderPanelPresentation();
      updateRegionOptions(optionRoutes);
    };
    panelToggleButton.addEventListener('click', () => readPanelCollapsed() ? expandOptions() : collapseOptions());
    hydrate();
    global.FirebaseApp?.auth?.onAuthStateChange?.(hydrate);
  }

  global.RouteSafety = {
    validateRoutes, invalidate, bindRoutes, summary, permitted, gate, render, showConflicts, registerMap, placeOptions,
    navigationText, openNavigation, enabled: () => settings().enabled, settings, isCurrent: cacheCurrent, rulesVersion: RULES_VERSION
  };
  global.addEventListener?.('planned-routes-changed', () => {
    refreshMaps('final');
    if (optionContext !== 'manual') updateRegionOptions(global.AppState?.plannedRoutes || []);
  });
  document.addEventListener?.('input', () => refreshMaps());
  document.addEventListener?.('change', () => refreshMaps());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(window);
