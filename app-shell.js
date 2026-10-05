(function () {
  const AUTH_STORAGE_KEYS = [
    'bjsLoggedIn',
    'bjsUsername',
    'bjsUserId',
    'bjsLoginTime'
  ];
  const APP_STORAGE_KEYS = [
    'bjsRouteHistory',
    'bjsSelectedStops',
    'bjsSelectedCustomers',
    'bjsCurrentSession',
    'bjsSessionUpdatedAt',
    'pendingStops'
  ];

  let authUnsubscribe = null;
  let accessRequestId = 0;
  let isLoggingOut = false;
  let activeUid = null;
  let slowTimer = null;
  let gatePanel = null;
  let gateMessage = null;
  let gateRetry = null;
  let gateNavState = new Map();
  let authRestoreTimer = null;
  let authSettled = false;

  function clearSlowTimer() {
    if (slowTimer) clearTimeout(slowTimer);
    slowTimer = null;
  }

  function ensureGatePanel() {
    if (gatePanel) return;
    const root = document.getElementById('activeSubscriberRoot');
    const main = root?.querySelector('.operations-content');
    if (!root || !main) return;
    const style = document.createElement('style');
    style.textContent = '#activeSubscriberRoot.account-is-gated .page,#activeSubscriberRoot.account-is-gated #appRoot{display:none!important}';
    document.head.appendChild(style);
    gatePanel = document.createElement('section');
    gatePanel.id = 'accountBootstrapPanel';
    gatePanel.className = 'app-shell-card';
    gatePanel.setAttribute('aria-live', 'polite');
    gatePanel.innerHTML = '<h1 class="app-shell-title">Loading your workspace</h1><p class="app-shell-copy"></p><div class="app-shell-actions"><button type="button" class="app-shell-action secondary" data-account-retry>Retry</button><button type="button" class="app-shell-action secondary" data-account-logout>Logout</button></div>';
    gateMessage = gatePanel.querySelector('.app-shell-copy');
    gateRetry = gatePanel.querySelector('[data-account-retry]');
    gateRetry.addEventListener('click', () => refreshAccessStateFromUser(window.FirebaseApp?.auth?.getCurrentUser?.()));
    gatePanel.querySelector('[data-account-logout]').addEventListener('click', performLogout);
    main.appendChild(gatePanel);
  }

  function setGate(stage, message, retryVisible = false, workspaceTrusted = false) {
    ensureGatePanel();
    const root = document.getElementById('activeSubscriberRoot');
    if (!root) return;
    root.classList.add('account-is-gated');
    root.dataset.accountStage = stage;
    if (gatePanel) gatePanel.hidden = false;
    if (gateMessage) gateMessage.textContent = message;
    if (gateRetry) gateRetry.hidden = !retryVisible;
    const name = document.getElementById('sidebarDisplayName');
    const plan = document.getElementById('sidebarCurrentPlan');
    if (name) name.textContent = window.GoRouteXAccountContext?.getIdentity?.()?.displayName
      || window.GoRouteXAccountContext?.getCachedDisplayName?.()
      || window.currentAuthUser?.displayName || 'Loading account…';
    if (plan) plan.textContent = 'Plan unavailable';
    const badge = document.getElementById('dashboardPlanBadge');
    if (badge) badge.textContent = 'Plan unavailable';
    root.querySelectorAll('.operations-sidebar button').forEach(button => {
      if (button.classList.contains('operations-logout')) return;
      if (!gateNavState.has(button)) gateNavState.set(button, button.disabled);
      const destination = button.getAttribute('onclick') || '';
      button.disabled = !(workspaceTrusted && /order-hub\.html|settings\.html/.test(destination));
    });
    // Shared sidebar links (app-sidebar.js) are anchors: block them the same way via aria-disabled.
    root.querySelectorAll('.operations-sidebar a[data-nav]').forEach(anchor => {
      if (anchor.tagName !== 'A') return;
      if (!gateNavState.has(anchor)) gateNavState.set(anchor, anchor.getAttribute('aria-disabled') === 'true');
      const allowed = workspaceTrusted && /order-hub\.html|settings\.html/.test(anchor.getAttribute('href') || '');
      anchor.setAttribute('aria-disabled', allowed ? 'false' : 'true');
    });
    setVisibleState('active');
  }

  function releaseGate() {
    const root = document.getElementById('activeSubscriberRoot');
    if (!root) return;
    root.classList.remove('account-is-gated');
    root.dataset.accountStage = 'ready';
    if (gatePanel) gatePanel.hidden = true;
    for (const [control, disabled] of gateNavState) {
      if (control.tagName === 'A') control.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      else control.disabled = disabled;
    }
    gateNavState.clear();
  }

  function getDom() {
    return {
      loadingState: document.getElementById('loadingState'),
      trialExpiredView: document.getElementById('trialExpiredView'),
      activeSubscriberRoot: document.getElementById('activeSubscriberRoot'),
      expiredPlanName: document.getElementById('expiredPlanName'),
      expiredPlanStatus: document.getElementById('expiredPlanStatus'),
      expiredPlanDate: document.getElementById('expiredPlanDate'),
      trialExpiredMessage: document.getElementById('trialExpiredMessage'),
      expiredUpgradeBtn: document.getElementById('expiredUpgradeBtn'),
      contactSalesLink: document.getElementById('contactSalesLink'),
      expiredLogoutBtn: document.getElementById('expiredLogoutBtn'),
      kpiReportModal: document.getElementById('kpiReportModal')
    };
  }

  function openFounderLedUpgrade() {
    if (typeof window.openFounderLedPricing === 'function') {
      window.openFounderLedPricing();
      return;
    }
    window.location.href = 'index.html#pricing';
  }

  function getSafeCurrentTarget() {
    const candidate = `app.html${window.location.hash || ''}`;
    if (window.FirebaseApp?.auth?.sanitizeNextTarget) {
      return window.FirebaseApp.auth.sanitizeNextTarget(candidate);
    }
    return 'app.html';
  }

  function getInitialPageFromTarget(target) {
    if (!target || typeof target !== 'string') return undefined;
    const hashIndex = target.indexOf('#');
    if (hashIndex < 0) return undefined;
    return target.slice(hashIndex + 1) || undefined;
  }

  function setVisibleState(stateName) {
    const { loadingState, trialExpiredView, activeSubscriberRoot, kpiReportModal } = getDom();
    if (loadingState) loadingState.hidden = stateName !== 'loading';
    if (trialExpiredView) trialExpiredView.hidden = stateName !== 'expired';
    if (activeSubscriberRoot) activeSubscriberRoot.hidden = stateName !== 'active';
    if (kpiReportModal && stateName !== 'active') {
      kpiReportModal.style.display = 'none';
    }
  }

  function clearStoredSession() {
    [...AUTH_STORAGE_KEYS, ...APP_STORAGE_KEYS].forEach((key) => {
      localStorage.removeItem(key);
    });
    sessionStorage.removeItem('currentPage');
    window.GoRouteXOrderPlan?.clear();
    window.location.hash = '';
  }

  function syncAuthStorage(user) {
    if (!user) return;
    localStorage.setItem('bjsLoggedIn', 'true');
    localStorage.setItem('bjsUsername', user.displayName || user.email || 'User');
    localStorage.setItem('bjsUserId', user.uid);
    localStorage.setItem('bjsLoginTime', new Date().toISOString());
  }

  function populateExpiredView(profile) {
    const { expiredPlanName, expiredPlanStatus, expiredPlanDate, trialExpiredMessage } = getDom();
    const accessKit = window.GoRouteXAccess;
    const context = accessKit?.resolveUserContext
      ? accessKit.resolveUserContext(profile || {})
      : null;
    const planStatus = profile && profile.planStatus ? String(profile.planStatus) : 'trial';
    const planName = context?.plan?.name || (profile && profile.planName ? String(profile.planName) : 'Trial');
    const expiryText = typeof window.formatPlanDate === 'function'
      ? window.formatPlanDate(profile && profile.trialEndsAt ? profile.trialEndsAt : null)
      : '--';

    if (expiredPlanName) {
      expiredPlanName.textContent = planName.charAt(0).toUpperCase() + planName.slice(1);
    }
    if (expiredPlanStatus) {
      expiredPlanStatus.textContent = 'Expired';
    }
    if (expiredPlanDate) {
      expiredPlanDate.textContent = expiryText || '--';
    }
    if (trialExpiredMessage) {
      trialExpiredMessage.textContent = planStatus === 'active'
        ? `Your ${context?.plan?.shortName || 'paid'} access has ended. Founder-led renewals keep the current plan, expiry date, and upgrade path clear for early customers.`
        : 'Your trial has ended. Founder-led upgrades keep the next plan, rollout timing, and access status clear without a confusing checkout flow.';
    }
  }

  function redirectToLogin(nextTarget = getSafeCurrentTarget()) {
    const query = `?next=${encodeURIComponent(nextTarget)}`;
    window.location.href = `login.html${query}`;
  }

  async function refreshAccessStateFromUser(user) {
    const requestId = ++accessRequestId;
    clearSlowTimer();
    window.currentAuthUser = user || null;
    if (!user) {
      activeUid = null;
      window.GoRouteXAccountContext?.clear();
      window.AppRuntime?.unmount?.();
      clearStoredSession();
      if (!isLoggingOut) redirectToLogin();
      return;
    }
    if (window.FirebaseApp?.auth?.isDriverAccount?.(user)) {
      window.location.replace('driver.html');
      return;
    }
    if (activeUid !== user.uid) {
      activeUid = user.uid;
      window.GoRouteXAccountContext?.clear();
      window.AppRuntime?.unmount?.();
      window.currentUserProfile = undefined;
    }
    syncAuthStorage(user);
    setGate('profile-loading', 'Checking your account information…');
    slowTimer = setTimeout(() => {
      if (requestId === accessRequestId) {
        setGate('profile-slow', 'Account information is taking longer than expected.', true);
      }
    }, 7000);

    let identity;
    try {
      identity = await window.GoRouteXAccountContext.loadIdentity(user);
    } catch (error) {
      clearSlowTimer();
      if (requestId !== accessRequestId) return;
      console.warn('ACCOUNT_BOOTSTRAP_FAILED', { stage: 'profile-or-workspace', code: String(error?.code || 'unknown').slice(0, 60), uidPresent: true });
      setGate('profile-error', (error.message || 'Account information is unavailable.') + ' Please retry.', true);
      return;
    }
    clearSlowTimer();
    if (requestId !== accessRequestId) return;

    window.currentUserProfile = identity.profile;
    window.GoRouteXAccountContext.render(identity,
      document.getElementById('sidebarDisplayName'),
      document.getElementById('sidebarCurrentPlan'));
    setGate('plan-loading', 'Checking your current plan…', false, true);
    let context;
    try {
      context = window.GoRouteXAccountContext.resolvePlan(identity);
    } catch (error) {
      if (requestId !== accessRequestId) return;
      console.warn('ACCOUNT_BOOTSTRAP_FAILED', { stage: 'plan', code: String(error?.code || 'unknown').slice(0, 60), uidPresent: true });
      setGate('plan-error', 'Plan unavailable. ' + (error.message || 'Please retry.'), true, true);
      return;
    }
    if (requestId !== accessRequestId) return;
    const profile = context.profile;
    window.GoRouteXSettings?.getTenantSettings?.().catch(error => console.warn('Company settings could not load:', error));
    const driverNavButton = document.getElementById('driverNavButton');
    if (driverNavButton) driverNavButton.hidden = true;
    if (typeof window.updateProfessionalPlanButton === 'function') window.updateProfessionalPlanButton(profile);
    if (typeof window.renderPricingAccessUi === 'function') window.renderPricingAccessUi();
    if (typeof window.updateUserInfoDisplay === 'function') window.updateUserInfoDisplay();
    const resolveAccessState = window.FirebaseApp?.auth?.resolveAccessState;
    const accessState = resolveAccessState ? resolveAccessState({ user, profile, now: new Date() }) : 'active';
    if (accessState === 'expired') populateExpiredView(profile);
    if (accessState !== 'active' && accessState !== 'expired') {
      setGate('workspace-error', 'Workspace access is unavailable. Please retry or log out.', true);
      return;
    }
    releaseGate();
    setVisibleState('active');
    const initialPage = getInitialPageFromTarget(getSafeCurrentTarget());
    try {
      await window.AppRuntime?.mount?.({ initialPage });
    } catch (error) {
      if (requestId !== accessRequestId) return;
      console.warn('APP_MOUNT_FAILED', { code: String(error?.code || 'unknown').slice(0, 60) });
      try { window.AppRuntime?.unmount?.(); } catch {}
      setGate('mount-error', 'The workspace could not finish loading. Please retry.', true, true);
    }
  }

  async function refreshAccessState() {
    const currentUser = window.FirebaseApp?.auth?.getCurrentUser
      ? window.FirebaseApp.auth.getCurrentUser()
      : null;
    return refreshAccessStateFromUser(currentUser);
  }

  async function performLogout() {
    if (isLoggingOut) return;
    isLoggingOut = true;

    try {
      window.AppRuntime?.unmount?.();
      if (window.FirebaseApp?.auth?.signOut) {
        await window.FirebaseApp.auth.signOut();
      }
    } catch (error) {
      console.warn('Shared logout sign-out failed:', error);
    } finally {
      clearStoredSession();
      clearSlowTimer();
      activeUid = null;
      window.GoRouteXAccountContext?.clear();
      isLoggingOut = false;
      window.location.href = 'login.html';
    }
  }

  function handleExpiredUpgrade() {
    const { expiredUpgradeBtn } = getDom();
    if (!expiredUpgradeBtn) return;
    expiredUpgradeBtn.blur();
    openFounderLedUpgrade();
  }

  function bindControls() {
    const { expiredUpgradeBtn, contactSalesLink, expiredLogoutBtn } = getDom();
    expiredUpgradeBtn?.addEventListener('click', handleExpiredUpgrade);
    contactSalesLink?.addEventListener('click', () => {
      // Keep the link honest even if the static href changes later.
      openFounderLedUpgrade();
    });
    expiredLogoutBtn?.addEventListener('click', performLogout);
  }

  async function init() {
    bindControls();
    setVisibleState('loading');

    const initOk = window.FirebaseApp?.isInitialized?.() || window.FirebaseApp?.init?.();
    if (!window.FirebaseApp?.auth || !initOk) {
      clearStoredSession();
      redirectToLogin();
      return;
    }

    authUnsubscribe = window.FirebaseApp.auth.onAuthStateChange(async (user) => {
      authSettled = true;
      if (authRestoreTimer) clearTimeout(authRestoreTimer);
      authRestoreTimer = null;
      try {
        await refreshAccessStateFromUser(user);
      } catch (error) {
        console.error('Access state refresh failed:', error);
        setGate('auth-error', 'Sign-in state could not be checked. Please retry or log out.', true);
      }
    });
    authRestoreTimer = setTimeout(() => {
      if (authSettled) return;
      const title = document.querySelector('#loadingState .app-shell-title');
      const copy = document.querySelector('#loadingState .app-shell-copy');
      if (title) title.textContent = 'Sign-in is taking longer than expected';
      if (copy) copy.textContent = 'Your session is still being checked. Retry or return to Login.';
      const card = document.querySelector('#loadingState .app-shell-card');
      if (card && !document.getElementById('authRecoveryActions')) {
        const actions = document.createElement('div');
        actions.id = 'authRecoveryActions';
        actions.className = 'app-shell-actions';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'app-shell-action secondary';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => window.location.reload());
        const login = document.createElement('button');
        login.type = 'button';
        login.className = 'app-shell-action secondary';
        login.textContent = 'Login';
        login.addEventListener('click', () => redirectToLogin());
        actions.append(retry, login);
        card.appendChild(actions);
      }
    }, 20000);
  }

  window.AppShell = {
    init,
    performLogout,
    refreshAccessState,
    dispose() {
      if (authRestoreTimer) clearTimeout(authRestoreTimer);
      clearSlowTimer();
      if (typeof authUnsubscribe === 'function') {
        authUnsubscribe();
        authUnsubscribe = null;
      }
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
