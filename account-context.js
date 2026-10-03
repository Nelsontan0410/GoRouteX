(function (global) {
  // Firebase Auth owns identity; users/{uid} owns profile and billing state.
  const PLAN_LABELS = Object.freeze({ basic: 'Basic', goplan: 'Go Plan', proplan: 'Pro Plan' });
  const PLAN_FIELDS = ['productPlanKey', 'productPlan', 'permanentPlanLabel', 'planKey', 'planName'];
  const LEGACY_STATUSES = new Set(['active', 'trial', 'expired', 'cancelled', 'canceled']);
  const OWNER_ROLES = new Set(['admin', 'owner', 'owner/admin']);
  const WORKSPACE_ERROR = 'Workspace membership is missing or invalid.';
  let identity = null;
  let context = null;
  let pendingIdentity = null;
  let cachedDisplayName = '';
  let generation = 0;
  const mark = name => { try { global.performance?.mark(`grx:accountContext.${name}`); } catch {} };
  const measure = (name, start, end) => { try { global.performance?.measure(`grx:accountContext.${name}`, `grx:accountContext.${start}`, `grx:accountContext.${end}`); } catch {} };
  function diagnostic(stage, error) {
    console.warn('ACCOUNT_CONTEXT_STAGE_FAILED', {
      stage,
      code: String(error?.code || 'unknown').slice(0, 60),
      uidPresent: Boolean(global.FirebaseApp?.auth?.getCurrentUser?.()?.uid)
    });
  }
  function clear() {
    generation += 1;
    identity = null;
    context = null;
    pendingIdentity = null;
    cachedDisplayName = '';
    global.currentUserProfile = undefined;
  }
  function resolveWorkspaceId(user, profile, role) {
    const uid = user.uid;
    if (profile.uid != null && profile.uid !== uid) throw Error(WORKSPACE_ERROR);
    if (profile.active === false || uid.startsWith('drv_') || profile.driverId || profile.authMethod === 'pin' || profile.sessionVersion != null) throw Error(WORKSPACE_ERROR);
    if (profile.tenantId != null && typeof profile.tenantId !== 'string') throw Error(WORKSPACE_ERROR);
    const declaredTenantId = String(profile.tenantId || '').trim();
    if (declaredTenantId === uid) return uid;
    if (!OWNER_ROLES.has(role)) throw Error(WORKSPACE_ERROR);

    // The old Owner workspace was users/{uid}. A server-confirmed, self-owned
    // legacy profile may carry unrelated tenant metadata, but cannot access it.
    const otherMembership = ['workspaceId', 'ownerUid', 'workspace', 'membership', 'memberships']
      .some(field => profile[field] != null && profile[field] !== '');
    if (otherMembership || (declaredTenantId && profile.uid !== uid)) throw Error(WORKSPACE_ERROR);
    return uid;
  }
  function identityFromProfile(user, profile, source = {}) {
    if (!user?.uid || !profile || typeof profile !== 'object') throw Error('Account profile unavailable. Retry loading your account.');
    if (source.fromCache === true || source.serverConfirmed === false) throw Error('Workspace verification requires a server-confirmed profile.');
    const uid = user.uid;
    const role = String(profile.role || '').trim().toLowerCase();
    if (!['admin', 'owner', 'owner/admin', 'manager', 'dispatcher'].includes(role)) throw Error('Workspace role is missing or invalid.');
    const tenantId = resolveWorkspaceId(user, profile, role);
    const displayName = String(profile.name || user.displayName || user.email?.split('@')[0] || '').trim();
    if (!displayName) throw Error('Display name unavailable. Retry loading your account.');
    return Object.freeze({ uid, tenantId, workspaceId: tenantId, displayName, role, profile, serverConfirmed: true });
  }
  function resolvePlan(resolvedIdentity) {
    mark('planStart');
    if (!resolvedIdentity?.profile) throw Error('Account profile unavailable. Retry loading your account.');
    const profile = resolvedIdentity.profile;
    const toolkit = global.RoutePlannerProduct;
    if (typeof toolkit?.getCurrentPlan !== 'function' || typeof toolkit.normalizePlanKey !== 'function') throw Error('Plan service unavailable. Refresh this page.');
    const specifiedPlans = PLAN_FIELDS.map(field => profile[field]).filter(value => value != null && String(value).trim());
    const canonicalPlan = [profile.productPlanKey, profile.productPlan, profile.permanentPlanLabel].find(value => value != null && String(value).trim());
    if (canonicalPlan && !toolkit.normalizePlanKey(canonicalPlan, '')) throw Error('Plan unavailable. Retry loading your account.');
    const hasKnownPlan = specifiedPlans.some(value => toolkit.normalizePlanKey(value, '') !== '');
    const hasLegacyStatus = LEGACY_STATUSES.has(String(profile.planStatus || '').trim().toLowerCase());
    if (!hasKnownPlan && (specifiedPlans.length || !hasLegacyStatus)) throw Error('Plan unavailable. Retry loading your account.');
    const planId = toolkit.getCurrentPlan(profile);
    if (!Object.prototype.hasOwnProperty.call(PLAN_LABELS, planId)) throw Error('Plan unavailable. Retry loading your account.');
    const resolved = Object.freeze({
      ...resolvedIdentity, planId, planLabel: PLAN_LABELS[planId],
      subscriptionStatus: String(profile.billingStatus || profile.planStatus || '').trim().toLowerCase(),
      entitlements: toolkit.getPlanDefinition(planId)
    });
    context = resolved;
    mark('planEnd');
    measure('plan', 'planStart', 'planEnd');
    return resolved;
  }
  function fromProfile(user, profile) { return resolvePlan(identityFromProfile(user, profile)); }
  function acceptProfile(user, profile) {
    const resolvedIdentity = identityFromProfile(user, profile);
    if (global.FirebaseApp?.auth?.getCurrentUser?.()?.uid !== user.uid) throw Error('Account changed while loading.');
    identity = resolvedIdentity;
    global.currentUserProfile = profile;
    return resolvePlan(resolvedIdentity);
  }
  async function loadIdentity(user) {
    if (!user?.uid) throw Error('Sign in to load your account.');
    if ((identity && identity.uid !== user.uid) || (pendingIdentity && pendingIdentity.uid !== user.uid)) clear();
    if (identity?.uid === user.uid) return identity;
    if (pendingIdentity?.uid === user.uid) return pendingIdentity.promise;
    const requestGeneration = generation;
    mark('auth');
    mark('profileStart');
    const promise = (async () => {
      try {
        const auth = global.FirebaseApp?.auth;
        const reader = auth?.loadProfile || auth?.ensureProfile;
        if (typeof reader !== 'function') throw Error('Account service unavailable. Retry loading your account.');
        let result = await reader(user);
        if (!result?.success || !result.profile) {
          const error = Error(result?.error || 'Account profile unavailable. Retry loading your account.');
          error.code = result?.code || 'profile-unavailable';
          throw error;
        }
        if (requestGeneration !== generation || auth.getCurrentUser?.()?.uid !== user.uid) throw Error('Account changed while loading.');
        if (result.fromCache === true || result.serverConfirmed === false) {
          cachedDisplayName = String(result.profile.name || user.displayName || '').trim();
          if (typeof auth.loadProfile !== 'function') throw Error('Workspace verification requires a server-confirmed profile.');
          result = await auth.loadProfile(user, { source: 'server' });
          if (!result?.success || !result.profile || result.fromCache === true || result.serverConfirmed === false) {
            const error = Error(result?.error || 'Workspace verification requires a server connection.');
            error.code = result?.code || 'workspace-unverified';
            throw error;
          }
        }
        if (requestGeneration !== generation || auth.getCurrentUser?.()?.uid !== user.uid) throw Error('Account changed while loading.');
        mark('workspaceStart');
        const resolved = identityFromProfile(user, result.profile, result);
        mark('workspaceEnd');
        measure('workspace', 'workspaceStart', 'workspaceEnd');
        identity = resolved;
        cachedDisplayName = '';
        global.currentUserProfile = result.profile;
        mark('profileEnd');
        measure('profile', 'profileStart', 'profileEnd');
        mark('workspace');
        return resolved;
      } catch (error) {
        diagnostic('profileRead', error);
        throw error;
      }
    })();
    pendingIdentity = { uid: user.uid, promise };
    try { return await promise; }
    finally { if (pendingIdentity?.promise === promise) pendingIdentity = null; }
  }
  async function load(user, options = {}) {
    if (!options.fresh && context?.uid === user?.uid) return context;
    if (options.fresh) clear();
    mark('totalStart');
    const resolvedIdentity = await loadIdentity(user);
    if (!options.fresh && context?.uid === resolvedIdentity.uid && context.profile === resolvedIdentity.profile) return context;
    try {
      const resolved = resolvePlan(resolvedIdentity);
      mark('totalEnd');
      measure('total', 'totalStart', 'totalEnd');
      return resolved;
    } catch (error) {
      diagnostic('planResolve', error);
      throw error;
    }
  }
  function render(resolved, nameNode, planNode) {
    if (nameNode) nameNode.textContent = resolved?.displayName || 'Account unavailable';
    if (planNode) planNode.textContent = resolved?.planLabel || 'Plan unavailable';
  }
  global.GoRouteXAccountContext = {
    load, loadIdentity, resolvePlan, fromProfile, acceptProfile, clear, render,
    get: () => context, getIdentity: () => identity, getCachedDisplayName: () => cachedDisplayName, isLoading: () => !!pendingIdentity
  };
})(window);
