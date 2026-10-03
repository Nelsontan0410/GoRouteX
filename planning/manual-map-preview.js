/**
 * Manual Assignment map preview, physically extracted without behavior changes.
 * Classic-script API: initializeManualMapPreview(element, needsInit),
 * updateRouteLines(options), addSimpleMarkersForMasterList(stops), clearRouteLines().
 * ensureManualRouteCheckCurrent() is the existing finalization review boundary.
 * Loading only declares functions. Existing app bootstrap owns live map/service,
 * preview run/promise/cache, marker and renderer bindings; no duplicate state.
 * Uses planning-state slots; shared MapHandler/RouteEngine/RouteSafety, coordinates,
 * route caches and detour helpers remain where they were. No save/History/Dispatch.
 * Existing 400ms scheduling, keys, run guards and routing counts are unchanged.
 */
function initializeManualMapPreview(manualMapElement, manualMapNeedsInit) {
if (manualMapNeedsInit) {
            mapPage2 = MapHandler.initMap(manualMapElement, {
                center: currentLatLng || { lat: 1.3521, lng: 103.8198 },
                zoom: currentLatLng ? 13 : 11,
                mapTypeControl: false,
                streetViewControl: false,
                mapId: 'MANUAL_ASSIGN_MAP_ID_V3'
            });
            route1DirectionsRenderer = null;
            route2DirectionsRenderer = null;
            optimizedRouteRenderer = null;
            RouteSafety.showConflicts(mapPage2, manualPreviewRoutes, { context: 'manual' });
            bindManualDetourMap();
        }
}

function clearMasterListPreviewMarkers() {
        MapHandler.clearCluster(masterListMarkerCluster);
        masterListMarkerCluster = null;
        masterListPreviewMarkers.forEach((marker) => clearMapMarker(marker));
        masterListPreviewMarkers = [];
    }

function clearRouteLines() {
        if (route1DirectionsRenderer) MapHandler.setDirections(route1DirectionsRenderer, {routes: []});
        if (route2DirectionsRenderer) MapHandler.setDirections(route2DirectionsRenderer, {routes: []});
        if (optimizedRouteRenderer) MapHandler.setDirections(optimizedRouteRenderer, {routes: []});
        clearTestDynamicRouteRenderers(dynamicRouteRenderersPage2);
    }

function renderManualRestrictionStatus(routes = manualPreviewRoutes, forcedState = '') {
        renderManualDetourToolbar(routes);
        const panel = document.getElementById('manualRestrictionStatus');
        const badge = document.getElementById('manualRestrictionBadge');
        const message = document.getElementById('manualRestrictionMessage');
        const results = document.getElementById('manualRestrictionResults');
        if (!panel || !badge || !message || !results || !window.RouteSafety) return;

        const report = RouteSafety.summary(routes);
        const state = forcedState || report.state;
        const copy = {
            OFF: ['Not checked', 'Restriction avoidance is off. Routes are not checked against LTA restriction codes.'],
            NO_ROUTE: ['No route', 'Plan a route to show only restriction points that conflict with your route.'],
            CHECKING: ['Checking', 'Checking the current route against the selected restriction codes…'],
            SAFE: ['Safe', `Route passed the current checks for ${report.config.selectedCodes.join(', ') || 'the selected codes'}.`],
            REROUTED: ['Reminder', 'A route adjustment was previously recorded. Check the pins and add a manual navigation point if required.'],
            PENDING: ['Reminder', 'A restriction remains or the route could not be checked completely. You can still save, navigate and share; add a manual navigation point if needed.']
        }[state] || ['Needs review', 'This route needs manual review.'];
        panel.dataset.state = state;
        badge.textContent = copy[0];
        message.textContent = copy[1];
        if (manualDetourTarget) message.textContent = `Click the road where this route should pass for Route ${manualDetourTarget.routeId}, leg ${manualDetourTarget.legIndex + 1}.`;
        if (manualDetourRecheckNotice) message.textContent = 'The delivery order changed. Previous manual detours were cleared; choose new detour points for the new route legs.';
        if (manualDetourLimitNotice) message.textContent = `A route can use up to ${MAX_MANUAL_DETOURS_PER_ROUTE} manual detour points so Google can keep every point in the route.`;
        results.replaceChildren();

        const detours = manualDetourCount(routes);
        if (detours || manualDetourTarget) {
            const tools = document.createElement('p');
            tools.className = 'manual-detour-tools';
            tools.textContent = `${detours} manual detour point${detours === 1 ? '' : 's'}${manualDetourTarget ? ' · choose a road point on the map' : ''}`;
            const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear manual detours';
            clear.addEventListener('click', clearAllManualDetours);
            tools.append(' ', clear); results.append(tools);
        }
        if (manualDetourUndo?.length) {
            const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = 'Undo detour edit';
            undo.addEventListener('click', undoManualDetourEdit);
            results.append(undo);
        }

        for (const route of routes) {
            const validation = route?.lorryValidation;
            if (!validation || validation.status === 'LOADING' || validation.status === 'NOT_CHECKED') continue;
            const detail = document.createElement('details');
            if (state === 'PENDING') detail.open = true;
            const summary = document.createElement('summary');
            const legs = route.directionsResult?.routes?.[0]?.legs || [];
            const distanceKm = legs.reduce((total, leg) => total + (leg.distance?.value || 0), 0) / 1000;
            const durationMinutes = Math.round(legs.reduce((total, leg) => total + (leg.duration?.value || 0), 0) / 60);
            summary.textContent = `${route.label || `Route ${route.id}`}: ${validation.status} · ${validation.conflicts?.length || 0} conflict points · ${distanceKm.toFixed(1)} km · ${durationMinutes} min`;
            detail.append(summary);
            const reasons = [
                ...(validation.conflicts || []).map((conflict) => `${conflict.signCode} · LTA ${conflict.restrictionId}: ${conflict.reason}`),
                ...(validation.issues || []),
                ...(validation.rerouteReason ? [validation.rerouteReason] : [])
            ];
            if (validation.avoidedConflicts > 0 && !validation.conflicts?.length) {
                reasons.unshift(`${validation.avoidedConflicts} conflict point(s) avoided using ${validation.reroutes || 0} extra Google request(s).`);
            }
            for (const reason of [...new Set(reasons.filter(Boolean))]) {
                const row = document.createElement('p');
                row.textContent = reason;
                detail.append(row);
            }
            results.append(detail);
        }
    }

function clearManualRouteDrawing() {
        if (route1DirectionsRenderer) MapHandler.setDirections(route1DirectionsRenderer, {routes: []});
        if (route2DirectionsRenderer) MapHandler.setDirections(route2DirectionsRenderer, {routes: []});
        clearTestDynamicRouteRenderers(dynamicRouteRenderersPage2);
    }

function drawManualPreviewRoutes(routes) {
        clearManualRouteDrawing();
        routes.forEach((route) => {
            if (!route?.directionsResult || !mapPage2) return;
            renderRouteLegColors(route, mapPage2, dynamicRouteRenderersPage2, {
                strokeOpacity: 0.9,
                strokeWeight: 5
            });
        });
        RouteSafety.showConflicts(mapPage2, routes, { context: 'manual' });
        renderManualDetourMarkers(routes);
    }

function getManualRouteInputKey(activeRoutes) {
        const configuredEndId = getCurrentConfiguredEndLocationId();
        return JSON.stringify({
            origin: getLocationInput(currentLocationOrigin),
            end: configuredEndId,
            endLocation: configuredEndId ? getLocationInput(configuredEndId) : null,
            routes: activeRoutes.map((route) => ({
                ids: getRouteCacheKeyFromStops(route.stops),
                locations: route.stops.map(getDynamicRouteStopInput),
                manualWaypoints: route.manualWaypoints || [],
                arrangementMode: route.arrangementMode || 'standard',
                directionOrder: route.directionOrder || [],
                directionOriginSnapshot: route.directionOriginSnapshot || null,
                returnToOrigin: !!route.returnToOrigin
            })),
            restriction: RouteSafety.settings(),
            rulesVersion: RouteSafety.rulesVersion
        });
    }

async function calculateManualRouteLines(run, activeRoutes, inputKey) {
        if (!activeRoutes.length || !currentLocationOrigin || !mapPage2) {
            manualPreviewRoutes = [];
            manualRouteCompletedKey = inputKey;
            RouteSafety.bindRoutes('manual', []);
            RouteSafety.showConflicts(mapPage2, [], { context: 'manual' });
            renderManualRestrictionStatus([], RouteSafety.enabled() ? 'NO_ROUTE' : 'OFF');
            return [];
        }

        let previousRouteLastStop = null;
        for (let index = 0; index < activeRoutes.length; index += 1) {
            if (run !== manualRouteRun) return [];
            const route = activeRoutes[index];
            const stops = Array.isArray(route?.stops) ? route.stops : [];
            const isLastRoute = index === activeRoutes.length - 1;
            const returnToOrigin = isLastRoute && route.returnToOrigin && route.directionOriginSnapshot;
            const configuredEndId = returnToOrigin
                ? route.directionOriginSnapshot.identifier
                : (isLastRoute ? getCurrentConfiguredEndLocationId() : null);
            const originIdentifier = index === 0 ? currentLocationOrigin : getPackedRouteStopId(previousRouteLastStop);
            const origin = index === 0
                ? (route.directionOriginSnapshot || getLocationInput(currentLocationOrigin))
                : (getDynamicRouteStopInput(previousRouteLastStop) || getLocationInput(currentLocationOrigin));
            const destination = returnToOrigin
                ? route.directionOriginSnapshot
                : (configuredEndId ? getLocationInput(configuredEndId) : getDynamicRouteStopInput(stops.at(-1)));
            const waypointStops = configuredEndId ? stops : stops.slice(0, -1);
            const waypoints = waypointStops.map((stop) => {
                const location = getDynamicRouteStopInput(stop);
                return location ? { location, stopover: true } : null;
            }).filter(Boolean);
            const stopIds = stops.map(getPackedRouteStopId).filter(Boolean);
            const routeDefinition = RouteEngine.buildRouteRequest({
                originIdentifier, stopIds, configuredEndId, origin, destination, waypoints,
                manualWaypoints: route.manualWaypoints || []
            });
            route.optimizedStops = routeDefinition.optimizedStops;
            route.originalWaypoints = stopIds;
            route.customerStops = stops;
            try {
                let timeout;
                const result = getRouteDirectionsFromCache(route, routeDefinition.cacheKey) || await Promise.race([
                    MapHandler.route(previewDirectionsService, routeDefinition.request),
                    new Promise((_, reject) => {
                        timeout = setTimeout(() => reject(new Error('Google routing timed out.')), 25000);
                    })
                ]).finally(() => clearTimeout(timeout));
                if (run !== manualRouteRun) return [];
                setRouteDirectionsCache(route, result, routeDefinition.cacheKey);
            } catch (error) {
                route.directionsResult = null;
                route.lorryValidation = { status: 'WARNING', safe: false, conflicts: [], issues: [error.message || 'Google route request failed.'] };
                appLog(`Error updating ${route.label || `Route ${index + 1}`} line:`, error);
            }
            previousRouteLastStop = stops.at(-1);
        }

        if (run !== manualRouteRun) return [];
        manualPreviewRoutes = activeRoutes;
        window._activeRoutes = activeRoutes;
        RouteSafety.bindRoutes('manual', manualPreviewRoutes);
        RouteSafety.showConflicts(mapPage2, manualPreviewRoutes, { context: 'manual' });
        await RouteSafety.validateRoutes(manualPreviewRoutes, { context: 'manual', forceRefresh: false, reuse: true });
        if (run !== manualRouteRun) return [];
        manualRouteCompletedKey = inputKey;
        drawManualPreviewRoutes(manualPreviewRoutes);
        renderManualRestrictionStatus(manualPreviewRoutes);
        updateConfirmRouteButtonState();
        return manualPreviewRoutes;
    }

function updateRouteLines(options = {}) {
        if (suggestedWaypointOrder.length === 0 && optimizedRouteRenderer) MapHandler.setDirections(optimizedRouteRenderer, {routes: []});
        syncManualWaypointsFromSlots();
        const activeRoutes = assignRouteColors(Array.isArray(window._activeRoutes) ? window._activeRoutes : []);
        const inputKey = getManualRouteInputKey(activeRoutes);
        const completedCheckIsCurrent = !RouteSafety.enabled() || manualPreviewRoutes.every((route) => RouteSafety.isCurrent(route));
        if (inputKey === manualRouteCompletedKey && manualPreviewRoutes.length === activeRoutes.length && completedCheckIsCurrent) {
            drawManualPreviewRoutes(manualPreviewRoutes);
            renderManualRestrictionStatus(manualPreviewRoutes);
            return Promise.resolve(manualPreviewRoutes);
        }
        if (inputKey === manualRouteInFlightKey && manualRoutePromise) return manualRoutePromise;

        const run = ++manualRouteRun;
        manualRouteInFlightKey = inputKey;
        manualRouteCompletedKey = '';
        if (manualRouteUpdateTimer) clearTimeout(manualRouteUpdateTimer);
        if (manualRoutePendingResolve) manualRoutePendingResolve([]);
        RouteSafety.invalidate('manual', manualPreviewRoutes);
        RouteSafety.showConflicts(mapPage2, [], { context: 'manual' });
        clearManualRouteDrawing();
        renderManualRestrictionStatus(activeRoutes, !RouteSafety.enabled() ? 'OFF' : (activeRoutes.length ? 'CHECKING' : 'NO_ROUTE'));

        manualRoutePromise = new Promise((resolve) => {
            manualRoutePendingResolve = resolve;
            const start = () => {
                manualRouteUpdateTimer = null;
                calculateManualRouteLines(run, activeRoutes, inputKey)
                    .then(resolve)
                    .catch((error) => {
                        if (run === manualRouteRun) {
                            activeRoutes.forEach((route) => {
                                route.lorryValidation = { status: 'WARNING', safe: false, conflicts: [], issues: [error.message || 'Route check failed.'] };
                            });
                            manualPreviewRoutes = activeRoutes;
                            drawManualPreviewRoutes(activeRoutes);
                            renderManualRestrictionStatus(activeRoutes, 'PENDING');
                        }
                        resolve(activeRoutes);
                    })
                    .finally(() => {
                        if (run === manualRouteRun) {
                            manualRouteInFlightKey = '';
                            manualRoutePendingResolve = null;
                        }
                    });
            };
            if (options.immediate) start();
            else manualRouteUpdateTimer = setTimeout(start, 400);
        });
        return manualRoutePromise;
    }

async function ensureManualRouteCheckCurrent() {
        syncManualWaypointsFromSlots();
        const activeRoutes = assignRouteColors(Array.isArray(window._activeRoutes) ? window._activeRoutes : []);
        const inputKey = getManualRouteInputKey(activeRoutes);
        const completedCheckIsCurrent = !RouteSafety.enabled() || manualPreviewRoutes.every((route) => RouteSafety.isCurrent(route));
        if (manualRouteCompletedKey === inputKey && manualPreviewRoutes.length === activeRoutes.length && completedCheckIsCurrent) return manualPreviewRoutes;
        return updateRouteLines({ immediate: true });
    }

function createManualStopMarker(stop, position, pinColor) {
        const title = `${stop.stopNo}. ${stop.name}`;
        const markerOptions = {
            position,
            map: mapPage2,
            title,
            zIndex: 1000 + stop.index
        };

        if (window.google?.maps?.CollisionBehavior?.REQUIRED) {
            markerOptions.collisionBehavior = google.maps.CollisionBehavior.REQUIRED;
        }

        let marker = MapHandler.createAdvancedMarker(markerOptions);
        if (marker) {
            const pin = MapHandler.createPin({
                background: pinColor,
                borderColor: '#000',
                glyph: String(stop.stopNo),
                glyphColor: '#fff'
            });
            if (pin?.element) marker.content = pin.element;
        } else {
            marker = MapHandler.createMarker({
                position,
                map: mapPage2,
                title,
                label: {
                    text: String(stop.stopNo),
                    color: 'white',
                    fontWeight: 'bold'
                }
            });
        }

        if (marker) {
            marker.id = `${stop.stopNo}_${stop.index}`;
            marker.stopId = stop.customerId;
        }
        return marker;
    }

async function addSimpleMarkersForMasterList(stops) {
        const renderRequestId = ++masterListMarkerRenderRequestId;
        clearMasterListPreviewMarkers();
        if (!mapPage2 || !stops) return;

        const routeStops = (Array.isArray(stops) ? stops : [])
            .map((stop, index) => {
                const customerId = getStopIdentifier(stop);
                const customer = getStopDisplayDataById(customerId);
                return {
                    index,
                    customerId,
                    customer,
                    stopNo: getStopMapMarkerNumber(customerId),
                    name: customer?.Name || 'Selected stop',
                    address: customer?.Address || ''
                };
            })
            .filter((stop) => stop.customerId);

        const bounds = MapHandler.createLatLngBounds();
        const markers = [];
        const coordinateUseCounts = new Map();
        if (currentPositionMarkerPage2 && currentPositionMarkerPage2.position) {
            MapHandler.extendBounds(bounds, currentPositionMarkerPage2.position);
        }

        for (const stop of routeStops) {
            const customer = stop.customer;

            try {
                let location = getCustomerCoordinateLiteral(customer);
                if (!location && customer?.Address && !customer.isPlaceholder && geocoder) {
                    const response = await MapHandler.geocode(geocoder, { address: customer.Address });
                    if (renderRequestId !== masterListMarkerRenderRequestId) {
                        markers.forEach((marker) => clearMapMarker(marker));
                        return;
                    }
                    location = getLatLngLiteral(response?.results?.[0]?.geometry?.location);
                }

                const markerPosition = getJitteredMarkerPosition(location, coordinateUseCounts);
                stop.lat = markerPosition?.lat ?? null;
                stop.lng = markerPosition?.lng ?? null;

                if (!markerPosition) {
                    console.warn('Marker location unavailable', stop.stopNo, stop.name, stop.address);
                    continue;
                }

                console.log(
                    "Rendering marker",
                    stop.stopNo,
                    stop.name,
                    stop.lat,
                    stop.lng
                );

                const marker = createManualStopMarker(
                    stop,
                    markerPosition,
                    getRouteColorForCustomerId(stop.customerId)
                );

                if (!marker) {
                    console.warn('Marker could not be created', stop.stopNo, stop.name);
                    continue;
                }

                markers.push(marker);
                masterListPreviewMarkers.push(marker);
                MapHandler.extendBounds(bounds, markerPosition);
            } catch (e) {
                appLog(`Failed to place marker for "${stop.name}" on Page 2 map: ${e}`);
            }
        }

        if (renderRequestId !== masterListMarkerRenderRequestId) {
            markers.forEach((marker) => clearMapMarker(marker));
            return;
        }

        console.log(
            "Expected markers:",
            routeStops.length,
            "Rendered markers:",
            markers.length
        );

        if (routeStops.length !== markers.length) {
            console.warn("Marker count mismatch detected", {
                expected: routeStops.length,
                rendered: markers.length,
                missingStops: routeStops.filter((stop) => !markers.some((marker) => marker.id === `${stop.stopNo}_${stop.index}`))
            });
            if (typeof showToast === 'function') {
                showToast('Marker count mismatch detected', 'warning', 4200);
            } else if (messageBarPg2) {
                messageBarPg2.textContent = 'Marker count mismatch detected';
            }
        }

        if (markers.length > 0 || (currentPositionMarkerPage2 && currentPositionMarkerPage2.position)) {
            fitMapToMarkers(mapPage2, markers.concat(currentPositionMarkerPage2 ? [currentPositionMarkerPage2] : []));
        } else if (currentLatLng) {
            MapHandler.setCenter(mapPage2, currentLatLng);
            MapHandler.setZoom(mapPage2, 12);
        }

        MapHandler.applyMarkerCluster(mapPage2, markers).then((cluster) => {
            if (renderRequestId === masterListMarkerRenderRequestId) {
                masterListMarkerCluster = cluster;
            } else {
                MapHandler.clearCluster(cluster);
            }
        });
    }
