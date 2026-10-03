/**
 * Planning-specific persistence orchestration. Generic persistence stays in
 * RoutePlannerStorage. Consumes Planning state/slot snapshots, existing usage and
 * history helpers, FirebaseApp.auth current user, firebase order reads, OrderPlan,
 * route-enrichment, UI refs, date helpers and existing session restore/cache flags.
 * No storage schema, read/write count, cache policy or save sequence is changed.
 * Classic script: app.html remains the compatibility/bootstrap adapter.
 * See docs/app-html-modularization-phase-1c.md for the shared-global inventory.
 */

function buildCompactPlannedRoutesSnapshot(routes = AppState.plannedRoutes) {
        return (Array.isArray(routes) ? routes : [])
            .filter(Boolean)
            .map((route) => ({
                id: route.id,
                label: route.label || `Route ${route.id || ''}`.trim(),
                color: route.color,
                optimizedStops: route.optimizedStops || [],
                originalWaypoints: route.originalWaypoints || [],
                customerStops: route.customerStops || [],
                routeStopConfigs: route.routeStopConfigs || [],
                date: route.date || route.planningDate || getSelectedPlanningDate(),
                planningDate: route.planningDate || route.date || getSelectedPlanningDate(),
                startTime: route.startTime || route.routeStartTime || routeStartTime,
                driverId: route.driverId || route.vehicleDriver || getSelectedDriverId(),
                vehicleDriver: route.vehicleDriver || getSelectedDriverId(),
                safetyWaypoints: route.safetyWaypoints || [],
                manualWaypoints: route.manualWaypoints || [],
                manualDetourKey: route.manualDetourKey || null,
                lorryValidation: route.lorryValidation || null,
                arrangementMode: route.arrangementMode || 'standard',
                directionOrder: route.directionOrder || [],
                directionOriginSnapshot: route.directionOriginSnapshot || null,
                returnToOrigin: !!route.returnToOrigin,
                hasDirectionsResult: !!route.directionsResult
            }));
    }

function syncSessionToCloud() {
        const updatedAt = new Date().toISOString();
        markLocalSessionUpdated(updatedAt);
        if (window.RoutePlannerStorage && typeof window.RoutePlannerStorage.saveSelection === 'function') {
            const sessionData = {
                selectedCustomers: Array.from(selectedCustomers),
                selectedAddresses: Array.from(selectedAddresses),
                updatedAt
            };
            window.RoutePlannerStorage.saveSelection(sessionData).catch(err => {
                console.warn('Selection persistence failed:', err);
            });
        }
    }

async function loadSessionFromCloud(options = {}) {
        const { force = false } = options;
        if (!window.RoutePlannerStorage || typeof window.RoutePlannerStorage.loadSelection !== 'function') {
            return false;
        }
        if (sessionRestorePromise && !force) {
            return sessionRestorePromise;
        }

        sessionRestorePromise = (async () => {
            try {
                const result = await window.RoutePlannerStorage.loadSelection();
                const session = result?.session || null;
                if (!session) return false;

                const cloudUpdatedAtMs = parseTimestampMs(session.updatedAt);
                const localUpdatedAtMs = getLastKnownLocalSessionUpdateMs();
                const hasLocalSelections = selectedCustomers.size > 0 || selectedAddresses.size > 0;
                if (getCurrentActivePageId() === 'page-manual-assign' && hasLocalSelections) {
                    console.log('Skipping saved selection restore while route assignment is active.');
                    return false;
                }
                const shouldKeepLocalState = hasLocalSelections
                    && localUpdatedAtMs > 0
                    && cloudUpdatedAtMs > 0
                    && localUpdatedAtMs >= cloudUpdatedAtMs;

                if (shouldKeepLocalState) {
                    console.log('Skipping stale saved selection restore in favor of newer local state.');
                    return false;
                }

                if (!Array.isArray(session.selectedCustomers) || session.selectedCustomers.length === 0) {
                    if (!hasLocalSelections) {
                        selectedCustomers.clear();
                        selectedAddresses.clear();
                        updateSelectedListOnPage1();
                        renderCustomerList(searchCustomerInput?.value || '');
                    }
                    lastAppliedCloudSessionUpdateMs = cloudUpdatedAtMs;
                    return false;
                }

                console.log('Loading selection state from storage...');
                selectedCustomers = new Set(session.selectedCustomers);
                selectedAddresses = new Set(session.selectedAddresses || []);

                if (allCustomerEntries.length > 0) {
                    restoreSelectedCustomersFromAddresses();
                    updateSelectedListOnPage1();
                    renderCustomerList(searchCustomerInput?.value || '');
                }

                if (cloudUpdatedAtMs > 0) {
                    lastAppliedCloudSessionUpdateMs = cloudUpdatedAtMs;
                    localStorage.setItem('bjsSessionUpdatedAt', session.updatedAt);
                }
                console.log('Selection state loaded:', selectedCustomers.size, 'stops');
                return true;
            } catch (err) {
                console.warn('Failed to load saved selection state:', err);
                return false;
            } finally {
                sessionRestorePromise = null;
            }
        })();

        return sessionRestorePromise;
    }

async function saveCurrentRouteToHistory(options = {}) {
        const silent = options.silent === true;
        if (AppState.plannedRoutes.length === 0) {
            appLog("saveCurrentRouteToHistory: No planned routes to save");
            return { success: false, error: 'No planned routes to save' };
        }

        if (!validatePlanningDateForSave()) {
            return { success: false, error: 'Planning date is required' };
        }

        const successfulRoutes = AppState.plannedRoutes.filter(r => r && r.directionsResult);
        if (successfulRoutes.length === 0) {
            appLog("saveCurrentRouteToHistory: No successful routes to save");
            return { success: false, error: 'No successful routes to save' };
        }

        const dailyRouteStatus = getUsageStatus('activeRoutes');
        const projectedRouteCount = dailyRouteStatus.used + 1;
        if (Number.isFinite(dailyRouteStatus.limit) && projectedRouteCount > dailyRouteStatus.limit) {
            openRouteLimitReachedModal(dailyRouteStatus);
            return { success: false, limitReached: true };
        }

        const authUser = (window.FirebaseApp && window.FirebaseApp.auth && window.FirebaseApp.auth.getCurrentUser)
            ? window.FirebaseApp.auth.getCurrentUser()
            : null;
        const username = authUser?.displayName || authUser?.email || localStorage.getItem('bjsUsername') || 'Anonymous';
        appLog("saveCurrentRouteToHistory: Username:", username);
        const selectedPlanningDate = getSelectedPlanningDate();
        const selectedDriverId = getSelectedDriverId();
        const orderPlan = authUser ? window.GoRouteXOrderPlan?.read(authUser.uid) : null;
        let driverPlannedRoutes = JSON.parse(JSON.stringify(AppState.plannedRoutes));
        let orderLinkStatus = 'NONE';
        let linkedOrderCount = 0;
        if (authUser && window.firebase?.firestore) {
            try {
                try { performance.mark('grx:orderEnrichmentStart'); } catch {}
                const ordersRef = firebase.firestore().collection('users').doc(authUser.uid).collection('orders');
                let ordersForRoute = [];
                if (orderPlan) {
                    if (orderPlan.stopIds.some(id => !selectedCustomers.has(id))) {
                        throw new Error('The selected order stops changed. Return to Order Hub and select the orders again.');
                    }
                    for (let offset = 0; offset < orderPlan.orderIds.length; offset += 20) {
                        const ids = orderPlan.orderIds.slice(offset, offset + 20);
                        const snapshots = await Promise.all(ids.map(id => ordersRef.doc(id).get()));
                        ordersForRoute.push(...snapshots.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() })));
                    }
                } else {
                    const ordersSnapshot = await ordersRef.where('deliveryDate', '==', selectedPlanningDate).get();
                    ordersForRoute = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                }
                const { enrichPlannedRoutes } = await import('../driver/route-enrichment.js');
                const linked = enrichPlannedRoutes(driverPlannedRoutes, ordersForRoute, selectedPlanningDate,
                    { selectedOrderIds: orderPlan?.orderIds || null });
                if (orderPlan && (linked.linkedCount !== orderPlan.orderIds.length || linked.ambiguousCount)) {
                    throw new Error('Not all selected orders could be linked to this route. Return to Order Hub and review the saved stops.');
                }
                driverPlannedRoutes = linked.plannedRoutes;
                linkedOrderCount = linked.linkedCount;
                orderLinkStatus = linked.ambiguousCount ? 'AMBIGUOUS' : linked.linkedCount ? 'LINKED' : 'NONE';
                try { performance.mark('grx:orderEnrichmentEnd'); performance.measure('grx:orderEnrichment', 'grx:orderEnrichmentStart', 'grx:orderEnrichmentEnd'); } catch {}
            } catch (error) {
                if (orderPlan) {
                    if (messageBarOptimizedPg3) messageBarOptimizedPg3.textContent = error.message;
                    return { success: false, error: error.message };
                }
                orderLinkStatus = 'UNAVAILABLE';
                console.warn('Route saved without Order Hub links:', error);
            }
        }

        driverPlannedRoutes = driverPlannedRoutes.map(route => {
            const legs = route?.directionsResult?.routes?.[0]?.legs || [];
            return { ...route,
                estimatedDistanceMeters: Number(route.estimatedDistanceMeters) || legs.reduce((sum, leg) => sum + Number(leg.distance?.value || 0), 0),
                estimatedDurationSeconds: Number(route.estimatedDurationSeconds) || legs.reduce((sum, leg) => sum + Number(leg.duration?.value || 0), 0) };
        });

        const historyEntry = {
            id: Date.now().toString(),
            snapshotSchemaVersion: 1,
            planVersion: 1,
            finalizedAt: new Date().toISOString(),
            routeName: `Route ${formatRegionalDate(getDateFromKey(selectedPlanningDate) || new Date(), { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
            timestamp: new Date().toISOString(),
            date: selectedPlanningDate,
            planningDate: selectedPlanningDate,
            startTime: routeStartTime,
            driverId: selectedDriverId,
            assignedDriverUid: authUser?.uid || null,
            origin: currentLocationOrigin,
            originName: addressNameMap[currentLocationOrigin] || "Current Location",
            originMode: routeOriginMode,
            originLatLng: currentLatLng ? { ...currentLatLng } : null,
            customOriginAddress,
            customOriginLatLng: customOriginLatLng ? { ...customOriginLatLng } : null,
            endLocationRequired: routeEndRequired,
            endLocationMode: routeEndMode,
            customEndAddress,
            customEndLatLng: customEndLatLng ? { ...customEndLatLng } : null,
            endLocationLabel: getCurrentConfiguredEndLocationLabel(),
            arrangementMode: routeArrangementMode,
            directionOrder: [...directionOrder],
            directionOriginSnapshot: directionOriginSnapshot ? { ...directionOriginSnapshot } : null,
            routeStartTime,
            vehicleDriver: selectedDriverId,
            driverName: selectedDriverId,
            selectedStops: Array.from(selectedAddresses),
            selectedCustomers: Array.from(selectedCustomers),
            routeGroups: buildRouteGroupsSnapshot(),
            manualRouteSlots: getActiveManualRouteKeys().reduce((slots, routeKey) => {
                slots[routeKey] = cloneRouteSlots(manualRouteSlots[routeKey]);
                return slots;
            }, {}),
            plannedRoutes: driverPlannedRoutes,
            orderLinkStatus,
            linkedOrderCount,
            selectedOrderIds: orderPlan?.orderIds || [],
            addressNameMap: { ...addressNameMap },
            totalStops: selectedCustomers.size,
            routePlanUsageCount: 1,
            successfulRoutesCount: successfulRoutes.length,
            user: username
        };

        const originalHistoryId = String(historyEntry.id);

        try {
            const saveResult = window.RoutePlannerStorage
                ? await window.RoutePlannerStorage.saveHistory(historyEntry)
                : { success: false, error: 'Route storage unavailable' };
            if (!saveResult.success) {
                appLog("❌ Could not save route");
                if (!silent && messageBarOptimizedPg3) {
                    messageBarOptimizedPg3.textContent = '⚠️ Route save failed. Please try again.';
                }
                if (!silent) alert('Route save failed. Please try again.');
                return { success: false, error: saveResult.error || 'Route save failed' };
            }

            historyEntry.id = saveResult.id ? String(saveResult.id) : String(historyEntry.id);
            routeHistory = [historyEntry, ...routeHistory.filter(r => {
                const routeId = String(r.id);
                return routeId !== String(historyEntry.id) && routeId !== originalHistoryId;
            })];
            if (window.RoutePlannerStorage?.sortHistoryEntries) {
                routeHistory = window.RoutePlannerStorage.sortHistoryEntries(routeHistory);
            }

            incrementUsage();
            appLog("Route saved:", historyEntry.id);
            markCurrentRouteAsSaved(historyEntry.id, 'confirmed');
            if (orderPlan && authUser) window.GoRouteXOrderPlan.clear(authUser.uid);
            if (messageBarOptimizedPg3) {
                messageBarOptimizedPg3.innerHTML = '<strong>✅ Route confirmed and saved. This consumed 1 route plan chance for today.</strong>';
            }
            renderHistoryDashboard();
            setTimeout(() => {
                loadRouteHistory({ forceRefresh: true }).catch((error) => {
                    console.warn('Background route history refresh failed:', error);
                });
            }, 0);
            return { success: true, id: historyEntry.id };
        } catch (error) {
            appLog("❌ Error saving route:", error);
            if (!silent && messageBarOptimizedPg3) {
                messageBarOptimizedPg3.textContent = '⚠️ Save failed due to a storage error.';
            }
            if (!silent) alert('Unable to save route history: ' + (error.message || error));
            return { success: false, error: error.message || String(error) };
        }
    }

async function savePlannedRoutes(routes, options = {}) {
        const saveAfterPlan = options.saveAfterPlan === true;
        if (!saveAfterPlan) return { success: true, skipped: true };

        try { performance.mark('grx:planPersistStart'); } catch {}
        const saveResult = await saveCurrentRouteToHistory();
        try { performance.mark('grx:planPersistEnd'); performance.measure('grx:planPersist', 'grx:planPersistStart', 'grx:planPersistEnd'); } catch {}
        if (saveResult?.success) {
            return saveResult;
        }

        currentRouteConfirmationState = {
            ...currentRouteConfirmationState,
            saving: false
        };
        updateConfirmRouteButtonState();
        renderConfirmRouteModalState();
        return saveResult || { success: false, error: 'Route save failed' };
    }

async function saveActivePlannedRoutesToCloud() {
        try {
            // Prepare serializable route data (remove non-serializable DirectionsResult methods)
            const serializableRoutes = AppState.plannedRoutes.map((route, index) => {
                if (!route) return null;
                return {
                    id: route.id,
                    color: route.color || getRouteColor(index),
                    safetyWaypoints: route.safetyWaypoints || [],
                    manualWaypoints: route.manualWaypoints || [],
                    manualDetourKey: route.manualDetourKey || null,
                    lorryValidation: route.lorryValidation || null,
                    originalWaypoints: route.originalWaypoints || [],
                    optimizedStops: route.optimizedStops || [],
                    detailedStopTimes: route.detailedStopTimes || [],
                    customerStops: route.customerStops || [],
                    routeStopConfigs: route.routeStopConfigs || [],
                    date: route.date || route.planningDate || getSelectedPlanningDate(),
                    planningDate: route.planningDate || route.date || getSelectedPlanningDate(),
                    startTime: route.startTime || route.routeStartTime || routeStartTime,
                    driverId: route.driverId || route.vehicleDriver || getSelectedDriverId(),
                    routeStartTime: route.routeStartTime || routeStartTime,
                    vehicleDriver: route.vehicleDriver || getSelectedDriverId(),
                    originMode: route.originMode || routeOriginMode,
                    endLocationRequired: !!route.endLocationRequired,
                    endLocationMode: route.endLocationMode || 'same',
                    endLocationId: route.endLocationId || null,
                    endLocationAddress: route.endLocationAddress || '',
                    endLocationLatLng: route.endLocationLatLng || null,
                    endLocationLabel: route.endLocationLabel || '',
                    arrangementMode: route.arrangementMode || 'standard',
                    directionOrder: route.directionOrder || [],
                    directionOriginSnapshot: route.directionOriginSnapshot || null,
                    returnToOrigin: !!route.returnToOrigin,
                    scheduleHtml: route.scheduleHtml || '',
                    finalEtaAtLastStop: route.finalEtaAtLastStop || null,
                    finalEtaAtHq: route.finalEtaAtHq || null
                };
            }).filter(r => r !== null);

            const result = window.RoutePlannerStorage
                ? await window.RoutePlannerStorage.saveActiveRoutes({
                plannedRoutes: serializableRoutes,
                addressNameMap: addressNameMap || {},
                origin: currentLocationOrigin || '',
                originMode: routeOriginMode,
                originLatLng: currentLatLng || null,
                endLocationRequired: routeEndRequired,
                endLocationMode: routeEndMode,
                customEndAddress,
                customEndLatLng: customEndLatLng || null,
                endLocationLabel: getCurrentConfiguredEndLocationLabel(),
                arrangementMode: routeArrangementMode,
                directionOrder: [...directionOrder],
                directionOriginSnapshot: directionOriginSnapshot ? { ...directionOriginSnapshot } : null,
                date: getSelectedPlanningDate(),
                planningDate: getSelectedPlanningDate(),
                startTime: routeStartTime,
                driverId: getSelectedDriverId(),
                routeStartTime,
                vehicleDriver: getSelectedDriverId()
                })
                : { success: false, error: 'Active route storage unavailable' };

            if (result.success) {
                console.log('✅ Active planned routes saved for route tracking');
            }
        } catch (e) {
            console.warn('Failed to save active routes:', e);
        }
    }
