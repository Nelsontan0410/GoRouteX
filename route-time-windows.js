/**
 * Time-window aware stop ordering for one route (hard customer delivery windows).
 *
 * Google's optimizeWaypoints only minimises travel time. When its order would break a customer's
 * receiving hours, this reorders the stops inside each route using an objective that includes the
 * windows, waiting and service time, travel time and distance (in that priority):
 *   1. fewest window violations  2. shortest total duration (travel + wait + service)  3. shortest distance.
 * Travel between stops is estimated from straight-line distance, calibrated with the real Google legs
 * (average speed and road/straight-line ratio), so no extra paid API calls are made. Final ETAs and the
 * hard check still come from the real Directions result at confirmation.
 *
 * Requires delivery-constraints.js. Exposes window.GoRouteXTimeWindows.
 */
(function (root) {
  const C = () => root.GoRouteXDeliveryConstraints;
  const EXHAUSTIVE_LIMIT = 8; // 8! = 40,320 orders: fast enough in the browser

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const point = (value) => {
    if (!value) return null;
    const lat = typeof value.lat === 'function' ? value.lat() : Number(value.lat);
    const lng = typeof value.lng === 'function' ? value.lng() : Number(value.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  };

  /**
   * Speed and road/straight-line ratio from real Google legs ({ distance:{value m}, duration:{value s},
   * start_location, end_location }). Falls back to typical urban values.
   */
  function calibrate(legs) {
    let meters = 0, seconds = 0, straightKm = 0;
    (Array.isArray(legs) ? legs : []).forEach((leg) => {
      const from = point(leg?.start_location);
      const to = point(leg?.end_location);
      const m = Number(leg?.distance?.value);
      const s = Number(leg?.duration?.value);
      if (!from || !to || !(m > 0) || !(s > 0)) return;
      meters += m;
      seconds += s;
      straightKm += haversineKm(from, to);
    });
    const kmh = meters > 0 && seconds > 0 ? (meters / 1000) / (seconds / 3600) : 30;
    const ratio = straightKm > 0 ? Math.min(3, Math.max(1, (meters / 1000) / straightKm)) : 1.4;
    return { kmh: Math.max(5, kmh), ratio };
  }

  function travel(a, b, model) {
    if (!a || !b) return { minutes: 0, km: 0 };
    const km = haversineKm(a, b) * model.ratio;
    return { km, minutes: (km / model.kmh) * 60 };
  }

  /**
   * Simulate one route. stops: [{ id, location:{lat,lng}, serviceMinutes, schedule }] in visiting order.
   * Returns { violations: [{ id, reason, message, arrivalMinutes }], endMinutes, totalMinutes, km }.
   */
  function simulate(stops, { origin, end, startMinutes, day, model }) {
    let clock = startMinutes;
    let km = 0;
    let position = origin;
    const violations = [];
    for (const stop of stops) {
      const leg = travel(position, stop.location, model);
      clock += leg.minutes;
      km += leg.km;
      const fit = stop.schedule ? C().scheduleService(clock, stop.serviceMinutes, stop.schedule, day) : { ok: true, end: clock + stop.serviceMinutes };
      if (fit.ok) {
        clock = fit.end;
      } else {
        violations.push({ id: stop.id, reason: fit.reason, message: fit.message, arrivalMinutes: clock });
        clock += stop.serviceMinutes;
      }
      position = stop.location;
    }
    if (end) {
      const leg = travel(position, end, model);
      clock += leg.minutes;
      km += leg.km;
    }
    return { violations, endMinutes: clock, totalMinutes: clock - startMinutes, km };
  }

  const score = (result) => [result.violations.length, Math.round(result.totalMinutes), Math.round(result.km * 10)];
  function better(a, b) {
    const x = score(a), y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  }

  function* permutations(items) {
    if (items.length <= 1) { yield items.slice(); return; }
    for (let i = 0; i < items.length; i++) {
      const rest = items.slice(0, i).concat(items.slice(i + 1));
      for (const tail of permutations(rest)) yield [items[i], ...tail];
    }
  }

  /** Best order for one route's stops. Returns { order, result }. */
  function bestOrder(stops, context) {
    let bestStops = stops.slice();
    let best = simulate(bestStops, context);
    if (stops.length <= 1) return { order: bestStops, result: best };
    if (stops.length <= EXHAUSTIVE_LIMIT) {
      for (const candidate of permutations(stops)) {
        const result = simulate(candidate, context);
        if (better(result, best)) { best = result; bestStops = candidate; }
      }
      return { order: bestStops, result: best };
    }
    // Larger routes: relocate and 2-opt moves until no improvement (bounded).
    let improved = true, rounds = 0;
    while (improved && rounds++ < 50) {
      improved = false;
      for (let i = 0; i < bestStops.length; i++) {
        for (let j = 0; j < bestStops.length; j++) {
          if (i === j) continue;
          const moved = bestStops.slice();
          const [item] = moved.splice(i, 1);
          moved.splice(j, 0, item);
          const reversed = i < j ? bestStops.slice(0, i).concat(bestStops.slice(i, j + 1).reverse(), bestStops.slice(j + 1)) : null;
          for (const candidate of reversed ? [moved, reversed] : [moved]) {
            const result = simulate(candidate, context);
            if (better(result, best)) { best = result; bestStops = candidate; improved = true; }
          }
        }
      }
    }
    return { order: bestStops, result: best };
  }

  /**
   * Reorder stops inside each packed route when Google's order breaks a delivery window.
   * routes: [{ stops: [...] }], one vehicle each, all leaving at the planning start time.
   * options: { origin, end, startDate: Date, legs, resolveStop(stop) -> { id, location, serviceMinutes, schedule } }
   * Returns { routes, changedRouteIndexes, remainingViolations }. Routes without a violation keep Google's order.
   */
  function applyToPackedRoutes(routes, options) {
    const changedRouteIndexes = [];
    const remainingViolations = [];
    const origin = point(options.origin);
    if (!origin || typeof options.startDate?.getTime !== 'function' || Number.isNaN(options.startDate.getTime())) {
      return { routes, changedRouteIndexes, remainingViolations, skipped: 'Start location or time unavailable.' };
    }
    const model = calibrate(options.legs);
    const end = point(options.end);
    const day = C().dayKeyFromDate(options.startDate);
    // Each route is its own vehicle and leaves at the planning start time.
    const startMinutes = options.startDate.getHours() * 60 + options.startDate.getMinutes();
    const nextRoutes = routes.map((route, routeIndex) => {
      const resolved = (route.stops || []).map((stop) => ({ stop, info: options.resolveStop(stop) }));
      // Stops without coordinates cannot be simulated; keep the route as Google ordered it.
      if (resolved.some(({ info }) => !info || !point(info.location))) return route;
      const items = resolved.map(({ stop, info }) => ({ ...info, location: point(info.location), original: stop }));
      const context = { origin, end, startMinutes, day, model };
      const current = simulate(items, context);
      let finalItems = items;
      let finalResult = current;
      if (current.violations.length) {
        const { order, result } = bestOrder(items, context);
        if (result.violations.length < current.violations.length) {
          finalItems = order;
          finalResult = result;
          changedRouteIndexes.push(routeIndex);
        }
      }
      finalResult.violations.forEach((violation) => remainingViolations.push({ routeIndex, ...violation }));
      if (finalItems === items) return route;
      const stops = finalItems.map((item) => item.original);
      return { ...route, stops, stopIds: stops.map((stop) => options.stopId ? options.stopId(stop) : stop.id).filter(Boolean), timeWindowOrdered: true };
    });
    return { routes: nextRoutes, changedRouteIndexes, remainingViolations };
  }

  root.GoRouteXTimeWindows = { haversineKm, calibrate, simulate, bestOrder, applyToPackedRoutes };
})(typeof window !== 'undefined' ? window : globalThis);
