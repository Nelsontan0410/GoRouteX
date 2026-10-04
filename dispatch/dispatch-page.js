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

  function showState(message, error = false, offerPlan = false) {
    stateNode.textContent = message;
    stateNode.classList.toggle('is-error', error);
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
        printRoute
      });
    }
    global.GoRouteXDispatch.refresh();
  }

  async function readPlan(planId) {
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
        result = await withDeadline(readPlan(explicit));
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
      if (request === generation) showState(`Unable to load Dispatch. ${error.message || ''}`, true, true);
    }
  }

  function printRoute(routeId, driverName, planDate, startTime) {
    if (global.RoutePlannerProduct?.canUseFeature?.('kpiPrintSummary', global.RoutePlannerProduct.getCurrentPlan(global.currentUserProfile || {})) === false) return;
    const route = (loadedPlan?.plannedRoutes || []).find(item => String(item.id) === String(routeId));
    if (!route) return showState('Plan no longer available.', true, true);
    const popup = global.open('', '_blank', 'width=900,height=760');
    if (!popup) { global.alert('Allow pop-ups to print the schedule list.'); return; }
    popup.document.open();
    popup.document.write('<!doctype html><html><head><title>GoRouteX Schedule List</title><style>body{font:14px Arial,sans-serif;color:#183047;margin:28px}h1{margin-bottom:6px}p{color:#536479}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #dce5eb}th{background:#f3f8fa}small{display:block;color:#536479}button{padding:9px 16px}@media print{button{display:none}}</style></head><body><h1>GoRouteX Schedule List</h1><p id="meta"></p><table><thead><tr><th>#</th><th>Customer / Orders</th><th>Address / Contact</th><th>ETA</th><th>Completed</th><th>Notes</th></tr></thead><tbody id="rows"></tbody></table><p><button onclick="window.print()">Print</button></p></body></html>');
    popup.document.close();
    popup.document.getElementById('meta').textContent = `Route ${routeId} · ${planDate || 'Date unavailable'} · Start ${startTime || '—'} · Driver ${driverName || 'Unassigned'}`;
    const rows = popup.document.getElementById('rows');
    global.GoRouteXDispatch.routeStops(route).forEach((stop, index) => {
      const row = popup.document.createElement('tr');
      const timing = global.GoRouteXDispatch.lookupTiming(route, stop);
      const name = String(stop.customerName || stop.Name || stop.stopName || stop.name || 'Stop');
      const orders = Array.isArray(stop.orderNumbers) ? stop.orderNumbers.join(' / ') : '';
      const address = String(stop.deliveryAddress || stop.address || stop.Address || '—');
      const contact = [stop.contactName, stop.contactPhone || stop.phone || stop['Hp No']].filter(Boolean).join(' · ');
      const values = [String(index + 1), orders ? `${name}\nOrders: ${orders}` : name, contact ? `${address}\n${contact}` : address, String(timing?.arrivalTimeStr || '—'), '', ''];
      values.forEach(value => { const cell = popup.document.createElement('td'); cell.textContent = value; cell.style.whiteSpace = 'pre-line'; row.append(cell); });
      rows.append(row);
    });
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
