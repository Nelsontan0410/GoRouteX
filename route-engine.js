(function (global) {
  let routePlan = {
    selectedStops: [],
    routes: []
  };

  function getStopLatLng(stop) {
    const lat = Number(stop?.lat);
    const lng = Number(stop?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }

    if (stop?.coordinate) {
      const parts = String(stop.coordinate).split(',').map((part) => Number(part.trim()));
      if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        return { lat: parts[0], lng: parts[1] };
      }
    }

    return null;
  }

  function getDistanceSquared(a, b) {
    const latDistance = a.lat - b.lat;
    const lngDistance = a.lng - b.lng;
    return latDistance * latDistance + lngDistance * lngDistance;
  }

  const DIRECTION_ORDER_DEFAULT = ['WEST', 'NORTH', 'EAST', 'SOUTH'];

  function normalizeDirectionOrder(order) {
    const values = Array.isArray(order) ? order.map((value) => String(value || '').toUpperCase()) : [];
    const accepted = values.filter((value, index) => DIRECTION_ORDER_DEFAULT.includes(value) && values.indexOf(value) === index);
    return [...accepted, ...DIRECTION_ORDER_DEFAULT.filter((value) => !accepted.includes(value))];
  }

  function bearingDegrees(origin, destination) {
    const start = getStopLatLng(origin) || origin;
    const end = getStopLatLng(destination) || destination;
    if (!start || !end || !Number.isFinite(Number(start.lat)) || !Number.isFinite(Number(start.lng))
      || !Number.isFinite(Number(end.lat)) || !Number.isFinite(Number(end.lng))) return null;
    const radians = Math.PI / 180;
    const lat1 = Number(start.lat) * radians;
    const lat2 = Number(end.lat) * radians;
    const deltaLng = (Number(end.lng) - Number(start.lng)) * radians;
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
      - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    return (Math.atan2(y, x) / radians + 360) % 360;
  }

  function directionForBearing(bearing) {
    if (!Number.isFinite(Number(bearing))) return null;
    const value = ((Number(bearing) % 360) + 360) % 360;
    if (value >= 315 || value < 45) return 'NORTH';
    if (value < 135) return 'EAST';
    if (value < 225) return 'SOUTH';
    return 'WEST';
  }

  function classifyStopsByDirection(stops, origin, order = DIRECTION_ORDER_DEFAULT) {
    const originPoint = getStopLatLng(origin) || origin;
    const normalizedOrder = normalizeDirectionOrder(order);
    const groups = Object.fromEntries(normalizedOrder.map((direction) => [direction, []]));
    const atOrigin = [];
    const unresolved = [];
    (Array.isArray(stops) ? stops : []).forEach((stop, originalIndex) => {
      const point = getStopLatLng(stop);
      if (!point || !originPoint || !Number.isFinite(Number(originPoint.lat)) || !Number.isFinite(Number(originPoint.lng))) {
        unresolved.push({ stop, originalIndex });
        return;
      }
      const latDelta = Math.abs(point.lat - Number(originPoint.lat));
      const lngDelta = Math.abs(point.lng - Number(originPoint.lng));
      if (latDelta < 0.0000001 && lngDelta < 0.0000001) {
        atOrigin.push({ stop, originalIndex, bearing: null });
        return;
      }
      const bearing = bearingDegrees(originPoint, point);
      const direction = directionForBearing(bearing);
      if (!direction) {
        unresolved.push({ stop, originalIndex });
        return;
      }
      groups[direction].push({ stop, originalIndex, bearing });
    });
    return { order: normalizedOrder, atOrigin, groups, unresolved };
  }

  function flattenDirectionGroups(classification) {
    if (!classification) return [];
    return [
      ...(classification.atOrigin || []),
      ...(classification.order || []).flatMap((direction) => classification.groups?.[direction] || [])
    ].map((entry) => entry.stop);
  }

  function clusterStops(stops, maxPerRoute = 8) {
    const safeStops = Array.isArray(stops) ? stops : [];
    const safeMax = Number.isFinite(Number(maxPerRoute)) && Number(maxPerRoute) > 0
      ? Number(maxPerRoute)
      : 8;
    const stopsWithCoords = safeStops
      .map((stop, originalIndex) => ({
        stop,
        originalIndex,
        point: getStopLatLng(stop)
      }))
      .filter((entry) => entry.point);
    const stopsWithoutCoords = safeStops
      .map((stop, originalIndex) => ({
        stop,
        originalIndex,
        point: getStopLatLng(stop)
      }))
      .filter((entry) => !entry.point);

    if (stopsWithCoords.length === 0) {
      return [{ clusterId: 1, stops: safeStops }];
    }

    const clusterCount = Math.max(1, Math.ceil(safeStops.length / safeMax));
    const sortedByLongitude = [...stopsWithCoords].sort((a, b) => a.point.lng - b.point.lng);
    let centroids = Array.from({ length: clusterCount }, (_, index) => {
      const centroidIndex = Math.min(
        sortedByLongitude.length - 1,
        Math.floor((index + 0.5) * sortedByLongitude.length / clusterCount)
      );
      return { ...sortedByLongitude[centroidIndex].point };
    });

    let clusters = [];
    for (let iteration = 0; iteration < 12; iteration += 1) {
      clusters = Array.from({ length: clusterCount }, (_, index) => ({
        clusterId: index + 1,
        entries: []
      }));

      stopsWithCoords.forEach((entry) => {
        let nearestIndex = 0;
        let nearestDistance = Infinity;
        centroids.forEach((centroid, index) => {
          const distance = getDistanceSquared(entry.point, centroid);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
          }
        });
        clusters[nearestIndex].entries.push(entry);
      });

      centroids = clusters.map((cluster, index) => {
        if (cluster.entries.length === 0) return centroids[index];
        const total = cluster.entries.reduce((sum, entry) => ({
          lat: sum.lat + entry.point.lat,
          lng: sum.lng + entry.point.lng
        }), { lat: 0, lng: 0 });
        return {
          lat: total.lat / cluster.entries.length,
          lng: total.lng / cluster.entries.length
        };
      });
    }

    stopsWithoutCoords.forEach((entry) => {
      clusters[clusters.length - 1].entries.push(entry);
    });

    return clusters
      .filter((cluster) => cluster.entries.length > 0)
      .map((cluster, index) => ({
        clusterId: index + 1,
        stops: cluster.entries
          .sort((a, b) => a.originalIndex - b.originalIndex)
          .map((entry) => entry.stop)
      }));
  }

  function autoSplitStops(stops, maxPerRoute = 8) {
    const safeStops = Array.isArray(stops) ? stops : [];
    const safeMax = Number.isFinite(Number(maxPerRoute)) && Number(maxPerRoute) > 0
      ? Number(maxPerRoute)
      : 8;
    const clusters = clusterStops(safeStops, safeMax);
    const routes = [];

    clusters.forEach((cluster) => {
      for (let index = 0; index < cluster.stops.length; index += safeMax) {
        routes.push({
          id: `route-${routes.length + 1}`,
          index: routes.length,
          label: `Route Group ${routes.length + 1}`,
          clusterId: cluster.clusterId,
          stops: cluster.stops.slice(index, index + safeMax)
        });
      }
    });

    console.log('CLUSTERED ROUTES:', routes);

    return routes;
  }

  function setSelectedStops(stops) {
    routePlan.selectedStops = Array.isArray(stops) ? [...stops] : [];
    return routePlan.selectedStops;
  }

  function generateRoutes(maxPerRoute = 8) {
    routePlan.routes = autoSplitStops(routePlan.selectedStops, maxPerRoute);
    return routePlan.routes;
  }

  function splitOptimizedStops(stops, maxPerRoute = 8) {
    const safeStops = Array.isArray(stops) ? stops : [];
    const safeMax = Number.isFinite(Number(maxPerRoute)) && Number(maxPerRoute) > 0
      ? Number(maxPerRoute)
      : 8;
    const routes = [];
    for (let index = 0; index < safeStops.length; index += safeMax) {
      routes.push(safeStops.slice(index, index + safeMax));
    }
    return routes;
  }

  function getPackedRouteStopId(stop) {
    if (!stop) return '';
    if (typeof stop === 'string') return stop;
    return stop.id || stop.uniqueId || stop.customerId || stop.stopId || '';
  }

  function getRouteMaxStops(activeRoutes, fallback = 8) {
    const configuredMax = (Array.isArray(activeRoutes) ? activeRoutes : [])
      .map((route) => Number(route?.maxStops))
      .find((value) => Number.isFinite(value) && value > 0);
    return configuredMax || fallback;
  }

  function hasRoutePackingIssue(routes, maxPerRoute = 8) {
    const safeRoutes = Array.isArray(routes) ? routes : [];
    return safeRoutes.some((route, index) => {
      const stopsCount = Array.isArray(route?.stops) ? route.stops.filter(Boolean).length : 0;
      return index < safeRoutes.length - 1 && stopsCount < maxPerRoute;
    });
  }

  function splitOptimizedStopsIntoPackedRoutes(optimizedStops, maxStopsPerRoute = 8) {
    const safeStops = Array.isArray(optimizedStops) ? optimizedStops.filter(Boolean) : [];
    const safeMax = Number.isFinite(Number(maxStopsPerRoute)) && Number(maxStopsPerRoute) > 0
      ? Math.floor(Number(maxStopsPerRoute))
      : 8;
    const routes = [];

    for (let index = 0; index < safeStops.length; index += safeMax) {
      const stops = safeStops.slice(index, index + safeMax);
      if (stops.length > 0) {
        routes.push({
          id: routes.length + 1,
          index: routes.length,
          label: `Route ${routes.length + 1}`,
          stops: [...stops],
          stopIds: stops.map((stop) => getPackedRouteStopId(stop)).filter(Boolean),
          maxStops: safeMax
        });
      }
    }

    return routes;
  }

  function buildRouteRequest({ originIdentifier, stopIds, configuredEndId, origin, destination, waypoints, manualWaypoints }) {
    const safeStopIds = Array.isArray(stopIds) ? stopIds.filter(Boolean) : [];
    const deliveryWaypoints = Array.isArray(waypoints) ? waypoints.filter(Boolean) : [];
    const manual = Array.isArray(manualWaypoints)
      ? manualWaypoints.filter((point) => Number.isInteger(point?.legIndex) && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)))
      : [];
    // Directions does not have a notion of a non-stop point belonging to a leg.
    // Interleave it immediately before that leg's following delivery stop so the
    // delivery order remains untouched.
    const safeWaypoints = [];
    for (let legIndex = 0; legIndex <= deliveryWaypoints.length; legIndex += 1) {
      for (const point of manual.filter((item) => item.legIndex === legIndex)) {
        safeWaypoints.push({ location: { lat: Number(point.lat), lng: Number(point.lng) }, stopover: false });
      }
      if (legIndex < deliveryWaypoints.length) safeWaypoints.push(deliveryWaypoints[legIndex]);
    }
    const resolved = { origin, destination, waypoints: safeWaypoints, manualWaypoints: manual };
    return {
      request: { origin, destination, waypoints: safeWaypoints, optimizeWaypoints: false, travelMode: 'DRIVING' },
      cacheKey: [originIdentifier || '', safeStopIds.join('|'), configuredEndId || '', JSON.stringify(resolved)].join('|'),
      optimizedStops: [originIdentifier, ...safeStopIds, configuredEndId].filter(Boolean)
    };
  }

  async function buildPlannedRoutes() {
    const rawActiveRoutes = Array.isArray(window._activeRoutes) ? window._activeRoutes : [];
    const maxStopsPerRoute = getRouteMaxStops(rawActiveRoutes, 8);
    if (hasRoutePackingIssue(rawActiveRoutes, maxStopsPerRoute)) {
      console.warn('Route packing issue detected', rawActiveRoutes);
    }
    // Manual assignment owns the route groups and delivery order. Keep those exact
    // objects so its checked Directions result and avoidance waypoints can be reused
    // when the user confirms the route.
    const activeRoutes = assignRouteColors(rawActiveRoutes
      .filter((route) => Array.isArray(route?.stops) && route.stops.length > 0)
      .map((route, index) => ({
        ...route,
        id: index + 1,
        index,
        label: route.label || `Route Group ${index + 1}`,
        stops: [...route.stops],
        stopIds: route.stops.map((stop) => getPackedRouteStopId(stop)).filter(Boolean),
        maxStops: route.maxStops || maxStopsPerRoute
      })));
    window._activeRoutes = activeRoutes;
    console.table(window._activeRoutes.map(r => ({
      route: r.label,
      stops: r.stops.length
    })));
    const dynamicRouteErrors = [];
    AppState.plannedRoutes = [];
    window.plannedRoutes = AppState.plannedRoutes;

    let previousRouteLastStop = null;
    const getDynamicStopId = (stop) => getPackedRouteStopId(stop) || null;

    for (let index = 0; index < activeRoutes.length; index += 1) {
      const route = activeRoutes[index];
      const stops = Array.isArray(route?.stops) ? route.stops : [];
      if (stops.length === 0) {
        console.warn('SAFE SKIP: Dynamic route has no stops', route);
        continue;
      }

      const isLastDynamicRoute = index === activeRoutes.length - 1;
      const returnToOrigin = isLastDynamicRoute && route.returnToOrigin && route.directionOriginSnapshot;
      const configuredEndId = returnToOrigin
        ? route.directionOriginSnapshot.identifier
        : (isLastDynamicRoute ? getCurrentConfiguredEndLocationId() : null);
      const currentEndLabel = returnToOrigin
        ? (route.directionOriginSnapshot.label || 'Start')
        : (configuredEndId ? getCurrentConfiguredEndLocationLabel() : '');
      const stopIds = stops.map(getDynamicStopId).filter(Boolean);
      const originStop = index === 0 ? null : previousRouteLastStop;
      const originForApi = index === 0
        ? (route.directionOriginSnapshot || getLocationInput(currentLocationOrigin))
        : (getDynamicRouteStopInput(originStop) || getLocationInput(currentLocationOrigin));
      const destinationStop = stops[stops.length - 1];
      const destinationForApi = returnToOrigin
        ? route.directionOriginSnapshot
        : (configuredEndId
          ? getLocationInput(configuredEndId)
          : getDynamicRouteStopInput(destinationStop));
      const waypointStops = configuredEndId ? stops : stops.slice(0, -1);
      const waypointsForApi = waypointStops
        .map((stop) => {
          const location = getDynamicRouteStopInput(stop);
          return location ? { location, stopover: true } : null;
        })
        .filter(Boolean);

      if (!originForApi || !destinationForApi) {
        const errorMessage = `Dynamic Route ${index + 1} skipped: missing origin or destination.`;
        dynamicRouteErrors.push(errorMessage);
        console.warn('SAFE SKIP:', errorMessage, { route, originForApi, destinationForApi });
        previousRouteLastStop = destinationStop;
        continue;
      }

      try {
        const originIdentifier = index === 0
          ? currentLocationOrigin
          : getDynamicStopId(originStop);
        const routeDefinition = buildRouteRequest({
          originIdentifier,
          stopIds,
          configuredEndId,
          origin: originForApi,
          destination: destinationForApi,
          waypoints: waypointsForApi,
          manualWaypoints: route.manualWaypoints || []
        });
        const directionsResultDynamic = getRouteDirectionsFromCache(route, routeDefinition.cacheKey)
          || await MapHandler.route(directionsService, routeDefinition.request);
        setRouteDirectionsCache(route, directionsResultDynamic, routeDefinition.cacheKey);

        AppState.plannedRoutes.push({
          id: index + 1,
          label: route.label || `Route Group ${index + 1}`,
          color: route.color || getRouteColor(index),
          directionsCacheKey: routeDefinition.cacheKey,
          originalWaypoints: stopIds,
          optimizedStops: routeDefinition.optimizedStops,
          directionsResult: directionsResultDynamic,
          safetyWaypoints: [],
          manualWaypoints: Array.isArray(route.manualWaypoints) ? route.manualWaypoints.map((point) => ({ ...point })) : [],
          manualDetourKey: route.manualDetourKey || null,
          lorryValidation: route.lorryValidation ? { ...route.lorryValidation } : undefined,
          scheduleHtml: "",
          finalEtaAtLastStop: null,
          finalEtaAtHq: null,
          detailedStopTimes: [],
          customerStops: stops,
          routeStopConfigs: stops.map((stop) => ({
            customerId: getDynamicStopId(stop),
            stayMinutes: normalizeStayMinutes(stop?.stayMinutes || stop?.stayTime || DEFAULT_STAY_MINUTES)
          })),
          date: getSelectedPlanningDate(),
          planningDate: getSelectedPlanningDate(),
          startTime: routeStartTime,
          driverId: getSelectedDriverId(),
          routeStartTime,
          vehicleDriver: getSelectedDriverId(),
          originMode: routeOriginMode,
          endLocationRequired: !!configuredEndId,
          endLocationMode: configuredEndId ? routeEndMode : 'same',
          endLocationId: configuredEndId || null,
          endLocationAddress: configuredEndId && routeEndMode === 'custom' ? customEndAddress : '',
          endLocationLatLng: configuredEndId && routeEndMode === 'custom' && customEndLatLng ? { ...customEndLatLng } : null,
          endLocationLabel: currentEndLabel
          ,arrangementMode: route.arrangementMode || 'standard'
          ,directionOrder: Array.isArray(route.directionOrder) ? [...route.directionOrder] : []
          ,directionOriginSnapshot: route.directionOriginSnapshot ? { ...route.directionOriginSnapshot } : null
          ,returnToOrigin: !!returnToOrigin
        });
      } catch (error) {
        const errorMessage = `Failed to plan Dynamic Route ${index + 1}: ${error.message || error.code || 'Unknown API Error'}`;
        dynamicRouteErrors.push(errorMessage);
        appLog(errorMessage, error);
      }

      previousRouteLastStop = destinationStop;
    }

    syncConfiguredEndLocationLabel();
    assignRouteColors(AppState.plannedRoutes);
    window.plannedRoutes = AppState.plannedRoutes;
    window._testRoutes = activeRoutes;
    appLog("Final plannedRoutes (dynamic order):", buildCompactPlannedRoutesSnapshot(AppState.plannedRoutes));

    return {
      plannedRoutes: AppState.plannedRoutes,
      route1Success: AppState.plannedRoutes.some((route) => route && route.id === 1 && route.directionsResult),
      route2Success: AppState.plannedRoutes.some((route) => route && route.id === 2 && route.directionsResult),
      route1ErrorMessage: dynamicRouteErrors[0] || "",
      route2ErrorMessage: dynamicRouteErrors[1] || "",
      hasDynamicTestRoutes: true
    };
  }

  function logRoutes() {
    console.log('GoRouteX Route Engine routePlan:', routePlan);
    console.table(routePlan.routes.map((route) => ({
      id: route.id,
      label: route.label,
      stopCount: route.stops.length,
      stops: route.stops.map((stop) => stop.name || stop.id || 'Unnamed')
    })));
    routePlan.routes.forEach((route) => {
      console.log(
        `${route.label} (${route.stops.length} stops):`,
        route.stops.map((stop) => stop.name || stop.id || 'Unnamed')
      );
    });
    return routePlan.routes;
  }

  global.GoRouteXRouteEngine = {
    setSelectedStops,
    generateRoutes,
    logRoutes,
    autoSplitStops,
    clusterStops,
    getRoutePlan: function () {
      return {
        selectedStops: [...routePlan.selectedStops],
        routes: routePlan.routes.map((route) => ({
          ...route,
          stops: [...route.stops]
        }))
      };
    }
  };

  global.RouteEngine = {
    splitOptimizedStops,
    splitOptimizedStopsIntoPackedRoutes,
    buildRouteRequest,
    buildPlannedRoutes,
    DIRECTION_ORDER_DEFAULT,
    normalizeDirectionOrder,
    bearingDegrees,
    directionForBearing,
    classifyStopsByDirection,
    flattenDirectionGroups
  };
})(window);
