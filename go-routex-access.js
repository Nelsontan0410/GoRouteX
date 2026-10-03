(function (global) {
  const PLAN_ORDER = ['trial', 'basic', 'pro', 'team'];
  const ROLE_ORDER = ['admin', 'driver'];

  const COMPARISON_ROWS = [
    { key: 'users', label: 'User seats' },
    { key: 'customers', label: 'Customer / stop capacity' },
    { key: 'activeRoutes', label: 'Active routes' },
    { key: 'routeHistory', label: 'Route history retention' },
    { key: 'gpsTracking', label: 'GPS tracking depth' },
    { key: 'whatsappShare', label: 'WhatsApp workflow' },
    { key: 'advancedWhatsappTools', label: 'Advanced communication tools' },
    { key: 'csvImport', label: 'CSV import' },
    { key: 'analyticsReports', label: 'Reports and KPI review' },
    { key: 'exportPrint', label: 'Export / print tools' },
    { key: 'roleTemplates', label: 'Role templates' },
    { key: 'adminControls', label: 'Admin and billing controls' }
  ];

  const USAGE_LIMIT_KEYS = [
    { key: 'customers', label: 'Customers', unitLabel: 'customers' },
    { key: 'activeRoutes', label: 'Active routes', unitLabel: 'routes' },
    { key: 'users', label: 'Users', unitLabel: 'users' }
  ];

  const PLAN_DEFINITIONS = {
    trial: {
      key: 'trial',
      name: 'Free Trial',
      shortName: 'Trial',
      priceLabel: 'Free',
      priceNote: '7 days',
      targetUser: 'Owners validating fit with a real route week',
      bestFor: 'Testing daily planning, route visibility, and WhatsApp-friendly operations before rollout.',
      featured: false,
      ctaLabel: 'Start Free Trial',
      ctaHref: 'login.html?mode=signup&next=app.html',
      supportLabel: 'Founder-led onboarding included',
      limits: {
        customers: 40,
        activeRoutes: 2,
        users: 1,
        historyDays: 7,
        gpsTrackingDays: 7,
        importRows: 0
      },
      included: [
        'Route planning and stop management',
        'WhatsApp-ready route sharing',
        'Live GPS tracking for the current workday',
        '7 days of route history'
      ],
      comparison: {
        users: '1 seat',
        customers: '40 customers',
        activeRoutes: '2 routes',
        routeHistory: '7 days',
        gpsTracking: 'Current day',
        whatsappShare: 'Basic',
        advancedWhatsappTools: 'Locked',
        csvImport: 'Locked',
        analyticsReports: 'Locked',
        exportPrint: 'Locked',
        roleTemplates: 'Locked',
        adminControls: 'Locked'
      }
    },
    basic: {
      key: 'basic',
      name: 'Basic',
      shortName: 'Basic',
      priceLabel: 'See Account billing',
      priceNote: 'per month',
      targetUser: 'Small dispatch teams managing one daily workflow',
      bestFor: 'A lean operations team that needs practical planning without advanced admin controls.',
      featured: false,
      ctaLabel: 'Choose Basic',
      ctaHref: 'index.html#pricing',
      supportLabel: 'Simple monthly access',
      limits: {
        customers: 150,
        activeRoutes: 6,
        users: 2,
        historyDays: 30,
        gpsTrackingDays: 30,
        importRows: 250
      },
      included: [
        'Everything in Trial',
        '30 days of route and GPS history',
        '2 user seats for owner and dispatcher access',
        'Suitable for a lean daily delivery workflow'
      ],
      comparison: {
        users: '2 seats',
        customers: '150 customers',
        activeRoutes: '6 routes',
        routeHistory: '30 days',
        gpsTracking: '30 days',
        whatsappShare: 'Basic',
        advancedWhatsappTools: 'Locked',
        csvImport: 'Locked',
        analyticsReports: 'Locked',
        exportPrint: 'Locked',
        roleTemplates: 'Locked',
        adminControls: 'Locked'
      }
    },
    pro: {
      key: 'pro',
      name: 'Pro',
      shortName: 'Pro',
      priceLabel: 'See Account billing',
      priceNote: 'per month',
      targetUser: 'Growing SME logistics teams with coordinators and supervisors',
      bestFor: 'Teams that need deeper route review, better exports, and more structured communication controls.',
      featured: true,
      ctaLabel: 'Upgrade to Pro',
      ctaHref: 'index.html#pricing',
      supportLabel: 'Most practical upgrade for growing SMEs',
      limits: {
        customers: 600,
        activeRoutes: 20,
        users: 5,
        historyDays: 180,
        gpsTrackingDays: 180,
        importRows: 5000
      },
      included: [
        'Everything in Basic',
        'CSV stop import and bulk data cleanup',
        'KPI report and export-ready review tools',
        'Advanced WhatsApp tools and follow-up actions',
        'Role templates for manager, dispatcher, and driver views'
      ],
      comparison: {
        users: '5 seats',
        customers: '600 customers',
        activeRoutes: '20 routes',
        routeHistory: '180 days',
        gpsTracking: '180 days',
        whatsappShare: 'Advanced',
        advancedWhatsappTools: 'Included',
        csvImport: 'Included',
        analyticsReports: 'Included',
        exportPrint: 'Included',
        roleTemplates: 'Included',
        adminControls: 'Limited'
      }
    },
    team: {
      key: 'team',
      name: 'Team / Business',
      shortName: 'Team',
      priceLabel: 'See Account billing',
      priceNote: 'per month',
      targetUser: 'Multi-user operations teams that need clearer control and future scaling room',
      bestFor: 'Businesses that want stronger admin visibility, wider team access, and larger data capacity.',
      featured: false,
      ctaLabel: 'Talk to Us About Team',
      ctaHref: 'index.html#pricing',
      supportLabel: 'Founder-led rollout support',
      limits: {
        customers: Number.POSITIVE_INFINITY,
        activeRoutes: Number.POSITIVE_INFINITY,
        users: 15,
        historyDays: 365,
        gpsTrackingDays: 365,
        importRows: Number.POSITIVE_INFINITY
      },
      included: [
        'Everything in Pro',
        'Extended route and GPS history retention',
        'Owner/admin controls for plan and team access',
        'Higher seat allowance for dispatch and field supervisors',
        'Business-ready rollout support'
      ],
      comparison: {
        users: '15 seats',
        customers: 'Unlimited',
        activeRoutes: 'Unlimited',
        routeHistory: '365 days',
        gpsTracking: '365 days',
        whatsappShare: 'Advanced',
        advancedWhatsappTools: 'Included',
        csvImport: 'Included',
        analyticsReports: 'Included',
        exportPrint: 'Included',
        roleTemplates: 'Included',
        adminControls: 'Full'
      }
    }
  };

  const ROLE_DEFINITIONS = {
    admin: {
      key: 'admin',
      name: 'Admin',
      summary: 'Can manage billing, plan access, routes, stops, history, imports, tracking, and operational settings.',
      permissions: [
        'account.view',
        'billing.manage',
        'team.manage',
        'routes.manage',
        'routes.view',
        'stops.manage',
        'stops.view',
        'history.manage',
        'history.view',
        'tracking.view',
        'analytics.view',
        'imports.manage',
        'communications.advanced'
      ]
    },
    driver: {
      key: 'driver',
      name: 'Driver',
      summary: 'Can view assigned route details, navigation context, and daily operational history relevant to route execution.',
      permissions: [
        'account.view',
        'routes.view',
        'history.view',
        'tracking.view'
      ]
    }
  };

  const FEATURE_DEFINITIONS = {
    csvImport: {
      key: 'csvImport',
      name: 'CSV Stop Import',
      minPlan: 'pro',
      permission: 'imports.manage',
      upgradeTitle: 'Upgrade to Pro for bulk stop import',
      upgradeMessage: 'CSV import is designed for teams moving customer lists from spreadsheets into GoRouteX without manual re-entry.'
    },
    advancedWhatsappTools: {
      key: 'advancedWhatsappTools',
      name: 'Advanced WhatsApp Tools',
      minPlan: 'pro',
      permission: 'communications.advanced',
      upgradeTitle: 'Upgrade to Pro for advanced communication tools',
      upgradeMessage: 'Voice prompts, feedback follow-up, and exception messages are available on Pro and Team plans.'
    },
    analyticsReports: {
      key: 'analyticsReports',
      name: 'KPI Report and Analytics',
      minPlan: 'pro',
      permission: 'analytics.view',
      upgradeTitle: 'Upgrade to Pro for KPI reporting',
      upgradeMessage: 'Performance reports, KPI review, and printable route analytics are unlocked on Pro and Team plans.'
    },
    exportPrint: {
      key: 'exportPrint',
      name: 'Export and Print Tools',
      minPlan: 'pro',
      permission: 'analytics.view',
      upgradeTitle: 'Upgrade to Pro for export-ready reports',
      upgradeMessage: 'Printable KPI reports and structured exports are intended for teams that need operational review and audit trails.'
    },
    adminControls: {
      key: 'adminControls',
      name: 'Admin Controls',
      minPlan: 'team',
      permission: 'billing.manage',
      upgradeTitle: 'Upgrade to Team for admin controls',
      upgradeMessage: 'Team plans are built for businesses that need owner-level billing, access, and rollout controls.'
    }
  };

  function getPlanRank(planKey) {
    const normalized = PLAN_ORDER.includes(planKey) ? planKey : 'trial';
    return PLAN_ORDER.indexOf(normalized);
  }

  function normalizePlanKey(rawPlanName, planStatus) {
    const candidate = String(rawPlanName || '').trim().toLowerCase();
    if (candidate === 'team' || candidate === 'team/business' || candidate === 'business') return 'team';
    if (candidate === 'pro' || candidate === 'professional') return 'pro';
    if (candidate === 'basic' || candidate === 'starter') return 'basic';
    if (candidate === 'trial' || candidate === 'free-trial' || candidate === 'free trial') return 'trial';
    if (String(planStatus || '').toLowerCase() === 'active') return 'pro';
    return 'trial';
  }

  function resolveRoleKey(rawRole) {
    const candidate = String(rawRole || '').trim().toLowerCase();
    if (candidate === 'owner' || candidate === 'admin' || candidate === 'owner/admin') return 'admin';
    if (candidate === 'manager') return 'admin';
    if (candidate === 'dispatcher') return 'admin';
    if (candidate === 'driver' || candidate === 'view-only' || candidate === 'view_only') return 'driver';
    return 'admin';
  }

  function resolveUserContext(profile) {
    const planKey = normalizePlanKey(profile && (profile.planKey || profile.planName), profile && profile.planStatus);
    const roleKey = resolveRoleKey(profile && profile.role);
    return {
      planKey,
      roleKey,
      plan: PLAN_DEFINITIONS[planKey],
      role: ROLE_DEFINITIONS[roleKey],
      planStatus: String(profile && profile.planStatus ? profile.planStatus : 'trial').toLowerCase()
    };
  }

  function hasPlanAccess(currentPlanKey, requiredPlanKey) {
    if (!requiredPlanKey) return true;
    return getPlanRank(currentPlanKey) >= getPlanRank(requiredPlanKey);
  }

  function hasPermission(roleKey, permissionKey) {
    if (!permissionKey) return true;
    const role = ROLE_DEFINITIONS[resolveRoleKey(roleKey)];
    return Boolean(role && role.permissions.includes(permissionKey));
  }

  function getLimit(planKey, limitKey) {
    const plan = PLAN_DEFINITIONS[normalizePlanKey(planKey)];
    if (!plan || !plan.limits) return null;
    return typeof plan.limits[limitKey] === 'undefined' ? null : plan.limits[limitKey];
  }

  function formatLimitValue(limit, unitLabel = '') {
    if (limit === Number.POSITIVE_INFINITY) {
      return unitLabel ? `Unlimited ${unitLabel}` : 'Unlimited';
    }
    if (limit === null || typeof limit === 'undefined') {
      return 'Not set';
    }
    return unitLabel ? `${limit} ${unitLabel}` : String(limit);
  }

  function getLimitStatus(planKey, limitKey, usedValue) {
    const limit = getLimit(planKey, limitKey);
    const used = Number.isFinite(Number(usedValue)) ? Number(usedValue) : 0;
    if (limit === Number.POSITIVE_INFINITY) {
      return {
        limit,
        used,
        remaining: Number.POSITIVE_INFINITY,
        percent: 0,
        reached: false,
        nearLimit: false
      };
    }

    if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) {
      return {
        limit,
        used,
        remaining: 0,
        percent: 100,
        reached: true,
        nearLimit: true
      };
    }

    const safeLimit = Number(limit);
    const percent = Math.min(100, Math.round((used / safeLimit) * 100));
    return {
      limit: safeLimit,
      used,
      remaining: Math.max(safeLimit - used, 0),
      percent,
      reached: used >= safeLimit,
      nearLimit: used >= Math.ceil(safeLimit * 0.8)
    };
  }

  function getNextPlanKey(planKey) {
    const currentRank = getPlanRank(planKey);
    return PLAN_ORDER[currentRank + 1] || null;
  }

  function canAccessFeature(options = {}) {
    const profile = options.profile || {};
    const featureKey = options.featureKey;
    const feature = FEATURE_DEFINITIONS[featureKey];
    const context = resolveUserContext(profile);
    if (!feature) {
      return {
        allowed: true,
        context,
        feature: null
      };
    }

    const blockedByPlan = feature.minPlan ? !hasPlanAccess(context.planKey, feature.minPlan) : false;
    const blockedByPermission = feature.permission ? !hasPermission(context.roleKey, feature.permission) : false;

    return {
      allowed: !blockedByPlan && !blockedByPermission,
      context,
      feature,
      blockedByPlan,
      blockedByPermission,
      requiredPlanKey: feature.minPlan || null,
      requiredRolePermission: feature.permission || null,
      nextPlanKey: feature.minPlan || getNextPlanKey(context.planKey)
    };
  }

  global.GoRouteXAccess = {
    PLAN_ORDER,
    ROLE_ORDER,
    PLAN_DEFINITIONS,
    ROLE_DEFINITIONS,
    FEATURE_DEFINITIONS,
    COMPARISON_ROWS,
    USAGE_LIMIT_KEYS,
    resolveUserContext,
    normalizePlanKey,
    resolveRoleKey,
    hasPlanAccess,
    hasPermission,
    getLimit,
    formatLimitValue,
    getLimitStatus,
    getNextPlanKey,
    canAccessFeature
  };
})(window);
