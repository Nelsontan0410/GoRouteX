/**
 * Plan Engine: builds the VROOM (VRPTW) problem from GoRouteX planning data and maps the solution back.
 *
 * One module for the browser (window.GoRouteXPlannerProblem) and the Netlify function (globalThis), so the
 * same rules apply wherever the problem is built. Requires delivery-constraints.js.
 *
 * Model (decided 2026-10-11): mode 'sequential' (default).
 * - One driver runs Route 1, then Route 2, then Route 3 without returning to the start in between:
 *   the solver plans ONE vehicle visiting every stop, and the visit order is cut into routes of
 *   MAX_STOPS_PER_ROUTE (10). Route k starts at route k-1's last stop; only the last route goes to the end.
 * - Mode 'parallel' (earlier model, kept for several drivers): each route is its own vehicle; all leave at
 *   the planning start time; a fixed cost per vehicle lets the solver decide how many routes to use.
 * - Drivers are chosen later at Dispatch, so every vehicle uses the company driver defaults.
 * - Customer delivery hours are hard: a stop's service must START and FINISH inside one allowed period
 *   (receiving hours minus breaks). VROOM time windows bound the service start, so each window ends
 *   `service` seconds early.
 * Times are seconds since local midnight of the planning day.
 */
(function (root) {
  const C = () => root.GoRouteXDeliveryConstraints;
  const MAX_STOPS_PER_ROUTE = 10;
  const DEFAULT_ROUTE_FIXED_COST = 3600; // in VROOM cost units (travel seconds): one hour of driving
  // Driver break placement. Settings only stores the length, so it may be taken any time in this band.
  const DRIVER_BREAK_WINDOW = ['11:30', '14:30'];
  // Service area of the self-hosted road network (Singapore only).
  const SINGAPORE_BOUNDS = { minLat: 1.15, maxLat: 1.48, minLng: 103.59, maxLng: 104.1 };
  const LIMITS = { maxStops: 100, maxVehicles: 20 };

  const seconds = (hhmm) => {
    const minutes = C().toMinutes(hhmm);
    return minutes === null ? null : minutes * 60;
  };
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);

  function inSingapore(point) {
    return !!point && finite(point.lat) && finite(point.lng)
      && point.lat >= SINGAPORE_BOUNDS.minLat && point.lat <= SINGAPORE_BOUNDS.maxLat
      && point.lng >= SINGAPORE_BOUNDS.minLng && point.lng <= SINGAPORE_BOUNDS.maxLng;
  }

  /**
   * Why the planner cannot be used for this input (null when it can). The caller then keeps the
   * existing planner, so planning never stops.
   */
  function unsupportedReason(input) {
    if (!input || !Array.isArray(input.stops) || !input.stops.length) return 'No stops to plan.';
    if (input.stops.length > LIMITS.maxStops) return `More than ${LIMITS.maxStops} stops.`;
    if (!inSingapore(input.origin)) return 'The start location is outside Singapore or has no coordinates.';
    if (input.end && !inSingapore(input.end)) return 'The end location is outside Singapore.';
    const outside = input.stops.filter((stop) => !inSingapore(stop));
    if (outside.length) return `${outside.length} stop(s) are outside Singapore or have no coordinates.`;
    if (typeof input.startDate?.getTime !== 'function' || Number.isNaN(input.startDate.getTime())) return 'No planning date and time.';
    return null;
  }

  function capacityVehicles(input) {
    const list = Array.isArray(input.capacity?.vehicles) ? input.capacity.vehicles.filter((value) => finite(value) && value > 0) : [];
    return list.slice(0, LIMITS.maxVehicles);
  }

  const isSequential = (input) => input.mode !== 'parallel';
  function vehicleCount(input) {
    if (isSequential(input)) return 1;
    const capacities = capacityVehicles(input);
    if (capacities.length) return capacities.length;
    const needed = Math.ceil(input.stops.length / MAX_STOPS_PER_ROUTE);
    return Math.min(LIMITS.maxVehicles, Math.max(needed, Number(input.availableDrivers) || 0, 1));
  }

  /** Service-start windows that guarantee the whole service fits; [] when the stop cannot be served. */
  function jobWindows(stop, day) {
    const service = Math.round(stop.serviceMinutes * 60);
    return C().allowedIntervals(stop.schedule, day)
      .map((interval) => [interval.start * 60, interval.end * 60 - service])
      .filter(([start, end]) => end >= start);
  }

  /**
   * 0-100: how little of the working day a stop can be served in. The solver keeps higher-priority stops first
   * when not everything fits, and the hint also helps it find plans it would otherwise miss (a far stop that
   * must be served early, e.g. Tuas closing at 13:00, was dropped without it although all stops fitted).
   */
  function windowPriority(windows, shiftStart, shiftEnd) {
    const shift = shiftEnd - shiftStart;
    if (!(shift > 0)) return 0;
    const open = windows.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, shiftEnd) - Math.max(start, shiftStart)), 0);
    return Math.max(0, Math.min(100, Math.round(100 * (1 - open / shift))));
  }

  function unservableReason(stop, day) {
    const intervals = C().allowedIntervals(stop.schedule, day);
    if (!intervals.length) return { reason: 'closed', message: `Closed on ${C().DAY_LABELS[day] || day}.` };
    return { reason: 'service-too-long', message: `The ${stop.serviceMinutes}-minute service does not fit in any receiving period.` };
  }

  /**
   * input: { startDate: Date, origin: {lat,lng}, end: {lat,lng}|null, availableDrivers,
   *          stops: [{ id, lat, lng, serviceMinutes, schedule }],
   *          driverRules: { workingStart, workingEnd, breakMinutes, maxStops }, maxDurationMinutes, routeFixedCost,
   *          capacity: { vehicles: [capacity, ...] } | null }  (stops may carry `demand` in the same unit)
   * With capacity, there is one vehicle per active vehicle that has a capacity, and loads must fit.
   * Returns { problem, jobIds: Map<jobId, stopId>, preUnassigned: [{ id, reason, message }] }.
   */
  function buildProblem(input) {
    const day = C().dayKeyFromDate(input.startDate);
    const startSec = input.startDate.getHours() * 3600 + input.startDate.getMinutes() * 60;
    const rules = input.driverRules || {};
    const maxDuration = Number(input.maxDurationMinutes) > 0 ? Number(input.maxDurationMinutes) * 60 : 8 * 3600;
    const workEnd = seconds(rules.workingEnd);
    // All vehicles leave at the planning start time; they must be back by the end of the working day
    // (or after the maximum route duration when the plan starts after working hours).
    const sequential = isSequential(input);
    // Sequential (one driver, one day): no stop is left out for lack of time. The planner orders by delivery
    // windows and the shortest time and distance; whatever then breaks a rule is listed when the plan is
    // confirmed. The working end therefore does not cut the day short (a long day is only a warning).
    const endSec = workEnd !== null && workEnd > startSec ? Math.min(workEnd, startSec + maxDuration) : startSec + maxDuration;
    // The day the solver may use: the working end for several drivers, a long day for one driver.
    const vehicleEnd = sequential ? Math.max(endSec, startSec + 18 * 3600) : endSec;
    const relaxedIds = new Set(sequential ? (input.relaxedStopIds || []) : []);
    // Sequential: the driver's daily stop limit caps the whole day. Parallel: the per-route limit caps each vehicle.
    const perVehicleLimit = sequential ? LIMITS.maxStops : MAX_STOPS_PER_ROUTE;
    const maxTasks = sequential ? perVehicleLimit : Math.min(perVehicleLimit, Number(rules.maxStops) > 0 ? Number(rules.maxStops) : perVehicleLimit);
    const breakSec = Math.max(0, Math.round((Number(rules.breakMinutes) || 0) * 60));
    const [breakFrom, breakTo] = DRIVER_BREAK_WINDOW.map(seconds);
    const breakFits = breakSec > 0 && breakTo > startSec && breakFrom < endSec;
    const point = (p) => [p.lng, p.lat];

    // Sequential: one vehicle carries the whole day's load (no return to reload), so the largest capacity applies.
    const capacities = sequential && capacityVehicles(input).length ? [Math.max(...capacityVehicles(input))] : capacityVehicles(input);
    const jobs = [];
    const jobIds = new Map();
    const preUnassigned = [];
    input.stops.forEach((stop) => {
      let windows = jobWindows(stop, day);
      let relaxed = false;
      if (sequential && (relaxedIds.has(stop.id) || !windows.length)) {
        // Closed that day, or no window fits: serve it where it is cheapest and flag it at confirmation.
        windows = [[startSec, vehicleEnd]];
        relaxed = true;
      }
      if (!windows.length) {
        preUnassigned.push({ id: stop.id, ...unservableReason(stop, day) });
        return;
      }
      const jobId = jobs.length + 1;
      jobIds.set(jobId, stop.id);
      const job = { id: jobId, location: point(stop), service: Math.round(stop.serviceMinutes * 60), time_windows: windows };
      const priority = relaxed ? 0 : windowPriority(windows, startSec, endSec);
      if (priority > 0) job.priority = priority;
      if (capacities.length) job.delivery = [Math.ceil(finite(stop.demand) && stop.demand > 0 ? stop.demand : 0)];
      jobs.push(job);
    });

    const vehicles = Array.from({ length: vehicleCount(input) }, (_, index) => ({
      id: index + 1,
      profile: 'car',
      start: point(input.origin),
      ...(input.end ? { end: point(input.end) } : {}),
      time_window: [startSec, vehicleEnd],
      max_tasks: maxTasks,
      costs: { fixed: sequential ? 0 : Math.max(0, Math.round(Number(input.routeFixedCost) || DEFAULT_ROUTE_FIXED_COST)) },
      ...(capacities.length ? { capacity: [Math.floor(capacities[index])] } : {}),
      ...(breakFits ? { breaks: [{ id: index + 1, time_windows: [[Math.max(breakFrom, startSec), Math.min(breakTo, endSec)]], service: breakSec }] } : {})
    }));

    return { problem: { jobs, vehicles, options: { g: false } }, jobIds, preUnassigned, day, startSec, capacityUsed: capacities.length > 0, mode: sequential ? 'sequential' : 'parallel', maxTasks };
  }

  const clock = (sec) => C().fromMinutes(Math.floor(sec / 60));

  /**
   * Maps a VROOM solution back to GoRouteX stop IDs.
   * Returns { routes: [{ stopIds, stops: [{ id, arrival, serviceStart, waitMinutes }] }], unassigned: [{ id, reason, message }] }.
   */
  function mapSolution(solution, built) {
    const vehicleRoutes = (solution?.routes || [])
      .slice()
      .sort((a, b) => a.vehicle - b.vehicle)
      .map((route) => {
        const stops = (route.steps || [])
          .filter((step) => step.type === 'job' && built.jobIds.has(step.id))
          .map((step) => {
            const serviceStart = Number(step.arrival) + Number(step.waiting_time || 0);
            return {
              id: built.jobIds.get(step.id),
              arrival: clock(Number(step.arrival)),
              serviceStart: clock(serviceStart),
              waitMinutes: Math.round(Number(step.waiting_time || 0) / 60)
            };
          });
        return { stopIds: stops.map((stop) => stop.id), stops };
      })
      .filter((route) => route.stopIds.length > 0);
    // Sequential: the single day tour is cut into routes of MAX_STOPS_PER_ROUTE in visit order.
    const routes = built.mode === 'sequential'
      ? vehicleRoutes.flatMap((route) => splitIntoRoutes(route.stops))
      : vehicleRoutes;
    const assignedCount = vehicleRoutes.reduce((sum, route) => sum + route.stopIds.length, 0);
    const dailyLimitReached = built.mode === 'sequential' && assignedCount >= built.maxTasks;
    // Sequential: when the planned day already ends within an hour of the working end, the day is full.
    const dayEnd = built.mode === 'sequential' ? dayEndSeconds(solution) : null;
    const shiftEnd = built.problem.vehicles[0]?.time_window?.[1];
    const dayFull = dayEnd !== null && Number.isFinite(shiftEnd) && shiftEnd - dayEnd < 3600;
    const message = dailyLimitReached
      ? `The driver’s daily stop limit (${built.maxTasks}, Settings > Drivers) is reached.`
      : dayFull
        ? `The driver’s day is full: the plan already returns at ${clock(dayEnd)} and working hours end at ${clock(shiftEnd)}. Extend working hours, shorten service times, or plan this stop on another day.`
      : built.mode === 'sequential'
        ? (built.capacityUsed
          ? 'Does not fit the driver’s day: its delivery hours, the working hours or the vehicle’s capacity.'
          : 'Its delivery hours could not be fitted into this day’s order.')
        : (built.capacityUsed
          ? 'No route can fit this customer within its delivery hours, the drivers’ working hours and the vehicles’ capacity.'
          : 'No route can reach this customer within its delivery hours and the drivers’ working hours.');
    const unassigned = built.preUnassigned.concat((solution?.unassigned || [])
      .filter((job) => built.jobIds.has(job.id))
      .map((job) => ({ id: built.jobIds.get(job.id), reason: dailyLimitReached ? 'daily-limit' : dayFull ? 'day-full' : 'no-feasible-route', message })));
    return { routes, unassigned };
  }

  /** When the single day tour ends (arrival back at the end location, or the last stop), in seconds. */
  function dayEndSeconds(solution) {
    const steps = solution?.routes?.[0]?.steps || [];
    const last = steps[steps.length - 1];
    if (!last) return null;
    const end = Number(last.arrival) + Number(last.waiting_time || 0) + (last.type === 'job' ? Number(last.service || 0) : 0);
    return Number.isFinite(end) ? end : null;
  }

  /** Cuts a visit order into routes of `size` stops (default MAX_STOPS_PER_ROUTE), keeping each stop's timing. */
  function splitIntoRoutes(stops, size = MAX_STOPS_PER_ROUTE) {
    const list = Array.isArray(stops) ? stops : [];
    const routes = [];
    for (let i = 0; i < list.length; i += size) {
      const chunk = list.slice(i, i + size);
      routes.push({ stopIds: chunk.map((stop) => stop.id), stops: chunk });
    }
    return routes;
  }

  root.GoRouteXPlannerProblem = {
    MAX_STOPS_PER_ROUTE,
    DEFAULT_ROUTE_FIXED_COST,
    SINGAPORE_BOUNDS,
    LIMITS,
    inSingapore,
    unsupportedReason,
    buildProblem,
    mapSolution,
    windowPriority,
    splitIntoRoutes
  };
})(typeof window !== 'undefined' ? window : globalThis);
