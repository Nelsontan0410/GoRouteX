/**
 * Existing Planning state ownership. Mutable lexical bindings are declared here;
 * the initializePlanning* calls in app.html assign their original values at the
 * original execution positions (after existing constants/helpers are available).
 * They are bootstrap-only, not page-entry hooks. Existing UI and AppState users
 * continue using the same live bindings and function API. No new store is created.
 * Classic script: app.html remains the compatibility/bootstrap adapter.
 * See docs/app-html-modularization-phase-1c.md for the shared-global inventory.
 */

let selectedAddresses, selectedCustomers, unassignedStops, manualRoute1Waypoints, manualRoute2Waypoints, manualRouteSlots, routeOriginMode, routeStartTime, planningDate, selectedVehicleDriver, vehicleDriverItems, vehicleDriverCloudLoadPromise, customOriginAddress, customOriginLatLng, customOriginLabel, customOriginAutocomplete, routeEndRequired, routeEndMode, customEndAddress, customEndLatLng, customEndLabel, customEndAutocomplete, routeArrangementMode, directionOrder, directionOriginSnapshot, directionPlanRun, directionPlanStale, currentLocationRequestToken, currentRouteConfirmationState, suggestedWaypointOrder, currentViewingRouteIndexPage3, activeRouteId;

function resetCurrentRouteConfirmationState() {
      currentRouteConfirmationState = {
        saved: false,
        saving: false,
        historyId: null,
        source: 'draft'
      };
      hideConfirmRouteModal();
      updateConfirmRouteButtonState();
    }

function markCurrentRouteAsSaved(historyId, source = 'saved') {
      currentRouteConfirmationState = {
        saved: true,
        saving: false,
        historyId: historyId ? String(historyId) : null,
        source
      };
      updateConfirmRouteButtonState();
    }

function createEmptyRouteSlots() {
        const slots = {};
        for (let slotNumber = 1; slotNumber <= MAX_WAYPOINTS_PER_ROUTE; slotNumber++) {
            slots[String(slotNumber)] = { location: null, stay: getDefaultStayMinutes() };
        }
        return slots;
    }

function getRouteSlotKeys() {
        return Array.from({ length: MAX_WAYPOINTS_PER_ROUTE }, (_, index) => String(index + 1));
    }

function cloneRouteSlots(routeSlots) {
        const cloned = createEmptyRouteSlots();
        if (!routeSlots || typeof routeSlots !== 'object') {
            return cloned;
        }

        getRouteSlotKeys().forEach((slotKey) => {
            const slotData = routeSlots[slotKey];
            if (!slotData) return;
            cloned[slotKey] = {
                location: slotData.location || null,
                stay: normalizeStayMinutes(slotData.stay)
            };
        });

        return cloned;
    }

function buildRouteGroupsSnapshot() {
        return getActiveManualRouteKeys().map((routeKey) => ({
            id: getRouteKeyIndex(routeKey) + 1,
            key: routeKey,
            label: getManualRouteGroupLabel(routeKey),
            stopIds: getRouteWaypointIds(routeKey),
            slots: cloneRouteSlots(manualRouteSlots[routeKey])
        }));
    }

function buildRouteSlotsFromSaved(savedSlots, fallbackWaypoints = []) {
        const slots = createEmptyRouteSlots();

        if (savedSlots && typeof savedSlots === 'object') {
            getRouteSlotKeys().forEach((slotKey) => {
                const slotData = savedSlots[slotKey];
                if (!slotData) return;
                slots[slotKey] = {
                    location: slotData.location || null,
                    stay: normalizeStayMinutes(slotData.stay)
                };
            });
            return slots;
        }

        fallbackWaypoints.slice(0, MAX_WAYPOINTS_PER_ROUTE).forEach((customerId, index) => {
            slots[String(index + 1)] = { location: customerId, stay: getDefaultStayMinutes() };
        });

        return slots;
    }

function getActiveManualRouteKeys() {
        const keys = Object.keys(manualRouteSlots || {}).filter(isManualRouteListType);
        return keys.sort((a, b) => getRouteKeyIndex(a) - getRouteKeyIndex(b));
    }

function getRouteWaypointIds(listType) {
        return getRouteSlotKeys()
            .map((slotKey) => manualRouteSlots[listType]?.[slotKey]?.location || null)
            .filter(Boolean);
    }

function buildManualRouteSlotsFromActiveRoutes(activeRoutes) {
        const routes = Array.isArray(activeRoutes) && activeRoutes.length > 0
            ? activeRoutes
            : [
                { stops: [] },
                { stops: [] }
            ];

        const nextSlots = {};
        routes.forEach((route, index) => {
            const routeKey = `route${index + 1}`;
            const stopIds = (Array.isArray(route?.stops) ? route.stops : [])
                .map((stop) => getPackedRouteStopId(stop) || null)
                .filter(Boolean);
            nextSlots[routeKey] = buildRouteSlotsFromSaved(null, stopIds);
        });

        manualRouteSlots = nextSlots;
        syncManualWaypointsFromSlots();
    }

function restoreManualRouteSlots(route1Waypoints = [], route2Waypoints = [], savedRouteSlots = null) {
        manualRouteSlots = {
            route1: buildRouteSlotsFromSaved(savedRouteSlots?.route1, route1Waypoints),
            route2: buildRouteSlotsFromSaved(savedRouteSlots?.route2, route2Waypoints)
        };
        syncManualWaypointsFromSlots();
    }

function resetManualRouteSlots() {
        restoreManualRouteSlots([], []);
        manualPreviewRoutes = [];
        manualRouteCompletedKey = '';
        manualDetourTarget = null;
        manualDetourUndo = null;
        manualDetourLimitNotice = false;
        clearManualDetourMarkers();
        if (window.RouteSafety) {
            RouteSafety.invalidate('manual', []);
            RouteSafety.showConflicts(mapPage2, [], { context: 'manual' });
            renderManualRestrictionStatus([], RouteSafety.enabled() ? 'NO_ROUTE' : 'OFF');
        }
    }

function getRouteSlots(listType) {
        return manualRouteSlots[listType] || createEmptyRouteSlots();
    }

function getRouteSlotEntry(listType, slotIndex) {
        return getRouteSlots(listType)[String(slotIndex + 1)] || null;
    }

function setRouteSlotEntry(listType, slotIndex, slotData) {
        if (!manualRouteSlots[listType]) {
            manualRouteSlots[listType] = createEmptyRouteSlots();
        }
        manualRouteSlots[listType][String(slotIndex + 1)] = {
            location: slotData?.location || null,
            stay: normalizeStayMinutes(slotData?.stay)
        };
    }

function clearRouteSlot(listType, slotIndex) {
        setRouteSlotEntry(listType, slotIndex, { location: null, stay: getDefaultStayMinutes() });
    }

function syncManualWaypointsFromSlots() {
        hydrateManualDetours();
        manualRoute1Waypoints = getRouteWaypointIds('route1');
        manualRoute2Waypoints = getRouteWaypointIds('route2');
        const previousRoutes = Array.isArray(window._activeRoutes) ? window._activeRoutes : [];
        const nextRoutes = assignRouteColors(getActiveManualRouteKeys().map((routeKey) => ({
            id: routeKey,
            index: getRouteKeyIndex(routeKey),
            label: getManualRouteGroupLabel(routeKey),
            color: getRouteColor(getRouteKeyIndex(routeKey)),
            key: routeKey,
            manualDetourKey: `${routeKey}:${getRouteCacheKeyFromStops(getRouteWaypointIds(routeKey))}`,
            stops: getRouteWaypointIds(routeKey).map((customerId) => {
                const customer = getStopDisplayDataById(customerId);
                return {
                    id: customer.uniqueId || customerId,
                    name: customer.Name || '',
                    address: customer.isPlaceholder ? '' : (customer.Address || ''),
                    phone: customer['Hp No'] || '',
                    lat: customer.lat,
                    lng: customer.lng,
                    coordinate: customer.coordinate || '',
                    stayMinutes: getRouteStopStayMinutes({ routeStopConfigs: getFilledRouteStopConfigs(routeKey) }, customerId)
                };
            }).filter(Boolean)
        })).filter((route) => route.stops.length > 0));
        let removedManualDetours = false;
        nextRoutes.forEach((route) => {
            const previousRoute = previousRoutes.find((item) => item && (item.id === route.id || Number(item.index) === Number(route.index)));
            const previousIds = getRouteCacheKeyFromStops(previousRoute?.stops || []);
            const nextIds = getRouteCacheKeyFromStops(route.stops);
            if (previousRoute?.arrangementMode === 'direction-return') {
                route.arrangementMode = 'direction-return';
                route.directionOrder = Array.isArray(previousRoute.directionOrder) ? [...previousRoute.directionOrder] : [...directionOrder];
                route.directionOriginSnapshot = previousRoute.directionOriginSnapshot ? { ...previousRoute.directionOriginSnapshot } : (directionOriginSnapshot ? { ...directionOriginSnapshot } : null);
                route.returnToOrigin = true;
            }
            if (previousRoute && previousIds === nextIds) {
                route.manualWaypoints = (previousRoute.manualWaypoints || []).map((point) => ({ ...point }));
                rememberRouteManualDetours(route);
            } else {
                restoreRouteManualDetours(route);
            }
            if (previousRoute?.directionsResult && previousIds === nextIds) {
                route.directionsResult = previousRoute.directionsResult;
                route.directionsCacheKey = previousRoute.directionsCacheKey || nextIds;
                route.safetyWaypoints = Array.isArray(previousRoute.safetyWaypoints) ? [...previousRoute.safetyWaypoints] : [];
                route.manualWaypoints = Array.isArray(previousRoute.manualWaypoints) ? previousRoute.manualWaypoints.map((point) => ({ ...point })) : [];
                route.lorryValidation = previousRoute.lorryValidation ? { ...previousRoute.lorryValidation } : undefined;
            } else if (previousIds !== nextIds && Array.isArray(previousRoute?.manualWaypoints) && previousRoute.manualWaypoints.length) {
                // A point belongs to one delivery leg. Moving it to a different
                // order would be unsafe, so require the dispatcher to choose it again.
                removedManualDetours = true;
                manualDetoursByRouteKey.delete(getManualDetourRouteKey(previousRoute));
                persistManualDetours();
            }
        });
        if (removedManualDetours) {
            manualDetourTarget = null;
            manualDetourRecheckNotice = true;
            manualDetourUndo = null;
        }
        window._activeRoutes = nextRoutes;
    }

function getAssignedStopIds() {
        return getActiveManualRouteKeys().flatMap((routeKey) => getRouteWaypointIds(routeKey));
    }

function initializePlanningSelectionState() {
    selectedAddresses = new Set(); 
    selectedCustomers = new Set();
}

function initializePlanningDraftState() {
    unassignedStops = []; // Array of customer uniqueIds (not addresses)
    manualRoute1Waypoints = []; // Array of customer uniqueIds
    manualRoute2Waypoints = []; // Array of customer uniqueIds
    manualRouteSlots = {
        route1: createEmptyRouteSlots(),
        route2: createEmptyRouteSlots()
    };
    routeOriginMode = 'current';
    routeStartTime = getPreferredPlanningTime();
    planningDate = getDateKey(new Date());
}

function initializePlanningLocationState() {
    selectedVehicleDriver = localStorage.getItem(VEHICLE_DRIVER_STORAGE_KEY) || DEFAULT_VEHICLE_DRIVER;
    vehicleDriverItems = getStoredVehicleDriverItems();
    vehicleDriverCloudLoadPromise = null;
    customOriginAddress = '';
    customOriginLatLng = null;
    customOriginLabel = '';
    customOriginAutocomplete = null;
    routeEndRequired = true;
    routeEndMode = 'same';
    customEndAddress = '';
    customEndLatLng = null;
    customEndLabel = '';
    customEndAutocomplete = null;
}

function initializePlanningDirectionState() {
    routeArrangementMode = 'standard';
    directionOrder = ['WEST', 'NORTH', 'EAST', 'SOUTH'];
    directionOriginSnapshot = null;
    directionPlanRun = 0;
    directionPlanStale = false;
}

function initializePlanningConfirmationState() {
    currentLocationRequestToken = 0;
    currentRouteConfirmationState = {
        saved: false,
        saving: false,
        historyId: null,
        source: 'draft'
    };
    
    // === ADDED NEW GLOBAL VARIABLE HERE ===
    suggestedWaypointOrder = [];
}

function initializePlanningRoutesBridge() {
    AppState.plannedRoutes = AppState.plannedRoutes || []; 
    currentViewingRouteIndexPage3 = 0;
    activeRouteId = 1;
    
    // Expose plannedRoutes globally for GPS tracking compatibility
    window.plannedRoutes = AppState.plannedRoutes; 

}

