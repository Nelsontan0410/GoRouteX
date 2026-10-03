/**
 * dashboard page: classic-script compatibility boundary.
 * Consumes the live app.html global lexical bindings listed below, plus browser
 * globals and the existing window services. No state is copied or initialized here.
 * Functions are installed before the main classic script. Listener binders are
 * called ONLY by its guarded initializeUIEventListeners(), at their original positions.
 * Loading this file registers no listeners and performs no data/API requests.
 * Shared helpers exported by the other page files remain ordinary global functions.
 */
/* global AppState, allCustomerEntries, avgStopsPerRouteEl, canStartNewRoutePlan, currentRouteConfirmationState, dashboardAddCustomerBtn, dashboardAssignedRoutesEl, dashboardAssignedRoutesNoteEl, dashboardCompletedStopsEl, dashboardCompletedStopsNoteEl, dashboardCreateRouteBtn, dashboardDataPromise, dashboardEmptyStateDiv, dashboardLatestRouteEl, dashboardLatestRouteNoteEl, dashboardLiveStatusEl, dashboardLiveStatusNoteEl, dashboardOpenHistoryBtn, dashboardPendingStopsEl, dashboardPendingStopsNoteEl, dashboardRecentActivityDiv, dashboardTrackingSummary, dashboardTrackingSummaryState, dashboardUpgradeBtn, dashboardViewTodayPlanBtn, escapeHtml, formatRegionalDate, getCurrentActivePageId, getHistoryEntriesWithMeta, getHistoryRouteMeta, getRoutePlanUsageCount, getTodayHistoryEntries, hasSuccessfulRouteData, isRouteHistoryLoading, loadHistoryOnce, loadSelectedRoute, openAccountAccessPage, openDispatchPage, openFounderLedPricing, renderHistoryBrowserList, renderHistoryList, renderPricingAccessUi, routeHistory, routeHistoryLoadState, safeNumber, selectedHistoryIndex, setStopWorkspaceMode, showPage, showToast, toSafeDate, todayRoutesCountEl, totalRoutesCountEl, totalStopsCountEl, updateHistoryFilterOptions, updateHistorySelectionButtons, viewPlanAccessBtn */

function renderDashboardEmptyState(todayEntries) {
        if (!dashboardEmptyStateDiv) return;

        let title = 'Your planning workspace is ready.';
        let description = 'The dashboard surfaces route history, quick actions, and operational visibility as you use the app.';
        let bullets = [
            'Add saved stops so route planning is ready for the day.',
            'Create a route plan when today\'s visits, deliveries, or errands are confirmed.',
            'Use live tracking after route loading when you need operational visibility.'
        ];

        if (allCustomerEntries.length === 0) {
            title = 'Add your first saved stop.';
            description = 'You do not have any saved stops yet, so route planning cannot begin until at least one location is ready.';
            bullets = [
                'Open Manage Stops to add your first stop or import a list from CSV.',
                'Once stops are saved, create a route and assign them into route groups.',
                'Saved plans will automatically build your route history dashboard.'
            ];
        } else if (routeHistory.length === 0) {
            title = 'Your stops are ready for the first route plan.';
            description = 'You already have stops saved. The next step is to create a route so the day has a clear plan and reusable route history.';
            bullets = [
                'Choose the stops for the day from the selector.',
                'Review and assign stops to route groups before optimization.',
                'Save the route so it becomes available from route history.'
            ];
        } else if (todayEntries.length === 0) {
            title = 'No route saved for today yet.';
            description = 'Previous route history is available, but there is no saved plan for today. Start a new route or reload a recent plan.';
            bullets = [
                'Create today\'s route from the dashboard quick actions.',
                'Browse route history to reload a recent route plan.',
                'Open live tracking after inserting a planned route.'
            ];
        }

        dashboardEmptyStateDiv.innerHTML = `
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
            <ul class="dashboard-empty-list">
                ${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}
            </ul>
        `;
    }

function renderDashboardRecentActivity() {
        if (!dashboardRecentActivityDiv) return;

        const recentEntries = getHistoryEntriesWithMeta().slice(0, 3);
        if (recentEntries.length === 0) {
            dashboardRecentActivityDiv.innerHTML = '<div class="activity-empty">No saved route activity yet. Your latest route plans will appear here.</div>';
            return;
        }

        dashboardRecentActivityDiv.innerHTML = recentEntries.map(({ meta }) => `
            <article class="activity-item">
                <div class="activity-item-title">${escapeHtml(meta.routeLabel)}</div>
                <div class="activity-item-meta">${escapeHtml(meta.timestampLabel)}</div>
                <div class="activity-item-meta">${escapeHtml(meta.driverName)} · ${meta.successfulRoutes} route${meta.successfulRoutes === 1 ? '' : 's'} · ${meta.totalStops} stops</div>
            </article>
        `).join('');
    }

function getDashboardLiveStatus(todayRouteCount) {
        if (dashboardTrackingSummaryState === 'loading') {
            return {
                value: 'Loading',
                note: 'Refreshing the latest GPS tracking summary.'
            };
        }

        if (dashboardTrackingSummary && dashboardTrackingSummary.isActive) {
            const lastUpdateDate = toSafeDate(dashboardTrackingSummary.lastUpdate);
            const isStale = lastUpdateDate ? (Date.now() - lastUpdateDate.getTime()) > (30 * 60 * 1000) : false;
            return isStale
                ? {
                    value: 'Needs update',
                    note: 'Tracking is active but no GPS update has been saved for more than 30 minutes.'
                }
                : {
                    value: 'In progress',
                    note: 'Live route tracking is active for today.'
                };
        }

        if (dashboardTrackingSummary && safeNumber(dashboardTrackingSummary.totalStops, 0) > 0) {
            const completed = safeNumber(dashboardTrackingSummary.completedStops, 0);
            const total = safeNumber(dashboardTrackingSummary.totalStops, 0);
            return completed >= total
                ? {
                    value: 'Completed',
                    note: 'All tracked stops for today have been marked complete.'
                }
                : {
                    value: 'Paused',
                    note: 'A route was loaded into tracking but is not currently active.'
                };
        }

        if (todayRouteCount > 0) {
            return {
                value: 'Planned',
                note: 'Today has saved routes ready to load into GPS tracking.'
            };
        }

        return {
            value: 'No route',
            note: 'Create or reload a route plan to start today\'s work.'
        };
    }

async function loadDashboardOperationalSummary() {
        if (!window.FirebaseApp?.gps?.loadSummary) {
            dashboardTrackingSummary = null;
            dashboardTrackingSummaryState = 'unavailable';
            renderDashboardOperationalSummary();
            return;
        }

        dashboardTrackingSummaryState = 'loading';
        renderDashboardOperationalSummary();

        try {
            const result = await window.FirebaseApp.gps.loadSummary();
            if (result.success) {
                dashboardTrackingSummary = result.summary || null;
                dashboardTrackingSummaryState = 'ready';
            } else {
                dashboardTrackingSummary = null;
                dashboardTrackingSummaryState = 'error';
            }
        } catch (error) {
            console.warn('Dashboard summary refresh failed:', error);
            dashboardTrackingSummary = null;
            dashboardTrackingSummaryState = 'error';
        }

        renderDashboardOperationalSummary();
    }

function renderDashboardOperationalSummary() {
        const todayEntries = getTodayHistoryEntries();
        const savedPlansCount = routeHistory.length;
        const todayRouteCount = todayEntries.reduce((sum, entry) => sum + getRoutePlanUsageCount(entry.route), 0);
        const todayStopsCount = todayEntries.reduce((sum, entry) => sum + entry.meta.totalStops, 0);
        const avgStops = savedPlansCount > 0
            ? Math.round((getHistoryEntriesWithMeta().reduce((sum, entry) => sum + entry.meta.totalStops, 0) / savedPlansCount) * 10) / 10
            : 0;
        const latestEntry = routeHistory.length > 0 ? getHistoryRouteMeta(routeHistory[0], 0) : null;
        const trackedCompletedStops = dashboardTrackingSummary ? safeNumber(dashboardTrackingSummary.completedStops, 0) : null;
        const trackedTotalStops = dashboardTrackingSummary ? safeNumber(dashboardTrackingSummary.totalStops, 0) : null;
        const pendingStops = trackedCompletedStops !== null && trackedTotalStops !== null
            ? Math.max(trackedTotalStops - trackedCompletedStops, 0)
            : null;
        const liveStatus = getDashboardLiveStatus(todayRouteCount);

        totalRoutesCountEl.textContent = String(savedPlansCount);
        todayRoutesCountEl.textContent = String(todayRouteCount);
        totalStopsCountEl.textContent = String(todayStopsCount);
        avgStopsPerRouteEl.textContent = savedPlansCount > 0 ? String(avgStops) : '--';

        if (dashboardAssignedRoutesEl) dashboardAssignedRoutesEl.textContent = String(todayRouteCount);
        if (dashboardAssignedRoutesNoteEl) {
            dashboardAssignedRoutesNoteEl.textContent = todayRouteCount > 0
                ? `${todayEntries.length} saved plan${todayEntries.length === 1 ? '' : 's'} created for today`
                : 'No saved route plans for today yet';
        }

        if (dashboardCompletedStopsEl) dashboardCompletedStopsEl.textContent = trackedCompletedStops === null ? '--' : String(trackedCompletedStops);
        if (dashboardCompletedStopsNoteEl) {
            dashboardCompletedStopsNoteEl.textContent = trackedCompletedStops === null
                ? 'Load a route into GPS tracking to see live completed stops.'
                : 'Based on today\'s GPS tracking summary';
        }

        if (dashboardPendingStopsEl) dashboardPendingStopsEl.textContent = pendingStops === null ? '--' : String(pendingStops);
        if (dashboardPendingStopsNoteEl) {
            dashboardPendingStopsNoteEl.textContent = pendingStops === null
                ? 'Pending count will appear when tracking summary is available.'
                : 'Remaining stops from today\'s tracked route';
        }

        if (dashboardLiveStatusEl) dashboardLiveStatusEl.textContent = liveStatus.value;
        if (dashboardLiveStatusNoteEl) dashboardLiveStatusNoteEl.textContent = liveStatus.note;

        if (dashboardLatestRouteEl) {
            dashboardLatestRouteEl.textContent = latestEntry ? formatRegionalDate(latestEntry.timestampDate) : '--';
        }
        if (dashboardLatestRouteNoteEl) {
            dashboardLatestRouteNoteEl.textContent = latestEntry
                ? `${latestEntry.driverName} · ${latestEntry.successfulRoutes} route${latestEntry.successfulRoutes === 1 ? '' : 's'} planned`
                : 'Recent saved route plans will appear here';
        }

        renderDashboardEmptyState(todayEntries);
    }

function handleDashboardViewTodayPlan() {
        const hasLiveRouteLoaded = AppState.plannedRoutes.some((route) => hasSuccessfulRouteData(route));
        if (hasLiveRouteLoaded && currentRouteConfirmationState.saved && currentRouteConfirmationState.historyId) {
            openDispatchPage(currentRouteConfirmationState.historyId);
            return;
        }

        const todayEntry = getTodayHistoryEntries()[0];
        if (todayEntry) {
            selectedHistoryIndex = todayEntry.index;
            updateHistorySelectionButtons();
            loadSelectedRoute();
            return;
        }

        showToast('No saved route plan for today yet. Start by selecting stops.', 'info', 4200);
        if (!canStartNewRoutePlan()) return;
        showPage('page-select-stops');
    }

function loadDashboardData(options = {}) {
        if (getCurrentActivePageId() !== 'page-history-dashboard') {
            return Promise.resolve();
        }
        if (options.forceRefresh) {
            dashboardDataPromise = null;
        }
        if (!dashboardDataPromise) {
            dashboardDataPromise = Promise.all([
                loadHistoryOnce(options),
                loadDashboardOperationalSummary()
            ]).catch((error) => {
                dashboardDataPromise = null;
                throw error;
            });
        }
        return dashboardDataPromise;
    }

function renderHistoryDashboard() {
        updateHistoryStats();
        renderHistoryList();
        renderHistoryBrowserList();
        updateHistorySelectionButtons();
        renderPricingAccessUi();
    }

function updateHistoryStats() {
        if (isRouteHistoryLoading && routeHistory.length === 0) {
            setHistoryStatsPlaceholderValues();
            updateHistoryFilterOptions();
            renderDashboardRecentActivity();
            renderDashboardEmptyState([]);
            return;
        }

        if (routeHistoryLoadState === 'error' && routeHistory.length === 0) {
            setHistoryStatsPlaceholderValues();
            updateHistoryFilterOptions();
            renderDashboardRecentActivity();
            renderDashboardEmptyState([]);
            return;
        }

        updateHistoryFilterOptions();
        renderDashboardOperationalSummary();
        renderDashboardRecentActivity();
    }

function setHistoryStatsPlaceholderValues() {
        totalRoutesCountEl.textContent = '--';
        todayRoutesCountEl.textContent = '--';
        totalStopsCountEl.textContent = '--';
        avgStopsPerRouteEl.textContent = '--';
        if (dashboardAssignedRoutesEl) dashboardAssignedRoutesEl.textContent = '--';
        if (dashboardCompletedStopsEl) dashboardCompletedStopsEl.textContent = '--';
        if (dashboardPendingStopsEl) dashboardPendingStopsEl.textContent = '--';
        if (dashboardLiveStatusEl) dashboardLiveStatusEl.textContent = '--';
        if (dashboardLatestRouteEl) dashboardLatestRouteEl.textContent = '--';
    }

function bindDashboardControls() {
        if (dashboardAddCustomerBtn) {
            dashboardAddCustomerBtn.addEventListener('click', async () => {
                await showPage('page-add-stop');
                setStopWorkspaceMode('add');
            });
        }
        if (dashboardCreateRouteBtn) {
            dashboardCreateRouteBtn.addEventListener('click', () => {
                if (!canStartNewRoutePlan()) return;
                showPage('page-select-stops');
            });
        }
        if (dashboardOpenHistoryBtn) {
            dashboardOpenHistoryBtn.addEventListener('click', () => {
                renderHistoryBrowserList();
                showPage('page-history-browser');
            });
        }
        if (dashboardViewTodayPlanBtn) {
            dashboardViewTodayPlanBtn.addEventListener('click', handleDashboardViewTodayPlan);
        }
        if (viewPlanAccessBtn) {
            viewPlanAccessBtn.addEventListener('click', openAccountAccessPage);
        }
        if (dashboardUpgradeBtn) {
            dashboardUpgradeBtn.addEventListener('click', openFounderLedPricing);
        }

    }
