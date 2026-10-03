      const FOUNDER_LED_PRICING_TARGET = 'index.html#pricing';

      function getFounderLedPricingTarget() {
        return FOUNDER_LED_PRICING_TARGET;
      }

      function openFounderLedPricing() {
        openAccountAccessPage();
      }

      function getAccessToolkit() {
        return window.GoRouteXAccess || null;
      }

      function getCurrentAccessContext(profile = window.currentUserProfile || {}) {
        const toolkit = getAccessToolkit();
        if (!toolkit?.resolveUserContext) {
          return {
            planKey: 'trial',
            roleKey: 'admin',
            plan: {
              key: 'trial',
              name: 'Free Trial',
              shortName: 'Trial',
              limits: {}
            },
            role: {
              key: 'admin',
              name: 'Admin',
              permissions: []
            },
            planStatus: String(profile?.planStatus || 'trial').toLowerCase()
          };
        }
        return toolkit.resolveUserContext(profile || {});
      }

      function openAccountAccessPage() {
        if (typeof showPage === 'function') {
          showPage('page-account-access');
          return;
        }
        window.location.hash = '#page-account-access';
      }

      function detectRegionalLocale() {
        const profileLocale = String(window.currentUserProfile?.locale || '').toLowerCase();
        if (profileLocale.startsWith('en-my') || profileLocale === 'my') return 'en-MY';
        if (profileLocale.startsWith('en-sg') || profileLocale === 'sg') return 'en-SG';

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        if (timezone.includes('Kuala_Lumpur')) return 'en-MY';
        if (timezone.includes('Singapore')) return 'en-SG';

        const navigatorLocale = String(navigator.language || '').toLowerCase();
        if (navigatorLocale.includes('my')) return 'en-MY';
        return 'en-SG';
      }

      function toSafeDate(dateLike) {
        if (!dateLike) return null;
        const dateObj = dateLike.toDate ? dateLike.toDate() : new Date(dateLike);
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
        return dateObj;
      }

      function formatRegionalDate(dateLike, options = {}) {
        const dateObj = toSafeDate(dateLike);
        if (!dateObj) return '';
        return dateObj.toLocaleDateString(detectRegionalLocale(), {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          ...options
        });
      }

      function getDateKey(dateLike = new Date()) {
        const dateObj = dateLike instanceof Date ? dateLike : new Date(dateLike);
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      function getTomorrowDateKey() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return getDateKey(tomorrow);
      }

      function getDateFromKey(dateKey) {
        if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return null;
        const dateObj = new Date(`${dateKey}T00:00:00`);
        return Number.isNaN(dateObj.getTime()) ? null : dateObj;
      }

      function formatRegionalTime(dateLike, options = {}) {
        const dateObj = toSafeDate(dateLike);
        if (!dateObj) return '';
        return dateObj.toLocaleTimeString(detectRegionalLocale(), {
          hour: '2-digit',
          minute: '2-digit',
          ...options
        });
      }

      function normalizeRegionalPhoneNumber(phoneNumber) {
        const rawValue = String(phoneNumber || '').trim();
        if (!rawValue) {
          return { success: false, reason: 'missing' };
        }

        let cleanValue = rawValue.replace(/[\s\-()]/g, '');
        if (cleanValue.startsWith('00')) {
          cleanValue = `+${cleanValue.slice(2)}`;
        }

        if (/^\+65\d{8}$/.test(cleanValue)) {
          return { success: true, phoneE164: cleanValue, country: 'SG' };
        }
        if (/^65\d{8}$/.test(cleanValue)) {
          return { success: true, phoneE164: `+${cleanValue}`, country: 'SG' };
        }
        if (/^[89]\d{7}$/.test(cleanValue)) {
          return { success: true, phoneE164: `+65${cleanValue}`, country: 'SG' };
        }

        if (/^\+60\d{8,10}$/.test(cleanValue)) {
          return { success: true, phoneE164: cleanValue, country: 'MY' };
        }
        if (/^60\d{8,10}$/.test(cleanValue)) {
          return { success: true, phoneE164: `+${cleanValue}`, country: 'MY' };
        }
        if (/^01\d{8,9}$/.test(cleanValue)) {
          return { success: true, phoneE164: `+60${cleanValue.slice(1)}`, country: 'MY' };
        }
        if (/^1\d{8,9}$/.test(cleanValue)) {
          return { success: true, phoneE164: `+60${cleanValue}`, country: 'MY' };
        }

        if (/^\+\d{10,15}$/.test(cleanValue)) {
          return { success: true, phoneE164: cleanValue, country: 'INTL' };
        }

        return { success: false, reason: 'unsupported', original: rawValue };
      }

      function getRegionalPhoneOrWarn(customerName, phoneNumber, options = {}) {
        const normalized = normalizeRegionalPhoneNumber(phoneNumber);
        if (normalized.success) return normalized;

        if (options.messageTarget) {
          options.messageTarget.textContent = options.missingMessage
            ? options.missingMessage
            : `Phone number format for ${truncateText(customerName, 15)} is not ready for Singapore or Malaysia use.`;
        }
        return null;
      }

      function getDispatchCommsSupportLine() {
        return 'please reply to this WhatsApp message or contact your admin team';
      }

      function formatPlanDate(dateLike) {
        return formatRegionalDate(dateLike);
      }

      function updateProfessionalPlanButton(profile) {
        const btn = document.getElementById('professionalPlanBtn');
        if (!btn) return;
        const context = getCurrentAccessContext(profile);
        const productPlanKey = window.RoutePlannerProduct?.getCurrentPlan
          ? window.RoutePlannerProduct.getCurrentPlan(profile || {})
          : 'basic';
        const productPlan = window.RoutePlannerProduct?.getPlanDefinition
          ? window.RoutePlannerProduct.getPlanDefinition(productPlanKey)
          : null;
        const status = context.planStatus;
        const expiryValue = window.RoutePlannerProduct?.getPlanExpiryDate
          ? window.RoutePlannerProduct.getPlanExpiryDate(profile || {})
          : (profile && profile.trialEndsAt ? profile.trialEndsAt : null);
        const expiryText = formatPlanDate(expiryValue);
        const roleName = context.role?.name || 'Admin';
        const productPlanName = productPlan?.shortName || productPlan?.name || 'Basic';
        if (window.RoutePlannerProduct?.isPlanExpired?.(profile || {})) {
          btn.textContent = `${productPlanName} renewal needed`;
          btn.title = 'Open plan and renewal details.';
          return;
        }

        if (status === 'active') {
          btn.textContent = expiryText
            ? `${productPlanName} · ${expiryText}`
            : `${productPlanName} · ${roleName}`;
          btn.title = 'Open plan and access details.';
          return;
        }

        if (status === 'expired') {
          btn.textContent = `${productPlanName} renewal needed`;
        } else {
          btn.textContent = expiryText
            ? `${productPlanName} · ${expiryText}`
            : `${productPlanName} access`;
        }
        btn.title = 'Open plan and access details.';
      }

      function handleFounderLedPlanAction() {
        openAccountAccessPage();
      }

      window.getFounderLedPricingTarget = getFounderLedPricingTarget;
      window.openFounderLedPricing = openFounderLedPricing;
      window.getAccessToolkit = getAccessToolkit;
      window.getCurrentAccessContext = getCurrentAccessContext;
      window.openAccountAccessPage = openAccountAccessPage;
      window.formatRegionalDate = formatRegionalDate;
      window.formatRegionalTime = formatRegionalTime;
      window.normalizeRegionalPhoneNumber = normalizeRegionalPhoneNumber;

      document.getElementById('professionalPlanBtn')?.addEventListener('click', handleFounderLedPlanAction);
      window.logout = function logout() {
        if (window.AppShell && typeof window.AppShell.performLogout === 'function') {
          return window.AppShell.performLogout();
        }
        return Promise.resolve();
      };

      // Update user info display (exposed to window for sync manager)
      window.updateUserInfoDisplay = function() {
        window.updateSidebarAccountDisplay?.();
        const userInfoDisplay = document.getElementById('userInfoDisplay');
        const syncStatusDisplay = document.getElementById('syncStatusDisplay');

        if (!userInfoDisplay) return;

        const currentUser = window.currentAuthUser;
        if (currentUser) {
          const displayName = currentUser.displayName || currentUser.email || 'User';
          userInfoDisplay.textContent = `Logged in as ${displayName}`;
          userInfoDisplay.style.color = '#1e293b';
        } else {
          userInfoDisplay.textContent = 'Not logged in';
          userInfoDisplay.style.color = '#b91c1c';
        }

        if (syncStatusDisplay) {
          const productPlan = typeof getCurrentProductPlan === 'function'
            ? getCurrentProductPlan()
            : (window.RoutePlannerProduct?.getCurrentPlan
              ? window.RoutePlannerProduct.getCurrentPlan(window.currentUserProfile || {})
              : 'basic');
          const storageMode = window.RoutePlannerProduct?.getStorageModeForPlan
            ? window.RoutePlannerProduct.getStorageModeForPlan(productPlan)
            : 'indexeddb';

          if (storageMode === 'indexeddb') {
            syncStatusDisplay.textContent = 'Device-only storage';
            syncStatusDisplay.style.color = '#b45309';
          } else if (window.syncManager) {
            const status = window.syncManager.getSyncStatus();
            if (status.status === 'cloud') {
              syncStatusDisplay.textContent = 'Cloud sync';
              syncStatusDisplay.style.color = '#2563eb';
            } else if (status.status === 'waiting') {
              syncStatusDisplay.textContent = 'Login required';
              syncStatusDisplay.style.color = '#b45309';
            } else {
              syncStatusDisplay.textContent = 'Connecting...';
              syncStatusDisplay.style.color = '#64748b';
            }
          }
        }
      };

      setTimeout(window.updateUserInfoDisplay, 1000);
