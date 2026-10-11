/**
 * One driver's day as a single dispatched route (decided 2026-10-11).
 *
 * Route Planning works in groups of 10 stops (Route 1, Route 2, …) where Route k starts at Route k-1's last
 * stop. Dispatch and the driver see the whole day as one list; the split into Google Maps parts happens only
 * when the driver navigates (driver/navigation.js).
 *
 * Shared by the Dispatch page (classic script) and netlify/functions/dispatch.js (imported for its side
 * effect): globalThis.GoRouteXDayRoute.
 */
(function (root) {
  const DAY_ROUTE_ID = 'day';
  const text = (value) => String(value ?? '').trim();

  function legsOf(route) {
    return Array.isArray(route?.directionsResult?.routes?.[0]?.legs) ? route.directionsResult.routes[0].legs : [];
  }
  function routeDistance(route) {
    return Number(route?.estimatedDistanceMeters) || legsOf(route).reduce((sum, leg) => sum + Number(leg?.distance?.value || 0), 0);
  }
  function routeDriving(route) {
    return Number(route?.estimatedDurationSeconds) || legsOf(route).reduce((sum, leg) => sum + Number(leg?.duration?.value || 0), 0);
  }
  const toTime = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(typeof value?.toDate === 'function' ? value.toDate() : value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  };

  /**
   * Whole working time from leaving the start to the end of the day, in seconds: driving, waiting, service
   * time and breaks as planned. Null when the plan has no timings.
   */
  function dayElapsedSeconds(routes) {
    const list = (routes || []).filter(Boolean);
    const first = list[0]?.detailedStopTimes?.[0];
    const lastTimes = list[list.length - 1]?.detailedStopTimes || [];
    const last = lastTimes[lastTimes.length - 1];
    const start = toTime(first?.departureTime);
    if (start === null || !last) return null;
    let end = toTime(last.departureTime) ?? toTime(last.arrivalTime);
    // The last stop without an end location: its service time still belongs to the day.
    if (end !== null && !last.departureTime && Number(last.deliveryConstraints?.serviceMinutes) > 0) end += Number(last.deliveryConstraints.serviceMinutes) * 60000;
    return end !== null && end >= start ? Math.round((end - start) / 1000) : null;
  }

  /**
   * Merges the planned route groups into one route with id 'day'. Detour and safety points keep their place:
   * their leg indexes are shifted by the legs of the routes before them.
   */
  function mergeDayRoute(plannedRoutes) {
    const list = (plannedRoutes || []).filter((route) => route && Array.isArray(route.customerStops) && route.customerStops.length);
    if (!list.length) return null;
    const optimizedStops = [];
    const manualWaypoints = [];
    const safetyWaypoints = [];
    let legOffset = 0;
    list.forEach((route, index) => {
      const order = Array.isArray(route.optimizedStops) ? route.optimizedStops : [];
      // Route k starts at Route k-1's last stop, which is already in the list.
      optimizedStops.push(...(index === 0 ? order : order.slice(1)));
      for (const point of route.manualWaypoints || []) if (Number.isInteger(point?.legIndex)) manualWaypoints.push({ ...point, legIndex: point.legIndex + legOffset });
      for (const point of route.safetyWaypoints || []) if (Number.isInteger(point?.legIndex)) safetyWaypoints.push({ ...point, legIndex: point.legIndex + legOffset });
      legOffset += Math.max(0, order.length - 1);
    });
    const last = list[list.length - 1];
    return {
      id: DAY_ROUTE_ID,
      label: 'All stops',
      routeIds: list.map((route) => text(route.id)),
      customerStops: list.flatMap((route) => route.customerStops),
      optimizedStops,
      originalWaypoints: list.flatMap((route) => route.originalWaypoints || []),
      detailedStopTimes: list.flatMap((route) => route.detailedStopTimes || []),
      routeStopConfigs: list.flatMap((route) => route.routeStopConfigs || []),
      manualWaypoints,
      safetyWaypoints,
      endLocationId: last.endLocationId || null,
      estimatedDistanceMeters: list.reduce((sum, route) => sum + routeDistance(route), 0),
      estimatedDurationSeconds: list.reduce((sum, route) => sum + routeDriving(route), 0),
      dayElapsedSeconds: dayElapsedSeconds(list)
    };
  }

  root.GoRouteXDayRoute = { DAY_ROUTE_ID, mergeDayRoute, dayElapsedSeconds, routeDistance, routeDriving };
})(typeof window !== 'undefined' ? window : globalThis);
