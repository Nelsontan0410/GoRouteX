(function (global) {
  const auth = global.FirebaseApp?.auth;
  const stateNode = document.getElementById('dispatchPageState');
  const boardNode = document.getElementById('dispatchBoard');
  const validPlanId = /^[A-Za-z0-9_-]{1,128}$/;
  let generation = 0;
  let loadedPlan = null;
  let boardStarted = false;
  async function withDeadline(promise, milliseconds = 20000) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = global.setTimeout(() => { const error = Error('The request timed out. Please retry.'); error.code = 'timeout'; reject(error); }, milliseconds); })]).finally(() => global.clearTimeout(timer));
  }
  const mark = name => { try { performance.mark(`grx:${name}`); } catch {} };

  function showState(message, error = false, offerPlan = false, offerRetry = false) {
    stateNode.textContent = message;
    stateNode.classList.toggle('is-error', error);
    if (offerRetry) {
      stateNode.append(' ');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'action-button-secondary';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => { const user = auth?.getCurrentUser?.(); if (user) restorePlan(user); });
      stateNode.append(retry);
    }
    if (offerPlan) {
      stateNode.append(' ');
      const link = document.createElement('a');
      link.href = 'app.html#page-select-stops';
      link.textContent = 'Plan a route';
      stateNode.append(link);
    }
    stateNode.hidden = false;
    boardNode.hidden = true;
  }

  function openBoard() {
    stateNode.hidden = true;
    boardNode.hidden = false;
    if (!boardStarted) {
      boardStarted = true;
      global.GoRouteXDispatch.init({
        rootElement: boardNode,
        isActive: () => !document.hidden && !boardNode.hidden,
        getContext: () => global.GoRouteXDispatch.contextFromPlan(loadedPlan),
        canPrintRoute: () => global.RoutePlannerProduct?.canUseFeature?.('kpiPrintSummary', global.RoutePlannerProduct.getCurrentPlan(global.currentUserProfile || {})) !== false,
        printPlan
      });
    }
    global.GoRouteXDispatch.refresh();
  }

  // The plan just confirmed in Route Planning is handed over in this tab (planning-persistence.js), so
  // Dispatch does not read it back from the cloud first.
  function handedOverPlan(planId) {
    try {
      const uid = auth?.getCurrentUser?.()?.uid;
      const raw = uid && global.sessionStorage.getItem(`grxDispatchHandoff:${uid}`);
      const handoff = raw ? JSON.parse(raw) : null;
      return handoff && String(handoff.id) === String(planId) && Array.isArray(handoff.plan?.plannedRoutes) ? handoff.plan : null;
    } catch { return null; }
  }

  async function readPlan(planId) {
    const handed = handedOverPlan(planId);
    if (handed) { mark('dispatchPlanHandoff'); return { success: true, plan: handed, source: 'handoff' }; }
    const result = await global.RoutePlannerStorage.loadPlan(planId, { allowMigration: false });
    if (!result.success || result.plan || result.storageMode !== 'indexeddb') return result;
    // Some older Basic plans were saved to cloud before device-only storage.
    return global.FirebaseApp.data.loadPlan(planId);
  }

  async function readLatestPlan() {
    const result = await global.RoutePlannerStorage.loadLatestFinalizedPlan({ allowMigration: false });
    if (!result.success || result.plan || result.storageMode !== 'indexeddb') return result;
    return global.FirebaseApp.data.loadLatestFinalizedPlan();
  }

  async function restorePlan(user) {
    const request = ++generation;
    const params = new URLSearchParams(global.location.search);
    const explicit = params.get('planId');
    if (explicit !== null && !validPlanId.test(explicit)) {
      showState('Plan no longer available.', true, true);
      return;
    }
    mark('dispatchPlanLoadStart');
    showState('Loading finalized plan...');
    try {
      let result;
      if (explicit) {
        // One automatic retry: the first read on a fresh page can stall while the connection is set up.
        result = await withDeadline(readPlan(explicit)).catch((error) => {
          if (error?.code !== 'timeout' || request !== generation) throw error;
          showState('Still loading the plan, retrying…');
          return withDeadline(readPlan(explicit));
        });
        if (request !== generation) return;
        if (!result.success) throw Error(result.error || 'Unable to load Dispatch.');
        if (!result.plan) { showState('Plan no longer available.', true, true); return; }
      } else {
        let known = null;
        try { known = sessionStorage.getItem(`grxLastFinalizedPlan:${user.uid}`); } catch {}
        if (known && validPlanId.test(known)) {
          result = await withDeadline(readPlan(known));
          if (request !== generation) return;
          if (!result.success) throw Error(result.error || 'Unable to load Dispatch.');
        }
        if (!result?.plan) result = await withDeadline(readLatestPlan());
      }
      if (request !== generation) return;
      if (!result.success) throw Error(result.error || 'Unable to load Dispatch.');
      if (!result.plan || !(result.plan.plannedRoutes || []).some(route => Array.isArray(route?.customerStops) && route.customerStops.length)) {
        showState('No finalized route plan available.', false, true);
        return;
      }
      loadedPlan = result.plan;
      try { sessionStorage.setItem(`grxLastFinalizedPlan:${user.uid}`, String(loadedPlan.id)); } catch {}
      mark('dispatchPlanLoaded');
      openBoard();
    } catch (error) {
      if (request === generation) showState(`Unable to load Dispatch. ${error.message || ''}`, true, true, true);
    }
  }

  // A4 schedule list for the whole day: start, every stop in driving order with its ETA, end.
  function printPlan(list, driverName, planDate) {
    if (global.RoutePlannerProduct?.canUseFeature?.('kpiPrintSummary', global.RoutePlannerProduct.getCurrentPlan(global.currentUserProfile || {})) === false) return;
    const popup = global.open('', '_blank', 'width=900,height=760');
    if (!popup) { global.alert('Allow pop-ups to print the schedule list.'); return; }
    popup.document.open();
    popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>GoRouteX Schedule List</title><style>'
      + '@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font:11px/1.35 Arial,sans-serif;color:#183047;margin:0}'
      + 'h1{font-size:18px;margin:0 0 4px}.meta{color:#536479;margin:0 0 4px}.total{font-size:14px;font-weight:700;margin:6px 0 10px}'
      + 'table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:5px 6px;border-bottom:1px solid #dce5eb;overflow-wrap:anywhere}'
      + 'th{background:#f3f8fa}thead{display:table-header-group}tr{break-inside:avoid}tr.endpoint td{background:#f8fafc;font-weight:700}'
      + 'col.n{width:6%}col.r{width:10%}col.c{width:24%}col.a{width:34%}col.e{width:10%}col.s{width:16%}'
      + '.actions{margin-top:12px}button{padding:8px 16px}@media screen{body{margin:20px}}@media print{.actions{display:none}}'
      + '</style></head><body><h1>GoRouteX Schedule List</h1><p class="meta" id="meta"></p><p class="total" id="total"></p>'
      + '<table><colgroup><col class="n"><col class="r"><col class="c"><col class="a"><col class="e"><col class="s"></colgroup>'
      + '<thead><tr><th>#</th><th>Route</th><th>Customer / Orders</th><th>Address / Contact</th><th>ETA</th><th>Completed / Sign</th></tr></thead>'
      + '<tbody id="rows"></tbody></table><p class="actions"><button onclick="window.print()">Print</button></p></body></html>');
    popup.document.close();
    const doc = popup.document;
    doc.getElementById('meta').textContent = `${planDate || 'Date unavailable'} · Driver ${driverName || 'Unassigned'} · ${new Set(list.rows.map(row => row.route)).size} route(s)`;
    doc.getElementById('total').textContent = `Total stops: ${list.totalStops} (start and end not counted)`;
    const rows = doc.getElementById('rows');
    const addRow = (values, className = '') => {
      const row = doc.createElement('tr');
      if (className) row.className = className;
      values.forEach(value => { const cell = doc.createElement('td'); cell.textContent = value; cell.style.whiteSpace = 'pre-line'; row.append(cell); });
      rows.append(row);
    };
    addRow(['Start', '', list.start.name, '', `Departs ${list.start.time}`, ''], 'endpoint');
    for (const stop of list.rows) {
      addRow([String(stop.number), stop.route, stop.orders ? `${stop.name}\nOrders: ${stop.orders}` : stop.name, stop.contact ? `${stop.address}\n${stop.contact}` : stop.address, stop.eta, '']);
    }
    if (list.end) addRow(['End', '', list.end.name, '', `Arrives ${list.end.time}`, ''], 'endpoint');
    popup.focus();
  }

  global.GoRouteXSidebar?.setLogoutHandler(async () => {
    await auth?.signOut?.();
    global.location.assign('login.html');
  });

  if (!auth || !global.RoutePlannerStorage || !global.GoRouteXDispatch) {
    showState('Unable to load Dispatch. Refresh this page to try again.', true);
    return;
  }
  let authSettled = false;
  let accountBusy = false;
  let loadingUid = null;
  const accountNodes = () => [document.getElementById('sidebarDisplayName'), document.getElementById('sidebarCurrentPlan')];
  function logFailure(stage, error) {
    console.warn('ACCOUNT_CONTEXT_STAGE_FAILED', {
      stage,
      code: String(error?.code || 'unknown').slice(0, 60),
      uidPresent: Boolean(auth.getCurrentUser?.()?.uid)
    });
  }
  function showAccountError(stage, message, error) {
    logFailure(stage, error);
    const [nameNode, planNode] = accountNodes();
    if (stage === 'authRestore' || stage === 'profileRead') nameNode.textContent = 'Account unavailable';
    planNode.textContent = 'Plan unavailable';
    showState(message, true);
    stateNode.append(' ');
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'action-button-secondary';
    retryButton.textContent = 'Retry';
    retryButton.addEventListener('click', () => {
      if (accountBusy) return;
      const currentUser = auth.getCurrentUser?.();
      if (currentUser) void startForUser(currentUser, true);
      else global.location.replace(`login.html?next=${encodeURIComponent('dispatch.html' + global.location.search)}`);
    });
    stateNode.append(retryButton);
  }
  const authStartedAt = performance.now();
  const authTimeout = global.setTimeout(() => {
    if (!authSettled) showAccountError('authRestore', 'Unable to restore your sign-in session. Retry or sign in again.', Error('Auth restore timed out.'));
  }, 20000);

  async function startForUser(user, freshAuthState = true) {
    if (accountBusy) return;
    accountBusy = true;
    loadingUid = user?.uid || null;
    const authGeneration = ++generation;
    const accountStartedAt = performance.now();
    if (freshAuthState) global.GoRouteXAccountContext?.clear();
    global.GoRouteXDispatch?.reset?.();
    loadedPlan = null;
    boardNode.hidden = true;
    const [nameNode, planNode] = accountNodes();
    nameNode.textContent = 'Loading account…';
    planNode.textContent = 'Loading plan…';
    showState('Loading your workspace account…');
    if (!user) {
      accountBusy = false;
      global.location.replace(`login.html?next=${encodeURIComponent('dispatch.html' + global.location.search)}`);
      return;
    }
    if (auth.isDriverAccount(user)) {
      accountBusy = false;
      global.location.replace('driver.html');
      return;
    }
    global.GoRouteXDispatch?.prefetchDrivers?.();
    let identity;
    const slowProfileTimer = global.setTimeout(() => {
      if (authGeneration === generation && accountBusy) showState('Account information is taking longer than expected. The request is still running.');
    }, 7000);
    try {
      identity = await global.GoRouteXAccountContext.loadIdentity(user);
    } catch (error) {
      global.clearTimeout(slowProfileTimer);
      if (authGeneration === generation) {
        accountBusy = false;
        showAccountError('profileRead', `Unable to load your account profile. ${error.message || 'Please retry.'}`, error);
      }
      return;
    }
    global.clearTimeout(slowProfileTimer);
    if (authGeneration !== generation) return;
    nameNode.textContent = identity.displayName;
    planNode.textContent = 'Loading plan…';
    if (identity.profile.active === false || !['admin', 'owner', 'owner/admin', 'manager', 'dispatcher'].includes(identity.role) || identity.tenantId !== user.uid) {
      accountBusy = false;
      showAccountError('workspaceResolution', 'Dispatch requires an active workspace owner or operations account.', Error('Workspace access denied.'));
      return;
    }
    let context;
    try {
      context = global.GoRouteXAccountContext.resolvePlan(identity);
    } catch (error) {
      accountBusy = false;
      showAccountError('planResolve', `Plan unavailable. ${error.message || 'Please retry.'}`, error);
      return;
    }
    global.GoRouteXAccountContext.render(context, nameNode, planNode);
    try { performance.measure('grx:accountContext.dispatchTotal', { start: accountStartedAt, end: performance.now() }); } catch {}
    mark('dispatchAuthReady');
    accountBusy = false;
    await restorePlan(user);
  }

  auth.onAuthStateChange(user => {
    authSettled = true;
    global.clearTimeout(authTimeout);
    try { performance.measure('grx:accountContext.authRestore', { start: authStartedAt, end: performance.now() }); } catch {}
    if (accountBusy && loadingUid === (user?.uid || null)) return;
    if (accountBusy) { generation++; accountBusy = false; }
    return startForUser(user);
  });

  global.addEventListener('pagehide', () => { generation++; global.GoRouteXDispatch?.suspend?.(); });
  global.addEventListener('pageshow', event => { if (event.persisted) global.location.reload(); });
})(window);
