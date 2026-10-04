/**
 * planning page: classic-script compatibility boundary.
 * Consumes the live app.html global lexical bindings listed below, plus browser
 * globals and the existing window services. No state is copied or initialized here.
 * Functions are installed before the main classic script. Listener binders are
 * called ONLY by its guarded initializeUIEventListeners(), at their original positions.
 * Loading this file registers no listeners and performs no data/API requests.
 * Shared helpers exported by the other page files remain ordinary global functions.
 */
/* global DEFAULT_ROUTE_START_TIME, DIRECTION_ORDER_LABELS, addVehicleDriverBtn, addVehicleDriverFromInput, applySuggestedRoutes, applySuggestionBtn, backToDashboardBtn, backToSelectStopsBtnPg2, clearSelectedStopsBtn, clearSelectedStopsFast, closeVehicleDriverEditor, closeVehicleDriverEditorBtn, confirmRouteBtn, confirmRouteCancelBtn, confirmRouteConfirmBtn, confirmRouteModal, currentRouteConfirmationState, customEndAddress, customEndInput, customEndLabel, customOriginAddress, customOriginInput, customOriginLabel, directionOrder, directionOrderEditor, directionOrderSettings, editVehicleDriverBtn, escapeHtml, getCurrentProductPlan, getDateKey, getPreferredPlanningTime, getSelectedPlanningDate, getSelectedPlanningTime, getTomorrowDateKey, goToManualAssignBtn, handleConfirmRouteButtonClick, handleConfirmRouteModalConfirm, handleGoToManualAssignPage, handleProceedToOptimizeRoutes, handleRouteArrangementModeChange, handleRouteEndModeChange, handleRouteEndRequirementChange, handleRouteOriginModeChange, handleRouteStartTimeChange, handleVehicleDriverChange, hasRolePermission, hideConfirmRouteModal, invalidateDirectionArrangement, isMobile, loadVehicleDriverSettings, normalizePlanningTimeKey, openVehicleDriverEditor, planningDate, planningDateInput, planningDateStatus, populateVehicleDriverSelect, proceedToOptimizeBtn, resetPlanningDateToTodayPreferredTime, resolveCustomEndAddress, resolveCustomOriginAddress, retrieveAllStopsFromRoutes, retrieveStopsBtn, routeArrangementIsDirectionReturn, routeArrangementMode, routeArrangementModeInputs, routeArrangementStatus, routeEndMode, routeEndModeInputs, routeEndRequired, routeEndRequirementInputs, routeOriginMode, routeOriginModeInputs, routePanel, routePanelTouchStartY, routeSettingsBody, routeSettingsSummary, routeStartTime, routeStartTimeInput, routeVehicleDriverSelect, savePreferredPlanningTime, scheduleCustomerSearchRender, searchCustomerInput, selectedCustomers, selectionAddCustomerBtn, setCustomEndStatus, setStopWorkspaceMode, showPage, startLocationSummary, toggleRoutePanelBtn, toggleRouteSettingsBtn, vehicleDriverModal, vehicleDriverNewInput */

function setPlanningDateStatus(message, isWarning = false) {
        if (!planningDateStatus) return;
        planningDateStatus.textContent = message || '';
        planningDateStatus.classList.toggle('warning', !!isWarning);
    }

function updatePlanningDateAccess() {
        if (!planningDateInput) return;
        if (!planningDateInput.value) {
            resetPlanningDateToTodayPreferredTime();
        }
        const todayKey = getDateKey(new Date());
        const tomorrowKey = getTomorrowDateKey();
        const planKey = getCurrentProductPlan();
        let currentDate = getSelectedPlanningDate() || todayKey;
        let currentTime = normalizePlanningTimeKey(getSelectedPlanningTime(), getPreferredPlanningTime());

        planningDateInput.disabled = false;
        planningDateInput.removeAttribute('min');
        planningDateInput.removeAttribute('max');

        if (planKey === 'basic') {
            currentDate = todayKey;
            planningDateInput.disabled = true;
            planningDateInput.min = `${todayKey}T00:00`;
            planningDateInput.max = `${todayKey}T23:59`;
            setPlanningDateStatus('Basic is locked to today.', false);
        } else if (planKey === 'goplan') {
            planningDateInput.min = `${todayKey}T00:00`;
            planningDateInput.max = `${tomorrowKey}T23:59`;
            if (currentDate < todayKey) currentDate = todayKey;
            if (currentDate > tomorrowKey) currentDate = tomorrowKey;
            setPlanningDateStatus('GoPlan allows today or tomorrow.', false);
        } else {
            if (currentDate < todayKey) currentDate = todayKey;
            setPlanningDateStatus('ProPlan allows full date selection.', false);
        }

        planningDate = currentDate;
        routeStartTime = currentTime;
        planningDateInput.value = `${currentDate}T${currentTime}`;
        updateRouteSettingsSummary();
    }

function handlePlanningDateChange() {
        if (!planningDateInput) return;
        const todayKey = getDateKey(new Date());
        const tomorrowKey = getTomorrowDateKey();
        const planKey = getCurrentProductPlan();
        const fallbackDateTime = `${todayKey}T${DEFAULT_ROUTE_START_TIME}`;
        let nextDateTime = planningDateInput.value || fallbackDateTime;
        let [nextDate, nextTime] = nextDateTime.split('T');
        nextDate = nextDate || todayKey;
        nextTime = normalizePlanningTimeKey(nextTime, DEFAULT_ROUTE_START_TIME);

        if (planKey === 'basic') {
            nextDate = todayKey;
            setPlanningDateStatus('Basic is locked to today.', false);
        } else if (planKey === 'goplan' && (nextDate < todayKey || nextDate > tomorrowKey)) {
            nextDate = nextDate < todayKey ? todayKey : tomorrowKey;
            setPlanningDateStatus('GoPlan allows today or tomorrow only.', true);
        } else if (nextDate < todayKey) {
            setPlanningDateStatus('Selected date is in the past. Choose today or a future date before saving.', true);
        } else {
            setPlanningDateStatus(planKey === 'goplan' ? 'GoPlan allows today or tomorrow.' : 'ProPlan allows full date selection.', false);
        }

        planningDate = nextDate;
        routeStartTime = savePreferredPlanningTime(nextTime);
        planningDateInput.value = `${nextDate}T${nextTime}`;
        updateRouteSettingsSummary();
    }

function updateManualAssignAccessButton() {
        if (goToManualAssignBtn) {
            const selectedCount = selectedCustomers.size;
            const canManageRoutes = hasRolePermission('routes.manage');
            goToManualAssignBtn.disabled = selectedCount === 0 || !canManageRoutes;
            if (!canManageRoutes) {
                goToManualAssignBtn.textContent = 'Route planning is view only for this role';
                goToManualAssignBtn.title = 'Your role can view route execution but cannot create new plans.';
            } else {
                goToManualAssignBtn.textContent = selectedCount > 0
                    ? `Review & Assign ${selectedCount} Selected ${selectedCount === 1 ? 'Stop' : 'Stops'}`
                    : 'Review & Assign Selected Stops';
                goToManualAssignBtn.title = '';
            }
        }
        if (clearSelectedStopsBtn) {
            clearSelectedStopsBtn.disabled = selectedCustomers.size === 0;
        }
    }

function updateRouteSettingsSummary() {
        if (!routeSettingsSummary) return;
        const start = startLocationSummary?.textContent || (routeOriginMode === 'custom'
            ? (customOriginLabel || customOriginAddress || 'Enter Address')
            : 'Current Location');
        const end = routeEndMode === 'custom' ? (customEndLabel || customEndAddress || 'Enter Address') : 'Same as start';
        const datetime = planningDateInput?.value || '-';
        routeSettingsSummary.innerText = `Start: ${start} | End: ${end} | ${datetime}`;
    }

function renderDirectionOrderEditor() {
        if (!directionOrderEditor) return;
        directionOrderEditor.innerHTML = directionOrder.map((direction, index) => `
            <div class="direction-order-row">
                <strong>${escapeHtml(DIRECTION_ORDER_LABELS[direction] || direction)}</strong>
                <button type="button" data-direction-index="${index}" data-direction-move="up" aria-label="Move ${escapeHtml(direction)} earlier"${index === 0 ? ' disabled' : ''}>↑</button>
                <button type="button" data-direction-index="${index}" data-direction-move="down" aria-label="Move ${escapeHtml(direction)} later"${index === directionOrder.length - 1 ? ' disabled' : ''}>↓</button>
            </div>`).join('');
        directionOrderEditor.querySelectorAll('button[data-direction-move]').forEach((button) => {
            button.addEventListener('click', () => {
                const index = Number(button.dataset.directionIndex);
                const target = button.dataset.directionMove === 'up' ? index - 1 : index + 1;
                if (target < 0 || target >= directionOrder.length) return;
                [directionOrder[index], directionOrder[target]] = [directionOrder[target], directionOrder[index]];
                invalidateDirectionArrangement('Direction order changed. Re-plan to apply it.');
                renderDirectionOrderEditor();
            });
        });
    }

function updateRouteArrangementControls() {
        routeArrangementModeInputs.forEach((input) => { input.checked = input.value === routeArrangementMode; });
        const directionMode = routeArrangementIsDirectionReturn();
        if (directionOrderSettings) directionOrderSettings.hidden = !directionMode;
        routeEndRequirementInputs.forEach((input) => { input.disabled = directionMode || input.value === 'optional'; });
        routeEndModeInputs.forEach((input) => { input.disabled = directionMode; });
        if (customEndInput) customEndInput.disabled = directionMode || routeEndMode !== 'custom';
        if (directionMode) setCustomEndStatus('Direction order returns to the planned start. End location settings are temporarily disabled.');
        if (routeArrangementStatus) {
            routeArrangementStatus.textContent = directionMode
                ? 'This plan will return to the start snapshot. End location settings are kept for Standard optimisation and restored when you switch back.'
                : 'Google chooses the stop order and uses your end location setting.';
        }
        renderDirectionOrderEditor();
        updateRouteSettingsSummary();
    }

function bindPlanningConfirmationControls() {
        if (confirmRouteBtn) {
            confirmRouteBtn.addEventListener('click', handleConfirmRouteButtonClick);
        }
        if (retrieveStopsBtn) {
            retrieveStopsBtn.addEventListener('click', retrieveAllStopsFromRoutes);
        }
        if (planningDateInput) {
            planningDateInput.addEventListener('change', () => { planningDateInput.dataset.userEdited = 'true'; });
            planningDateInput.addEventListener('change', handlePlanningDateChange);
        }
        if (confirmRouteCancelBtn) {
            confirmRouteCancelBtn.addEventListener('click', () => {
                if (!currentRouteConfirmationState.saving) {
                    hideConfirmRouteModal();
                }
            });
        }
        if (confirmRouteConfirmBtn) {
            confirmRouteConfirmBtn.addEventListener('click', handleConfirmRouteModalConfirm);
        }
        if (confirmRouteModal) {
            confirmRouteModal.addEventListener('click', (event) => {
                if (event.target === confirmRouteModal && !currentRouteConfirmationState.saving) {
                    hideConfirmRouteModal();
                }
            });
        }

    }

// Route settings (start, end, date & time) open on demand from Stops Selection instead of a permanent card.
function bindRouteSettingsPanel() {
        const panel = document.getElementById('routeSettingsPanel');
        const openBtn = document.getElementById('openRouteSettingsBtn');
        const closeBtn = document.getElementById('closeRouteSettingsBtn');
        if (!panel || !openBtn || panel.dataset.bound === 'true') return;
        panel.dataset.bound = 'true';
        const close = () => {
            if (panel.hidden) return;
            panel.hidden = true;
            openBtn.setAttribute('aria-expanded', 'false');
            openBtn.focus();
        };
        const open = () => {
            panel.hidden = false;
            openBtn.setAttribute('aria-expanded', 'true');
            const firstControl = panel.querySelector('input:not([disabled]), button');
            if (firstControl) firstControl.focus();
        };
        openBtn.addEventListener('click', open);
        // Validation that points at a start/end/date field opens the panel so the field is visible.
        window.openRouteSettingsPanel = open;
        if (closeBtn) closeBtn.addEventListener('click', close);
        panel.addEventListener('click', (event) => { if (event.target === panel) close(); });
        document.addEventListener('keydown', (event) => {
            // Escape closes, unless it is dismissing an open address suggestion list.
            if (event.key === 'Escape' && !panel.hidden && !document.querySelector('.pac-container:not([style*="display: none"])')) close();
        });
    }

function bindPlanningPageControls() {
        // Event Listeners for Page 1
        if (backToDashboardBtn) backToDashboardBtn.addEventListener('click', () => showPage('page-history-dashboard'));
        bindRouteSettingsPanel();
        if (searchCustomerInput) {
            searchCustomerInput.addEventListener('input', scheduleCustomerSearchRender);
        }
        if (selectionAddCustomerBtn) {
            selectionAddCustomerBtn.addEventListener('click', async () => {
                await showPage('page-add-stop');
                setStopWorkspaceMode('add');
            });
        }
        if (goToManualAssignBtn) {
            goToManualAssignBtn.addEventListener('click', handleGoToManualAssignPage);
            goToManualAssignBtn.disabled = true;
        }
        if (clearSelectedStopsBtn) {
            clearSelectedStopsBtn.addEventListener('click', () => {
                clearSelectedStopsFast();
            });
        }

        // Event Listeners for Page 2
        if (toggleRouteSettingsBtn && routeSettingsBody) {
            toggleRouteSettingsBtn.addEventListener('click', () => {
                const isHidden = routeSettingsBody.style.display === 'none' || !routeSettingsBody.style.display;
                routeSettingsBody.style.display = isHidden ? 'block' : 'none';
                toggleRouteSettingsBtn.setAttribute('aria-expanded', String(isHidden));
                const toggleIcon = document.getElementById('routeSettingsToggleIcon');
                if (toggleIcon) toggleIcon.innerText = isHidden ? '\u25BC' : '\u25B6';
            });
        }
        if (toggleRoutePanelBtn && routePanel) {
            toggleRoutePanelBtn.addEventListener('click', () => {
                routePanel.classList.toggle('expanded');
                toggleRoutePanelBtn.innerText = routePanel.classList.contains('expanded') ? '\u25BC' : '\u25B2';
            });
            if (isMobile) {
                routePanel.classList.remove('expanded');
                toggleRoutePanelBtn.innerText = '\u25B2';
            }
        }
        if (routePanel) {
            routePanel.addEventListener('touchstart', (event) => {
                routePanelTouchStartY = event.touches[0].clientY;
            }, { passive: true });
            routePanel.addEventListener('touchend', (event) => {
                const endY = event.changedTouches[0].clientY;
                if (routePanelTouchStartY - endY > 50) {
                    routePanel.classList.add('expanded');
                    if (toggleRoutePanelBtn) toggleRoutePanelBtn.innerText = '\u25BC';
                }
                if (endY - routePanelTouchStartY > 50) {
                    routePanel.classList.remove('expanded');
                    if (toggleRoutePanelBtn) toggleRoutePanelBtn.innerText = '\u25B2';
                }
            }, { passive: true });
        }
        routeOriginModeInputs.forEach((input) => {
            input.addEventListener('change', handleRouteOriginModeChange);
        });
        routeEndRequirementInputs.forEach((input) => {
            input.addEventListener('change', handleRouteEndRequirementChange);
        });
        routeEndModeInputs.forEach((input) => {
            input.addEventListener('change', handleRouteEndModeChange);
        });
        routeArrangementModeInputs.forEach((input) => {
            input.addEventListener('change', handleRouteArrangementModeChange);
        });
        updateRouteArrangementControls();
        if (customOriginInput) {
            customOriginInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    resolveCustomOriginAddress();
                }
            });
            customOriginInput.addEventListener('blur', () => {
                const currentCustomLabel = (customOriginLabel || customOriginAddress || '').trim();
                if (routeOriginMode === 'custom' && customOriginInput.value.trim() && customOriginInput.value.trim() !== currentCustomLabel) {
                    resolveCustomOriginAddress();
                }
            });
        }
        if (customEndInput) {
            customEndInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    resolveCustomEndAddress();
                }
            });
            customEndInput.addEventListener('blur', () => {
                const currentCustomLabel = (customEndLabel || customEndAddress || '').trim();
                if (routeEndRequired && routeEndMode === 'custom' && customEndInput.value.trim() && customEndInput.value.trim() !== currentCustomLabel) {
                    resolveCustomEndAddress();
                }
            });
        }
        if (routeStartTimeInput) routeStartTimeInput.addEventListener('change', handleRouteStartTimeChange);
        populateVehicleDriverSelect();
        updatePlanningDateAccess();
        loadVehicleDriverSettings();
        if (routeVehicleDriverSelect) routeVehicleDriverSelect.addEventListener('change', handleVehicleDriverChange);
        if (editVehicleDriverBtn) editVehicleDriverBtn.addEventListener('click', openVehicleDriverEditor);
        if (addVehicleDriverBtn) addVehicleDriverBtn.addEventListener('click', addVehicleDriverFromInput);
        if (vehicleDriverNewInput) {
            vehicleDriverNewInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    addVehicleDriverFromInput();
                }
            });
        }
        if (closeVehicleDriverEditorBtn) closeVehicleDriverEditorBtn.addEventListener('click', closeVehicleDriverEditor);
        if (vehicleDriverModal) {
            vehicleDriverModal.addEventListener('click', (event) => {
                if (event.target === vehicleDriverModal) closeVehicleDriverEditor();
            });
        }
        if (applySuggestionBtn) applySuggestionBtn.addEventListener('click', applySuggestedRoutes);
        if (proceedToOptimizeBtn) proceedToOptimizeBtn.addEventListener('click', handleProceedToOptimizeRoutes);
        if (backToSelectStopsBtnPg2) backToSelectStopsBtnPg2.addEventListener('click', () => showPage('page-select-stops'));


    }
