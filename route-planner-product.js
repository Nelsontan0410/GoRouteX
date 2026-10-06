(function (global) {
  const PLAN_ORDER = ['basic', 'goplan', 'proplan'];
  const PREVIEW_FEATURES = new Set(['liveRouteTracking', 'advancedInsights']);

  const PLAN_DEFINITIONS = {
    basic: {
      key: 'basic',
      name: 'Basic',
      shortName: 'Basic',
      storageMode: 'indexeddb',
      limits: {
        maxSavedStops: 50,
        // Daily automatic plans (entries into Review & Assign). Name kept for stored data compatibility.
        maxSavedRoutesPerDay: 2,
        maxStopsPerRoute: 8,
        maxSelectableStops: 16
      },
      dashboardSummary: 'Useful daily route planning with device-only storage.',
      showcaseHighlights: [
        'WhatsApp ETA sharing',
        'WhatsApp unable-to-visit notice',
        'Single-user device-only storage'
      ]
    },
    goplan: {
      key: 'goplan',
      name: 'GoPlan',
      shortName: 'GoPlan',
      storageMode: 'cloud',
      limits: {
        maxSavedStops: 500,
        maxSavedRoutesPerDay: 10,
        maxStopsPerRoute: 8,
        maxSelectableStops: 25
      },
      dashboardSummary: 'Cloud-backed planning with more daily route capacity and continuity across devices.',
      showcaseHighlights: [
        'Cloud sync and backup',
        'Cross-device route continuity',
        'Deeper route history',
        'More saved route capacity'
      ]
    },
    proplan: {
      key: 'proplan',
      name: 'ProPlan',
      shortName: 'ProPlan',
      storageMode: 'cloud',
      limits: {
        maxSavedStops: 1500,
        maxSavedRoutesPerDay: 50,
        maxStopsPerRoute: 8,
        maxSelectableStops: 100
      },
      dashboardSummary: 'Operational planning with cloud sync, imports, and stronger review tools.',
      showcaseHighlights: [
        'CSV import',
        'Higher saved stop capacity',
        'KPI and printable summaries',
        'Advanced WhatsApp workflow tools'
      ]
    }
  };

  const FEATURE_DEFINITIONS = {
    whatsappEta: {
      key: 'whatsappEta',
      name: 'WhatsApp ETA Sharing',
      plans: ['basic', 'goplan', 'proplan']
    },
    whatsappUnableToVisitNotice: {
      key: 'whatsappUnableToVisitNotice',
      name: 'WhatsApp Unable-to-Visit Notice',
      plans: ['basic', 'goplan', 'proplan']
    },
    cloudSync: {
      key: 'cloudSync',
      name: 'Cloud Sync',
      plans: ['goplan', 'proplan']
    },
    csvImport: {
      key: 'csvImport',
      name: 'CSV Import',
      plans: ['basic', 'goplan', 'proplan']
    },
    liveRouteTracking: {
      key: 'liveRouteTracking',
      name: 'Live Route Tracking',
      plans: ['goplan', 'proplan']
    },
    advancedHistory: {
      key: 'advancedHistory',
      name: 'Advanced History',
      plans: ['goplan', 'proplan']
    },
    advancedInsights: {
      key: 'advancedInsights',
      name: 'Advanced Insights',
      plans: ['proplan']
    },
    kpiPrintSummary: {
      key: 'kpiPrintSummary',
      name: 'KPI / Print Summary',
      plans: ['basic', 'goplan', 'proplan']
    },
    advancedWhatsappTools: {
      key: 'advancedWhatsappTools',
      name: 'Advanced WhatsApp Workflow Tools',
      plans: ['proplan']
    }
  };

  function normalizePlanKey(rawPlanKey, fallback = 'basic') {
    const candidate = String(rawPlanKey || '').trim().toLowerCase();
    if (!candidate) return fallback;

    if (candidate === 'basic' || candidate === 'free' || candidate === 'starter') return 'basic';
    if (candidate === 'goplan' || candidate === 'go' || candidate === 'go-plan' || candidate === 'go plan') return 'goplan';
    if (candidate === 'proplan' || candidate === 'pro-plan' || candidate === 'pro plan' || candidate === 'pro_plan') return 'proplan';

    // Migration-safe legacy mapping:
    // legacy trial becomes the new Basic, while legacy paid cloud plans
    // continue on cloud-backed tiers until profile-level product plan data exists.
    if (candidate === 'trial' || candidate === 'free-trial' || candidate === 'free trial') return 'basic';
    if (candidate === 'basic-legacy' || candidate === 'legacy-basic') return 'goplan';
    if (candidate === 'basic') return 'basic';
    if (candidate === 'pro' || candidate === 'professional' || candidate === 'professional plan') return 'proplan';
    if (candidate === 'team' || candidate === 'business' || candidate === 'enterprise') return 'proplan';

    return fallback;
  }

  function getHighestPlanKey(planKeys = []) {
    return planKeys
      .map((planKey) => normalizePlanKey(planKey, ''))
      .filter(Boolean)
      .sort((left, right) => getPlanRank(right) - getPlanRank(left))[0] || 'basic';
  }

  function toPlanDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    if (typeof value.seconds === 'number') {
      const date = new Date(value.seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getPlanExpiryDate(profile = {}) {
    return toPlanDate(
      profile.planExpiresAt
      || profile.subscriptionExpiresAt
      || profile.accessExpiresAt
      || profile.trialEndsAt
      || null
    );
  }

  function isPlanExpired(profile = {}, now = new Date()) {
    if (profile?.permanentPlan) return false;
    const planStatus = String(profile?.planStatus || '').trim().toLowerCase();
    const billingStatus = String(profile?.billingStatus || profile?.paymentStatus || '').trim().toLowerCase();
    if (['expired', 'cancelled', 'canceled'].includes(planStatus)) return true;
    if (['expired', 'cancelled', 'canceled'].includes(billingStatus)) return true;

    const expiryDate = getPlanExpiryDate(profile);
    if (!expiryDate) return false;
    const nowDate = now instanceof Date ? now : new Date(now || Date.now());
    if (Number.isNaN(nowDate.getTime())) return false;
    return nowDate.getTime() > expiryDate.getTime();
  }

  function getCurrentPlan(profile = {}) {
    const legacyPlan = String(profile.planKey || profile.planName || '').trim().toLowerCase();
    const productPlanCandidates = [
      profile.productPlanKey,
      profile.productPlan,
      profile.permanentPlanLabel
    ].map((planKey) => normalizePlanKey(planKey, '')).filter(Boolean);
    const legacyPlanCandidates = [
      profile.planKey,
      profile.planName
    ].map((planKey) => normalizePlanKey(planKey, '')).filter(Boolean);
    const profilePlanCandidates = [...productPlanCandidates, ...legacyPlanCandidates];

    let resolvedPlan = 'basic';

    if (profilePlanCandidates.includes('proplan')) {
      resolvedPlan = 'proplan';
    } else if (profilePlanCandidates.includes('goplan')) {
      resolvedPlan = 'goplan';
    } else if (productPlanCandidates.includes('basic')) {
      resolvedPlan = 'basic';
    } else if (legacyPlan === 'trial') {
      resolvedPlan = 'basic';
    } else if (legacyPlan === 'basic') {
      resolvedPlan = 'goplan';
    } else if (legacyPlan === 'pro' || legacyPlan === 'team') {
      resolvedPlan = 'proplan';
    } else if (!legacyPlan && String(profile.planStatus || '').trim().toLowerCase() === 'active') {
      resolvedPlan = 'goplan';
    } else {
      resolvedPlan = normalizePlanKey(legacyPlan || profile.planStatus || 'basic');
    }

    return isPlanExpired(profile) && resolvedPlan !== 'basic' ? 'basic' : resolvedPlan;
  }

  function getPlanDefinition(planKey) {
    const normalized = normalizePlanKey(planKey);
    return PLAN_DEFINITIONS[normalized] || PLAN_DEFINITIONS.basic;
  }

  function getPlanLimits(planKey) {
    return { ...getPlanDefinition(planKey).limits };
  }

  function getPlanRank(planKey) {
    const normalized = normalizePlanKey(planKey);
    const rank = PLAN_ORDER.indexOf(normalized);
    return rank >= 0 ? rank : 0;
  }

  function getStorageModeForPlan(planKey) {
    return getPlanDefinition(planKey).storageMode || 'indexeddb';
  }

  function canUseFeature(featureKey, planKey) {
    const feature = FEATURE_DEFINITIONS[featureKey];
    if (!feature) return true;
    return feature.plans.includes(normalizePlanKey(planKey));
  }

  function getRequiredPlanForFeature(featureKey) {
    const feature = FEATURE_DEFINITIONS[featureKey];
    if (!feature || !Array.isArray(feature.plans) || feature.plans.length === 0) {
      return null;
    }
    return feature.plans[0];
  }

  function isPreviewFeature(featureKey) {
    return PREVIEW_FEATURES.has(featureKey);
  }

  function getUsageStatus(planKey, limitKey, usedValue) {
    const limits = getPlanLimits(planKey);
    const limit = Number(limits[limitKey]);
    const used = Number.isFinite(Number(usedValue)) ? Number(usedValue) : 0;

    if (!Number.isFinite(limit) || limit <= 0) {
      return {
        limit: null,
        used,
        remaining: 0,
        percent: 0,
        reached: false,
        nearLimit: false
      };
    }

    const percent = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
    return {
      limit,
      used,
      remaining: Math.max(limit - used, 0),
      percent,
      reached: used >= limit,
      nearLimit: used >= Math.ceil(limit * 0.8)
    };
  }

  function formatLimitValue(limit, unitLabel = '') {
    if (!Number.isFinite(Number(limit))) {
      return unitLabel ? `Unlimited ${unitLabel}` : 'Unlimited';
    }
    return unitLabel ? `${limit} ${unitLabel}` : String(limit);
  }

  function getNextPlanKey(planKey) {
    const next = PLAN_ORDER[getPlanRank(planKey) + 1];
    return next || null;
  }

  function getPlanDisplayLimits(planKey) {
    const limits = getPlanLimits(planKey);
    return {
      savedStops: formatLimitValue(limits.maxSavedStops, 'saved stops'),
      savedRoutesPerDay: formatLimitValue(limits.maxSavedRoutesPerDay, 'auto plans/day'),
      stopsPerRoute: formatLimitValue(limits.maxStopsPerRoute, 'stops/route'),
      storageMode: getStorageModeForPlan(planKey) === 'indexeddb' ? 'Device-only storage' : 'Cloud sync'
    };
  }

  global.RoutePlannerProduct = {
    PLAN_ORDER,
    PLAN_DEFINITIONS,
    FEATURE_DEFINITIONS,
    PREVIEW_FEATURES: Array.from(PREVIEW_FEATURES),
    normalizePlanKey,
    toPlanDate,
    getPlanExpiryDate,
    isPlanExpired,
    getCurrentPlan,
    getPlanDefinition,
    getPlanLimits,
    getPlanRank,
    getStorageModeForPlan,
    canUseFeature,
    getRequiredPlanForFeature,
    isPreviewFeature,
    getUsageStatus,
    formatLimitValue,
    getNextPlanKey,
    getPlanDisplayLimits
  };
})(window);
