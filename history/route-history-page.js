/**
 * history page: classic-script compatibility boundary.
 * Consumes the live app.html global lexical bindings listed below, plus browser
 * globals and the existing window services. No state is copied or initialized here.
 * Functions are installed before the main classic script. Listener binders are
 * called ONLY by its guarded initializeUIEventListeners(), at their original positions.
 * Loading this file registers no listeners and performs no data/API requests.
 * Shared helpers exported by the other page files remain ordinary global functions.
 */
/* global allCustomerEntries, backFromHistoryBrowserBtn, browseFullHistoryBtn, canStartNewRoutePlan, clearAllHistory, clearHistoryBtn, clearHistoryFromBrowserBtn, createNewRouteBtn, escapeHtml, filteredDriversCountEl, filteredLastActivityEl, filteredRoutesCountEl, filteredStopsCountEl, formatRegionalDate, formatRegionalTime, hasRolePermission, hasSuccessfulRouteData, historyBrowserFilters, historyBrowserListDiv, historyDateFilter, historyDriverFilter, historyFilterChipsDiv, historyListDiv, historyResultsMetaEl, historySearchInput, historyStatusFilter, isMobileViewport, isRouteHistoryLoading, isSameCalendarDay, loadMoreHistoryBtn, loadMoreRouteHistory, loadSelectedRouteBtn, loadSelectedRouteFromBrowserBtn, openDispatchPage, routeHistory, routeHistoryHasMore, routeHistoryLoadErrorMessage, routeHistoryLoadState, safeNumber, selectedHistoryIndex, showPage, showToast, toSafeDate, truncateText */

function getHistoryRouteMeta(route, index = 0) {
        const timestampDate = toSafeDate(route?.timestamp) || new Date(0);
        const plannedRouteEntries = Array.isArray(route?.plannedRoutes) ? route.plannedRoutes.filter(Boolean) : [];
        const routeGroups = Array.isArray(route?.routeGroups) ? route.routeGroups.filter(Boolean) : [];
        const successfulRoutes = safeNumber(
            route?.successfulRoutesCount,
            plannedRouteEntries.filter(hasSuccessfulRouteData).length
        );
        const attemptedRoutes = Math.max(
            routeGroups.length,
            plannedRouteEntries.length,
            (Array.isArray(route?.route1Waypoints) && route.route1Waypoints.length > 0 ? 1 : 0)
                + (Array.isArray(route?.route2Waypoints) && route.route2Waypoints.length > 0 ? 1 : 0),
            successfulRoutes,
            1
        );
        const totalStops = safeNumber(
            route?.totalStops,
            Array.isArray(route?.selectedCustomers)
                ? route.selectedCustomers.length
                : Array.isArray(route?.selectedStops)
                    ? route.selectedStops.length
                    : 0
        );
        const driverName = String(route?.vehicleDriver || route?.driverName || route?.driver || route?.user || 'Unknown').trim() || 'Unknown';
        const originLabel = String(route?.originName || route?.origin || 'Origin not saved');
        const startTime = route?.routeStartTime || plannedRouteEntries.map((entry) => entry?.routeStartTime).find(Boolean) || '';
        const etaValue = plannedRouteEntries
            .map((entry) => entry?.finalEtaAtHq || entry?.finalEtaAtLastStop || '')
            .find(Boolean) || '';
        const etaDate = toSafeDate(etaValue);
        const etaLabel = etaDate ? formatRegionalTime(etaDate) : String(etaValue || '').trim();
        const completedStopsValue = route?.completedStops;
        const pendingStopsValue = route?.pendingStops;
        const completedStops = Number.isFinite(Number(completedStopsValue)) ? Number(completedStopsValue) : null;
        const pendingStops = Number.isFinite(Number(pendingStopsValue))
            ? Number(pendingStopsValue)
            : (completedStops !== null ? Math.max(totalStops - completedStops, 0) : null);
        const notesText = String(route?.notes || route?.remark || route?.remarks || '').trim()
            || (route?.customOriginAddress ? `Custom origin: ${route.customOriginAddress}` : '')
            || (route?.originMode === 'current' ? 'Using current location as the starting point.' : '');

        let status = 'ready';
        if (successfulRoutes === 0) {
            status = 'needs-review';
        } else if (successfulRoutes < attemptedRoutes) {
            status = 'partial';
        }

        const savedRestrictionChecks = plannedRouteEntries.map((entry) => entry?.lorryValidation).filter(Boolean);
        const restrictionStatus = savedRestrictionChecks.length !== plannedRouteEntries.length || !savedRestrictionChecks.length
            ? 'not-checked'
            : savedRestrictionChecks.every((check) => check.status === 'SAFE')
                ? 'checked-at-save'
                : 'pending';
        if (restrictionStatus === 'pending' || restrictionStatus === 'not-checked') status = 'needs-review';
        const restrictionStatusLabel = restrictionStatus === 'checked-at-save'
            ? 'Restriction: checked when saved — recheck before navigation'
            : restrictionStatus === 'pending'
                ? 'Restriction: pending review'
                : 'Restriction: not checked';

        const statusLabel = status === 'ready'
            ? 'Ready'
            : status === 'partial'
                ? 'Partial'
                : 'Needs review';

        const routeLabel = route?.routeName || `Saved Route ${index + 1}`;
        const timestampLabel = `${formatRegionalDate(timestampDate)} at ${formatRegionalTime(timestampDate)}`;
        const notesLabel = notesText || 'No route remarks saved.';

        return {
            routeLabel,
            timestampDate,
            timestampMs: Number.isFinite(timestampDate.getTime()) ? timestampDate.getTime() : 0,
            timestampLabel,
            successfulRoutes,
            attemptedRoutes,
            totalStops,
            driverName,
            originLabel,
            startTimeLabel: startTime || 'Not saved',
            etaLabel: etaLabel || 'Not available',
            notesLabel,
            hasNotes: notesLabel !== 'No route remarks saved.',
            completedStops,
            pendingStops,
            completedStopsLabel: completedStops === null ? 'Not tracked' : `${completedStops} completed`,
            pendingStopsLabel: pendingStops === null ? 'Not tracked' : `${pendingStops} pending`,
            status,
            statusLabel,
            restrictionStatus,
            restrictionStatusLabel,
            searchableText: `${routeLabel} ${driverName} ${originLabel} ${notesLabel} ${restrictionStatusLabel}`.toLowerCase()
        };
    }

function getHistoryEntriesWithMeta() {
        return routeHistory.map((route, index) => ({
            route,
            index,
            meta: getHistoryRouteMeta(route, index)
        }));
    }

function getFilteredHistoryEntries() {
        const now = new Date();
        return getHistoryEntriesWithMeta().filter(({ meta }) => {
            if (historyBrowserFilters.search) {
                const keyword = historyBrowserFilters.search.trim().toLowerCase();
                if (keyword && !meta.searchableText.includes(keyword)) {
                    return false;
                }
            }

            if (historyBrowserFilters.driver !== 'all' && meta.driverName !== historyBrowserFilters.driver) {
                return false;
            }

            if (historyBrowserFilters.status !== 'all' && meta.status !== historyBrowserFilters.status) {
                return false;
            }

            if (historyBrowserFilters.dateRange === 'today' && !isSameCalendarDay(meta.timestampDate, now)) {
                return false;
            }

            if (historyBrowserFilters.dateRange === '7d' || historyBrowserFilters.dateRange === '30d') {
                const daysBack = historyBrowserFilters.dateRange === '7d' ? 7 : 30;
                const earliestMs = now.getTime() - (daysBack * 24 * 60 * 60 * 1000);
                if (meta.timestampMs < earliestMs) {
                    return false;
                }
            }

            return true;
        });
    }

function clearHistoryBrowserFilters() {
        historyBrowserFilters.search = '';
        historyBrowserFilters.dateRange = 'all';
        historyBrowserFilters.driver = 'all';
        historyBrowserFilters.status = 'all';

        if (historySearchInput) historySearchInput.value = '';
        if (historyDateFilter) historyDateFilter.value = 'all';
        if (historyDriverFilter) historyDriverFilter.value = 'all';
        if (historyStatusFilter) historyStatusFilter.value = 'all';

        renderHistoryBrowserList();
    }

function hasActiveHistoryFilters() {
        return Boolean(historyBrowserFilters.search.trim())
            || historyBrowserFilters.dateRange !== 'all'
            || historyBrowserFilters.driver !== 'all'
            || historyBrowserFilters.status !== 'all';
    }

function updateHistoryFilterOptions() {
        if (!historyDriverFilter) return;

        const uniqueDrivers = Array.from(new Set(
            getHistoryEntriesWithMeta()
                .map(({ meta }) => meta.driverName)
                .filter(Boolean)
        )).sort((left, right) => left.localeCompare(right));

        const currentValue = historyBrowserFilters.driver;
        historyDriverFilter.innerHTML = ['<option value="all">All planners</option>']
            .concat(uniqueDrivers.map((driver) => `<option value="${escapeHtml(driver)}">${escapeHtml(driver)}</option>`))
            .join('');

        historyDriverFilter.value = uniqueDrivers.includes(currentValue) ? currentValue : 'all';
        historyBrowserFilters.driver = historyDriverFilter.value;
    }

function renderHistoryFilterChips() {
        if (!historyFilterChipsDiv) return;

        const chips = [];
        if (historyBrowserFilters.search.trim()) {
            chips.push(`Search: ${historyBrowserFilters.search.trim()}`);
        }
        if (historyBrowserFilters.dateRange !== 'all') {
            chips.push(historyBrowserFilters.dateRange === 'today'
                ? 'Today'
                : historyBrowserFilters.dateRange === '7d'
                    ? 'Last 7 days'
                    : 'Last 30 days');
        }
        if (historyBrowserFilters.driver !== 'all') {
            chips.push(`Driver: ${historyBrowserFilters.driver}`);
        }
        if (historyBrowserFilters.status !== 'all') {
            chips.push(`Status: ${historyBrowserFilters.status}`);
        }

        historyFilterChipsDiv.innerHTML = chips.length
            ? chips.map((chip) => `<span class="history-filter-chip">${escapeHtml(chip)}</span>`).join('')
            : '';
    }

function renderHistoryBrowserSummary(filteredEntries) {
        if (!filteredRoutesCountEl || !filteredStopsCountEl || !filteredDriversCountEl || !filteredLastActivityEl || !historyResultsMetaEl) {
            return;
        }

        const totalStops = filteredEntries.reduce((sum, entry) => sum + entry.meta.totalStops, 0);
        const uniqueDrivers = new Set(filteredEntries.map((entry) => entry.meta.driverName).filter(Boolean));
        const latestEntry = filteredEntries[0];

        filteredRoutesCountEl.textContent = String(filteredEntries.length);
        filteredStopsCountEl.textContent = String(totalStops);
        filteredDriversCountEl.textContent = String(uniqueDrivers.size);
        filteredLastActivityEl.textContent = latestEntry ? formatRegionalDate(latestEntry.meta.timestampDate) : '--';

        historyResultsMetaEl.textContent = filteredEntries.length
            ? `Showing ${filteredEntries.length} loaded saved route ${filteredEntries.length === 1 ? 'plan' : 'plans'} after filters${routeHistoryHasMore ? '. Load more to fetch older history.' : '.'}`
            : 'No saved routes match the current filters.';

        renderHistoryFilterChips();
    }

function getTodayHistoryEntries() {
        const now = new Date();
        return getHistoryEntriesWithMeta().filter(({ meta }) => isSameCalendarDay(meta.timestampDate, now));
    }

function createHistoryStateMarkup(icon, title, message, actionMarkup = '') {
        return `
            <div class="empty-history history-empty-action-card">
                <div class="empty-history-icon">${icon}</div>
                <h4>${title}</h4>
                <p>${message}</p>
                ${actionMarkup}
            </div>
        `;
    }

function createHistoryLoadingMarkup() {
        return createHistoryStateMarkup('...', 'Loading Route History', 'Saved route history is being loaded from your current storage mode.');
    }

function updateHistorySelectionButtons() {
        const hasSelectedRoute = !isRouteHistoryLoading
            && selectedHistoryIndex >= 0
            && selectedHistoryIndex < routeHistory.length;
        const hasVisibleHistorySelection = hasSelectedRoute
            && getFilteredHistoryEntries().some((entry) => entry.index === selectedHistoryIndex);
        if (loadSelectedRouteBtn) loadSelectedRouteBtn.disabled = !hasSelectedRoute;
        if (loadSelectedRouteFromBrowserBtn) loadSelectedRouteFromBrowserBtn.disabled = !hasVisibleHistorySelection;
    }

function createHistoryItemElement(route, index, options = {}) {
        const compact = options.compact === true;
        const meta = getHistoryRouteMeta(route, index);
        const routeDiv = document.createElement('div');
        routeDiv.className = compact ? 'history-item compact' : 'history-item';
        routeDiv.dataset.index = String(index);
        if (route.id) routeDiv.dataset.id = route.id;
        if (index === selectedHistoryIndex) routeDiv.classList.add('selected');
        const routeCountLabel = meta.successfulRoutes === meta.attemptedRoutes
            ? `${meta.successfulRoutes} route ${meta.successfulRoutes === 1 ? 'segment' : 'segments'} planned`
            : `${meta.successfulRoutes} of ${meta.attemptedRoutes} route segments planned`;
        const notesMarkup = meta.hasNotes
            ? `<div class="history-item-note"><strong>Notes</strong><br>${escapeHtml(meta.notesLabel)}</div>`
            : '';
        const detailsMarkup = `
            <details class="history-item-extra">
                <summary>Plan details</summary>
                <div class="history-item-extra-grid">
                    <span><strong>Start time</strong>${escapeHtml(meta.startTimeLabel)}</span>
                    <span><strong>Final ETA</strong>${escapeHtml(meta.etaLabel)}</span>
                </div>
            </details>
        `;
        const deleteButtonMarkup = hasRolePermission('history.manage')
            ? `<button type="button" class="delete-route-btn" onclick="deleteHistoryRoute(${index})" title="Delete this saved route">Delete</button>`
            : '';

        routeDiv.innerHTML = `
            <div class="history-item-head history-row-cell">
                <div class="history-item-title-row">
                    <div class="history-item-title">${escapeHtml(meta.routeLabel)}</div>
                    <span class="history-status-pill history-status-${escapeHtml(meta.status)}">${escapeHtml(meta.statusLabel)}</span>
                </div>
                <div class="history-item-subtitle">${escapeHtml(meta.timestampLabel)} · ${escapeHtml(meta.driverName)}</div>
                <div class="history-item-badges">
                    <span class="history-badge">Origin: ${escapeHtml(truncateText(meta.originLabel, compact ? 18 : 32))}</span>
                </div>
            </div>
            <div class="history-item-metrics history-row-cell">
                <div class="history-item-metric">
                    <strong>${meta.totalStops} Stops</strong>
                    <span>${escapeHtml(routeCountLabel)}</span>
                    <span>${escapeHtml(meta.completedStopsLabel)} | ${escapeHtml(meta.pendingStopsLabel)}</span>
                </div>
            </div>
            <div class="history-item-restriction history-row-cell">
                <span class="history-badge history-restriction-${escapeHtml(meta.restrictionStatus)}">${escapeHtml(meta.restrictionStatusLabel)}</span>
            </div>
            <div class="history-item-actions history-row-cell">
                <button type="button" class="action-button-secondary history-select-btn" aria-label="Select ${escapeHtml(meta.routeLabel)}">Select</button>
                ${deleteButtonMarkup}
            </div>
            ${detailsMarkup}
            ${notesMarkup}
        `;

        const selectButton = routeDiv.querySelector('.history-select-btn');
        if (selectButton) {
            selectButton.addEventListener('click', (event) => {
                event.stopPropagation();
                selectedHistoryIndex = index;
                document.querySelectorAll('.history-item').forEach(item => item.classList.remove('selected'));
                document.querySelectorAll(`.history-item[data-index="${index}"]`).forEach(item => item.classList.add('selected'));
                updateHistorySelectionButtons();
            });
        }

        routeDiv.addEventListener('click', (e) => {
            if (e.target.closest('.delete-route-btn, .history-select-btn')) return;
            selectedHistoryIndex = index;
            document.querySelectorAll('.history-item').forEach(item => item.classList.remove('selected'));
            document.querySelectorAll(`.history-item[data-index="${index}"]`).forEach(item => item.classList.add('selected'));
            updateHistorySelectionButtons();
        });

        return routeDiv;
    }

function renderHistoryList() {
        historyListDiv.innerHTML = '';

        if (isRouteHistoryLoading && routeHistory.length === 0) {
            historyListDiv.innerHTML = createHistoryLoadingMarkup();
            if (browseFullHistoryBtn) browseFullHistoryBtn.style.display = 'inline-flex';
            return;
        }

        if (routeHistoryLoadState === 'error' && routeHistory.length === 0) {
            historyListDiv.innerHTML = createHistoryStateMarkup(
                '!',
                'Route History Unavailable',
                routeHistoryLoadErrorMessage || 'We could not load route history from the current storage mode. Please try again in a moment.',
                '<button type="button" class="action-button-primary" onclick="window.loadRouteHistory({ forceRefresh: true })">Retry History</button>'
            );
            if (browseFullHistoryBtn) browseFullHistoryBtn.style.display = 'inline-flex';
            return;
        }

        if (routeHistory.length === 0) {
            const emptyActionMarkup = allCustomerEntries.length === 0
                ? '<button type="button" class="action-button-primary" onclick="showPage(\'page-add-stop\')">Add Stop</button>'
                : '<button type="button" class="action-button-primary" onclick="showPage(\'page-select-stops\')">Create Route</button>';
            historyListDiv.innerHTML = createHistoryStateMarkup(
                'No Data',
                'No Route History Found',
                'Saved routes will appear here once your team starts planning and storing daily runs.',
                emptyActionMarkup
            );
            if (browseFullHistoryBtn) browseFullHistoryBtn.style.display = 'inline-flex';
            return;
        }

        const entries = routeHistory.map((route, index) => ({ route, index }));
        const previewLimit = isMobileViewport() ? 2 : 3;
        const visibleEntries = entries.slice(0, previewLimit);
        const listFragment = document.createDocumentFragment();

        visibleEntries.forEach(({ route, index }) => {
            listFragment.appendChild(createHistoryItemElement(route, index, { compact: true }));
        });

        historyListDiv.appendChild(listFragment);

        if (browseFullHistoryBtn) browseFullHistoryBtn.style.display = 'inline-flex';
    }

function renderHistoryBrowserList() {
        if (!historyBrowserListDiv) return;
        historyBrowserListDiv.innerHTML = '';
        updateHistoryFilterOptions();

        if (isRouteHistoryLoading && routeHistory.length === 0) {
            if (filteredRoutesCountEl) filteredRoutesCountEl.textContent = '--';
            if (filteredStopsCountEl) filteredStopsCountEl.textContent = '--';
            if (filteredDriversCountEl) filteredDriversCountEl.textContent = '--';
            if (filteredLastActivityEl) filteredLastActivityEl.textContent = '--';
            if (historyResultsMetaEl) historyResultsMetaEl.textContent = 'Loading saved route history...';
            renderHistoryFilterChips();
            historyBrowserListDiv.innerHTML = createHistoryLoadingMarkup();
            return;
        }

        if (routeHistoryLoadState === 'error' && routeHistory.length === 0) {
            if (filteredRoutesCountEl) filteredRoutesCountEl.textContent = '--';
            if (filteredStopsCountEl) filteredStopsCountEl.textContent = '--';
            if (filteredDriversCountEl) filteredDriversCountEl.textContent = '--';
            if (filteredLastActivityEl) filteredLastActivityEl.textContent = '--';
            if (historyResultsMetaEl) historyResultsMetaEl.textContent = 'Route history could not be refreshed.';
            renderHistoryFilterChips();
            historyBrowserListDiv.innerHTML = createHistoryStateMarkup(
                '!',
                'Route History Unavailable',
                routeHistoryLoadErrorMessage || 'We could not load route history from the current storage mode. Please try again in a moment.',
                '<button type="button" class="action-button-primary" onclick="window.loadRouteHistory({ forceRefresh: true })">Retry History</button>'
            );
            return;
        }

        if (routeHistory.length === 0) {
            renderHistoryBrowserSummary([]);
            if (historyResultsMetaEl) {
                historyResultsMetaEl.textContent = 'No saved routes yet. Create and save a route to build history.';
            }
            const emptyActionMarkup = allCustomerEntries.length === 0
                ? '<button type="button" class="action-button-primary" onclick="showPage(\'page-add-stop\')">Add Stop</button>'
                : '<button type="button" class="action-button-primary" onclick="showPage(\'page-select-stops\')">Create Route</button>';
            historyBrowserListDiv.innerHTML = createHistoryStateMarkup(
                'No Data',
                'No Route History Found',
                'Create and save routes from the dashboard to build a usable history.',
                emptyActionMarkup
            );
            return;
        }

        const filteredEntries = getFilteredHistoryEntries();
        renderHistoryBrowserSummary(filteredEntries);

        if (filteredEntries.length === 0) {
            historyBrowserListDiv.innerHTML = createHistoryStateMarkup(
                '0',
                'No Routes Match These Filters',
                'Try a wider date range, change the driver filter, or clear the current search.',
                hasActiveHistoryFilters()
                    ? '<button type="button" class="action-button-primary" onclick="clearHistoryBrowserFilters()">Clear Filters</button>'
                    : ''
            );
            updateHistorySelectionButtons();
            return;
        }

        const listFragment = document.createDocumentFragment();
        filteredEntries.forEach(({ route, index }) => {
            listFragment.appendChild(createHistoryItemElement(route, index));
        });
        historyBrowserListDiv.appendChild(listFragment);
        updateHistorySelectionButtons();
    }

function loadSelectedRoute() {
        const entry = routeHistory[selectedHistoryIndex];
        if (!entry?.id) {
            showToast('Select a saved route plan first.', 'error', 4200);
            return;
        }
        openDispatchPage(entry.id);
    }

function bindHistoryPrimaryControls() {
        // Event Listeners for History Dashboard
        if (loadSelectedRouteBtn) loadSelectedRouteBtn.addEventListener('click', loadSelectedRoute);
        if (createNewRouteBtn) {
            createNewRouteBtn.addEventListener('click', () => {
                console.log("Plan New Route button clicked!");
                if (!canStartNewRoutePlan()) return;
                showPage('page-select-stops');
            });
        }
        if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearAllHistory);
        if (browseFullHistoryBtn) {
            browseFullHistoryBtn.addEventListener('click', () => {
                renderHistoryBrowserList();
                showPage('page-history-browser');
            });
        }
        if (loadMoreHistoryBtn) {
            loadMoreHistoryBtn.addEventListener('click', () => {
                loadMoreRouteHistory();
            });
        }
        if (backFromHistoryBrowserBtn) backFromHistoryBrowserBtn.addEventListener('click', () => showPage('page-history-dashboard'));
        if (loadSelectedRouteFromBrowserBtn) loadSelectedRouteFromBrowserBtn.addEventListener('click', loadSelectedRoute);
        if (clearHistoryFromBrowserBtn) clearHistoryFromBrowserBtn.addEventListener('click', clearAllHistory);


    }

function bindHistoryFilterControls() {
        if (historySearchInput) {
            historySearchInput.addEventListener('input', () => {
                historyBrowserFilters.search = historySearchInput.value || '';
                renderHistoryBrowserList();
            });
        }
        if (historyDateFilter) {
            historyDateFilter.addEventListener('change', () => {
                historyBrowserFilters.dateRange = historyDateFilter.value || 'all';
                renderHistoryBrowserList();
            });
        }
        if (historyDriverFilter) {
            historyDriverFilter.addEventListener('change', () => {
                historyBrowserFilters.driver = historyDriverFilter.value || 'all';
                renderHistoryBrowserList();
            });
        }
        if (historyStatusFilter) {
            historyStatusFilter.addEventListener('change', () => {
                historyBrowserFilters.status = historyStatusFilter.value || 'all';
                renderHistoryBrowserList();
            });
        }


    }
