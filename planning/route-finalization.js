/**
 * Existing explicit confirmation/finalization orchestration. Loading this file
 * only declares functions. The existing once-bound Planning action is the trigger.
 * Consumes Planning state/slot APIs, RouteEngine, RouteSafety, existing ETA helper,
 * Planning persistence, usage/access helpers, UI/MapHandler and app.html DOM refs.
 * No optimizer, ETA, safety, geocoding or partitioning algorithm is implemented here.
 * Classic script: app.html remains the compatibility/bootstrap adapter.
 * See docs/app-html-modularization-phase-1c.md for the shared-global inventory.
 */

function hideConfirmRouteModal() {
      if (confirmRouteModal) {
        confirmRouteModal.hidden = true;
      }
    }

function renderConfirmRouteModalState() {
      const planDefinition = getCurrentProductPlanDefinition();
      const routeStatus = getUsageStatus('activeRoutes');
      const isBasicPlan = getCurrentProductPlan() === 'basic';
      const remainingAfterConfirm = Number.isFinite(routeStatus.remaining)
        ? Math.max(routeStatus.remaining - 1, 0)
        : 0;

      if (confirmRoutePlanNameEl) confirmRoutePlanNameEl.textContent = planDefinition?.name || 'Basic';
      if (confirmRouteDailyLimitEl) confirmRouteDailyLimitEl.textContent = Number.isFinite(routeStatus.limit) ? String(routeStatus.limit) : 'Unlimited';
      if (confirmRouteUsedTodayEl) confirmRouteUsedTodayEl.textContent = String(routeStatus.used || 0);
      if (confirmRouteRemainingTodayEl) confirmRouteRemainingTodayEl.textContent = String(routeStatus.remaining || 0);
      if (confirmRouteWarningEl) {
        confirmRouteWarningEl.textContent = isBasicPlan
          ? `Basic includes ${routeStatus.limit} route plan per day. Clicking Yes will consume your ${routeStatus.remaining === 1 ? 'only' : 'next'} route plan chance for today. You will have ${remainingAfterConfirm} remaining after save.`
          : `Clicking Yes will consume one route plan chance for today. You have ${routeStatus.remaining} remaining now and ${remainingAfterConfirm} remaining after save.`;
      }
      if (confirmRouteConfirmBtn) {
        const quotaFinished = Number.isFinite(routeStatus.limit) && routeStatus.remaining <= 0;
        confirmRouteConfirmBtn.disabled = !!currentRouteConfirmationState.saving || quotaFinished;
        confirmRouteConfirmBtn.textContent = currentRouteConfirmationState.saving
          ? 'Saving...'
          : quotaFinished
            ? 'Quota Reached'
            : 'Yes, Confirm Route';
      }
      if (confirmRouteCancelBtn) {
        confirmRouteCancelBtn.disabled = !!currentRouteConfirmationState.saving;
      }
    }

function openConfirmRouteModal() {
      if (!confirmRouteModal) {
        return;
      }
      renderConfirmRouteModalState();
      confirmRouteModal.hidden = false;
    }

function updateConfirmRouteButtonState() {
      if (!confirmRouteBtn) return;
      syncManualWaypointsFromSlots();
      const setButtonState = (label, disabled, title) => {
        confirmRouteBtn.disabled = disabled;
        confirmRouteBtn.innerHTML = `<span>✅</span> ${escapeHtml(label)}`;
        confirmRouteBtn.title = title || '';
      };
      const assignedStopCount = getAssignedStopIds().length;
      if (retrieveStopsBtn) {
        retrieveStopsBtn.disabled = assignedStopCount === 0;
        retrieveStopsBtn.title = assignedStopCount === 0
          ? 'No assigned stops to retrieve.'
          : 'Move all assigned route stops back to the unassigned list.';
      }
      if (currentRouteConfirmationState.saving) {
        setButtonState('SAVING...', true, 'Saving the current route now.');
        return;
      }

      const routes = Array.isArray(window._activeRoutes) ? window._activeRoutes : [];
      const hasValidRoutes = routes.length > 0
        && routes.every((route) => Array.isArray(route.stops) && route.stops.length > 0);
      const hasValidStart = !!currentLocationOrigin;
      const requireEndInput = document.querySelector('input[name="endLocationType"][value="require"]')
        || document.querySelector('input[name="routeEndRequirement"][value="required"]');
      const sameAsStartInput = document.querySelector('input[name="endLocationOption"][value="same"]')
        || document.querySelector('input[name="routeEndMode"][value="same"]');
      const endInput = document.querySelector('#endLocationInput')?.value
        || document.querySelector('#customEndInput')?.value
        || '';
      const hasValidEnd = (() => {
        if (routeArrangementIsDirectionReturn()) return true;
        const requireEnd = requireEndInput?.checked;
        const sameAsStart = sameAsStartInput?.checked;

        if (!requireEnd) return true;
        if (sameAsStart) return true;

        return !!String(endInput).trim();
      })();

      if (!hasValidRoutes) {
        setButtonState('CONFIRM ROUTE', true, 'Assign stops to at least one route group before confirming.');
        return;
      }
      if (!hasValidStart) {
        setButtonState('CONFIRM ROUTE', true, 'Select a start location before confirming.');
        return;
      }
      if (!hasValidEnd) {
        setButtonState('CONFIRM ROUTE', true, 'Select an end location before confirming.');
        return;
      }
      if (routeArrangementIsDirectionReturn() && directionPlanStale) {
        setButtonState('CONFIRM ROUTE', true, 'Re-plan direction order after changing the start or direction settings.');
        return;
      }

      const routeStatus = getUsageStatus('activeRoutes');
      if (Number.isFinite(routeStatus.limit) && routeStatus.remaining <= 0) {
        setButtonState('CONFIRM ROUTE', true, 'Daily route confirm quota is finished for the current plan.');
        return;
      }

      setButtonState('CONFIRM ROUTE', false, 'Review quota details and confirm before saving this route.');
    }

function handleConfirmRouteButtonClick() {
      if (currentRouteConfirmationState.saving) {
        showToast('Route is saving now. Please wait for this save to finish.', 'info', 2600);
        return;
      }

      syncManualWaypointsFromSlots();
      if (getAssignedStopIds().length === 0) {
        setManualAssignmentMessage('Assign stops to at least one route before confirming.');
        showToast('Assign stops to at least one route before confirming.', 'warning', 3600);
        return;
      }

      window._testRoutes = Array.isArray(window._activeRoutes) ? window._activeRoutes : [];
      console.log('NEW ENGINE ROUTES:', window._testRoutes);

      if (!ensureOriginReadyForPlanning()) return;
      if (!routeArrangementIsDirectionReturn() && !ensureEndLocationReadyForPlanning()) return;
      if (!validatePlanningDateForSave()) return;
      if (unassignedStops.length > 0 && !confirm('You have unassigned stops. Confirm this route without them?')) return;

      const routeStatus = getUsageStatus('activeRoutes');
      if (Number.isFinite(routeStatus.limit) && routeStatus.remaining <= 0) {
        openRouteLimitReachedModal(routeStatus);
        return;
      }

      currentRouteConfirmationState = {
        saved: false,
        saving: false,
        historyId: null,
        source: 'manual-confirm'
      };
      openConfirmRouteModal();
    }

async function handleConfirmRouteModalConfirm() {
      if (currentRouteConfirmationState.saving) return;
      const routeStatus = getUsageStatus('activeRoutes');
      if (Number.isFinite(routeStatus.limit) && routeStatus.remaining <= 0) {
        hideConfirmRouteModal();
        openRouteLimitReachedModal(routeStatus);
        updateConfirmRouteButtonState();
        return;
      }
      if (routeArrangementIsDirectionReturn() && directionPlanStale) {
        setManualAssignmentMessage('Re-plan direction order after changing the start or direction settings.');
        return;
      }

      currentRouteConfirmationState = {
        ...currentRouteConfirmationState,
        saving: true
      };
      updateConfirmRouteButtonState();
      renderConfirmRouteModalState();

      if (currentRouteConfirmationState.source === 'manual-confirm') {
        hideConfirmRouteModal();
        showToast('Confirm accepted. Preparing route page...', 'info', 2600);
        handleProceedToOptimizeRoutes({ skipPreflight: true, saveAfterPlan: true, backgroundSave: false })
          .catch((error) => {
            console.error('Confirm route flow failed:', error);
            currentRouteConfirmationState = {
              ...currentRouteConfirmationState,
              saving: false
            };
            updateConfirmRouteButtonState();
            renderConfirmRouteModalState();
            showToast('Route confirmation failed. Please try again.', 'error', 4200);
          });
        return;
      }

      const saveResult = await saveCurrentRouteToHistory();
      if (saveResult?.success) {
        hideConfirmRouteModal();
        showToast('Route confirmed and saved.', 'success', 3200);
        return;
      }

      currentRouteConfirmationState = {
        ...currentRouteConfirmationState,
        saving: false
      };
      updateConfirmRouteButtonState();
      renderConfirmRouteModalState();
    }

function validateRouteInputs(options = {}) {
        const skipPreflight = options.skipPreflight === true;
        syncManualWaypointsFromSlots();

        if (skipPreflight) {
            return { success: true };
        }

        if (getAssignedStopIds().length === 0) {
            messageBarPg2.textContent = "Assign stops to at least one route before planning.";
            return { success: false, error: 'No assigned stops' };
        }
        if (routeArrangementIsDirectionReturn() && directionPlanStale) {
            return { success: false, error: 'Direction plan is stale' };
        }
        if (!ensureOriginReadyForPlanning()) return { success: false, error: 'Origin is not ready' };
        if (!routeArrangementIsDirectionReturn() && !ensureEndLocationReadyForPlanning()) return { success: false, error: 'End location is not ready' };
        if (unassignedStops.length > 0) {
            // Using a simple confirm for now, replace with custom modal if needed
            if (!confirm("You have unassigned stops. Are you sure you want to proceed without them?")) {
                return { success: false, cancelled: true };
            }
        }

        return { success: true };
    }

async function prepareRoutePlanningUi(options = {}) {
        const saveAfterPlan = options.saveAfterPlan === true;

        messageBarOptimizedPg3.innerHTML = 'Finalizing routes... Please wait.';
        if (messageBarPg2) messageBarPg2.textContent = 'Finalizing routes and stop ETAs... Please wait.';
        try { performance.mark('grx:planningFinalizeStart'); } catch {}
        UI.disablePage3ActionButtons();
        AppState.plannedRoutes = []; // Reset planned routes
        window.plannedRoutes = AppState.plannedRoutes; // Keep window reference in sync
        if (!saveAfterPlan) {
            resetCurrentRouteConfirmationState();
        } else {
            currentRouteConfirmationState = {
                ...currentRouteConfirmationState,
                saved: false,
                saving: true,
                historyId: null,
                source: 'manual-confirm'
            };
            updateConfirmRouteButtonState();
            renderConfirmRouteModalState();
        }
        clearMasterListPreviewMarkers(); // Clear markers from Page 2 map if any were left
        clearRouteLines(); // Clear route lines from Page 2 map
        if (currentPositionMarkerPage2) currentPositionMarkerPage2.map = null; // Hide current location marker from Page 2 map
    }

function renderPlannedRoutes(routes, routeBuildState = {}, options = {}) {
        const saveAfterPlan = options.saveAfterPlan === true;
        const backgroundSave = options.backgroundSave === true;
        const route1Success = routeBuildState.route1Success;
        const route2Success = routeBuildState.route2Success;
        const route1ErrorMessage = routeBuildState.route1ErrorMessage || "";
        const route2ErrorMessage = routeBuildState.route2ErrorMessage || "";
        const hasDynamicTestRoutes = routeBuildState.hasDynamicTestRoutes === true;

        if (routes.length > 0 && routes.some(r => r.directionsResult)) {
            currentViewingRouteIndexPage3 = routes.findIndex(r => r.directionsResult); // View the first successful route
            if(currentViewingRouteIndexPage3 === -1) currentViewingRouteIndexPage3 = 0; // Fallback if somehow no successful route found (should not happen with .some check)
            activeRouteId = routes[currentViewingRouteIndexPage3]?.id || 1;

            renderOptimizedRouteOnMap(currentViewingRouteIndexPage3);
            UI.setupRouteSwitcherPage3();
            UI.updateNavigationButtonsPage3();
            UI.enablePage3ActionButtonsAfterPlan();
            if (!optimizedRouteListsHeader.classList.contains('active')) optimizedRouteListsHeader.click(); // Ensure lists are visible

            // Construct final message based on success/failure of routes
            let finalMessage = `<strong>`;
            const viewingRouteId = routes[currentViewingRouteIndexPage3]?.id || (routes.find(r => r.directionsResult)?.id || 'N/A');

            if (hasDynamicTestRoutes) {
                const successfulDynamicRoutes = routes.filter(r => r && r.directionsResult);
                finalMessage += `Done: ${successfulDynamicRoutes.length} dynamic ${successfulDynamicRoutes.length === 1 ? 'route' : 'routes'} planned successfully. Viewing Route ${viewingRouteId}.`;
            } else if (manualRoute1Waypoints.length > 0 && manualRoute2Waypoints.length > 0) {
                if (route1Success && route2Success) {
                    finalMessage += `âœ… Both routes planned successfully. Viewing Route ${viewingRouteId}.`;
                } else if (route1Success && !route2Success) {
                    finalMessage += `âœ… Route 1 planned. Route 2 failed: ${route2ErrorMessage}. Viewing Route 1.`;
                } else if (!route1Success && route2Success) {
                    finalMessage += `âœ… Route 2 planned. Route 1 failed: ${route1ErrorMessage}. Viewing Route 2.`;
                } else {
                    finalMessage += `âŒ Both routes failed. R1: ${route1ErrorMessage}. R2: ${route2ErrorMessage}.`;
                }
            } else if (manualRoute1Waypoints.length > 0) {
                if (route1Success) {
                    finalMessage += `âœ… Route 1 planned successfully. Viewing Route 1.`;
                } else {
                    finalMessage += `âŒ Route 1 failed: ${route1ErrorMessage}.`;
                }
            } else if (manualRoute2Waypoints.length > 0) {
                 if (route2Success) {
                    finalMessage += `âœ… Route 2 planned successfully. Viewing Route ${routes.find(r => r.directionsResult)?.id || 'N/A'}.`;
                } else {
                    finalMessage += `âŒ Route 2 failed: ${route2ErrorMessage}.`;
                }
            }
            finalMessage += saveAfterPlan
                ? (backgroundSave ? `<br>Saving confirmed route in background...</strong>` : `<br>Saving confirmed route now...</strong>`)
                : `<br>This is a preview only. Return to the route plan page and click Confirm Route to save it.</strong>`;
            messageBarOptimizedPg3.innerHTML = finalMessage;
            return { success: true };
        }

        let failMessage = 'âŒ No routes could be planned.';
        if (hasDynamicTestRoutes) {
            if (route1ErrorMessage) failMessage += `<br>${route1ErrorMessage}`;
            if (route2ErrorMessage) failMessage += `<br>${route2ErrorMessage}`;
        } else {
            if (manualRoute1Waypoints.length > 0 && route1ErrorMessage) failMessage += `<br>Route 1 Error: ${route1ErrorMessage}`;
            if (manualRoute2Waypoints.length > 0 && route2ErrorMessage) failMessage += `<br>Route 2 Error: ${route2ErrorMessage}`;
        }
        messageBarOptimizedPg3.innerHTML = failMessage;
        if (saveAfterPlan) {
            currentRouteConfirmationState = {
                ...currentRouteConfirmationState,
                saving: false
            };
            hideConfirmRouteModal();
            updateConfirmRouteButtonState();
            showToast('Route planning failed. Nothing was saved.', 'error', 4200);
        }
        return { success: false, error: 'Route planning failed' };
    }

async function handleProceedToOptimizeRoutes(options = {}) {
        const saveAfterPlan = options.saveAfterPlan === true;
        const backgroundSave = options.backgroundSave === true;
        const validationResult = validateRouteInputs(options);
        if (!validationResult.success) return validationResult;
        // Confirm saves the exact route and safety result currently shown on the
        // manual map. If a debounced calculation is pending, wait for it first.
        await ensureManualRouteCheckCurrent();
        await prepareRoutePlanningUi(options);
        const dynamicBuildState = await RouteEngine.buildPlannedRoutes();
        await RouteSafety.validateRoutes(dynamicBuildState.plannedRoutes, { context: 'final', forceRefresh: false, reuse: true });
        const dynamicRenderResult = renderPlannedRoutes(dynamicBuildState.plannedRoutes, dynamicBuildState, options);
        if (!dynamicRenderResult.success) return dynamicRenderResult;
        try { performance.mark('grx:etaStart'); } catch {}
        generateTimeListAndShowOnPage3Legacy({ print: false });
        try { performance.mark('grx:etaEnd'); performance.measure('grx:eta', 'grx:etaStart', 'grx:etaEnd'); } catch {}
        const dynamicSaveResult = await savePlannedRoutes(dynamicBuildState.plannedRoutes, options);
        if (dynamicSaveResult?.success && !dynamicSaveResult.skipped) {
            if (!dynamicSaveResult.id) {
                if (messageBarPg2) messageBarPg2.textContent = 'Finalized route has no saved plan ID. Please retry.';
                return { success: false, error: 'Finalized route has no saved plan ID.' };
            }
            try { performance.mark('grx:planningFinalizeEnd'); performance.measure('grx:planningFinalize', 'grx:planningFinalizeStart', 'grx:planningFinalizeEnd'); } catch {}
            openDispatchPage(dynamicSaveResult.id);
        } else if (!dynamicSaveResult?.success && messageBarPg2) {
            messageBarPg2.textContent = dynamicSaveResult?.error || 'Route save failed. Please retry.';
        }
        return dynamicSaveResult?.skipped
            ? { success: dynamicBuildState.plannedRoutes.length > 0 && dynamicBuildState.plannedRoutes.some(r => r.directionsResult) }
            : dynamicSaveResult;
    }

function openDispatchPage(planId = currentRouteConfirmationState.saved ? currentRouteConfirmationState.historyId : null) {
        const stableId = String(planId || '').trim();
        if (stableId && !/^[A-Za-z0-9_-]{1,128}$/.test(stableId)) {
            showToast('This saved route has an invalid plan ID.', 'error', 4200);
            return;
        }
        const userId = window.FirebaseApp?.auth?.getCurrentUser?.()?.uid;
        if (stableId && userId) {
            try { sessionStorage.setItem(`grxLastFinalizedPlan:${userId}`, stableId); } catch {}
        }
        window.location.assign(`dispatch.html${stableId ? `?planId=${encodeURIComponent(stableId)}` : ''}`);
    }
