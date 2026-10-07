/**
 * Plan Engine: builds the VROOM (VRPTW) problem from GoRouteX planning data and maps the solution back.
 *
 * One module for the browser (window.GoRouteXPlannerProblem) and the Netlify function (globalThis), so the
 * same rules apply wherever the problem is built. Requires delivery-constraints.js.
 *
 * Model (decided 2026-10-06):
 * - Each route is its own vehicle and driver; all leave at the planning start time.
 * - Up to 8 stops per route (MAX_STOPS_PER_ROUTE).
 * - The solver also decides how many routes to use: every vehicle has a fixed cost, so it opens a new
 *   route only when that is worth it.
 * - Drivers are chosen later at Dispatch, so every vehicle uses the company driver defaults.
 * - Customer delivery hours are hard: a stop's service must START and FINISH inside one allowed period
 *   (receiving hours minus breaks). VROOM time windows bound the service start, so each window ends
 *   `service` seconds early.
 * Times are seconds since local midnight of the planning day.
 */
(function (root) {
  const C = () => root.GoRouteXDeliveryConstraints;
  const MAX_STOPS_PER_ROUTE = 8;
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

  function vehicleCount(input) {
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

  function unservableReason(stop, day) {
    const intervals = C().allowedIntervals(stop.schedule, day);
    if (!intervals.length) return { reason: 'closed', message: `Closed on ${C().DAY_LABELS[day] || day}.` };
    return { reason: 'service-too-long', message: `The ${stop.serviceMinutes}-minute service does not fit in any receiving period.` };
  }

  /**
   * input: { startDate: Date, origin: {lat,lng}, end: {lat,lng}|null, availableDrivers,
   *          stops: [{ id, lat, lng, serviceMinutes, schedule }],
   *          driverRules: { workingStart, workingEnd, breakMinutes, maxStops }, maxDurationMinutes, routeFixedCost }
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
    const endSec = workEnd !== null && workEnd > startSec ? Math.min(workEnd, startSec + maxDuration) : startSec + maxDuration;
    const maxTasks = Math.min(MAX_STOPS_PER_ROUTE, Number(rules.maxStops) > 0 ? Number(rules.maxStops) : MAX_STOPS_PER_ROUTE);
    const breakSec = Math.max(0, Math.round((Number(rules.breakMinutes) || 0) * 60));
    const [breakFrom, breakTo] = DRIVER_BREAK_WINDOW.map(seconds);
    const breakFits = breakSec > 0 && breakTo > startSec && breakFrom < endSec;
    const point = (p) => [p.lng, p.lat];

    const jobs = [];
    const jobIds = new Map();
    const preUnassigned = [];
    input.stops.forEach((stop) => {
      const windows = jobWindows(stop, day);
      if (!windows.length) {
        preUnassigned.push({ id: stop.id, ...unservableReason(stop, day) });
        return;
      }
      const jobId = jobs.length + 1;
      jobIds.set(jobId, stop.id);
      jobs.push({ id: jobId, location: point(stop), service: Math.round(stop.serviceMinutes * 60), time_windows: windows });
    });

    const vehicles = Array.from({ length: vehicleCount(input) }, (_, index) => ({
      id: index + 1,
      profile: 'car',
      start: point(input.origin),
      ...(input.end ? { end: point(input.end) } : {}),
      time_window: [startSec, endSec],
      max_tasks: maxTasks,
      costs: { fixed: Math.max(0, Math.round(Number(input.routeFixedCost) || DEFAULT_ROUTE_FIXED_COST)) },
      ...(breakFits ? { breaks: [{ id: index + 1, time_windows: [[Math.max(breakFrom, startSec), Math.min(breakTo, endSec)]], service: breakSec }] } : {})
    }));

    return { problem: { jobs, vehicles, options: { g: false } }, jobIds, preUnassigned, day, startSec };
  }

  const clock = (sec) => C().fromMinutes(Math.floor(sec / 60));

  /**
   * Maps a VROOM solution back to GoRouteX stop IDs.
   * Returns { routes: [{ stopIds, stops: [{ id, arrival, serviceStart, waitMinutes }] }], unassigned: [{ id, reason, message }] }.
   */
  function mapSolution(solution, built) {
    const routes = (solution?.routes || [])
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
    const unassigned = built.preUnassigned.concat((solution?.unassigned || [])
      .filter((job) => built.jobIds.has(job.id))
      .map((job) => ({
        id: built.jobIds.get(job.id),
        reason: 'no-feasible-route',
        message: 'No route can reach this customer within its delivery hours and the drivers’ working hours.'
      })));
    return { routes, unassigned };
  }

  root.GoRouteXPlannerProblem = {
    MAX_STOPS_PER_ROUTE,
    DEFAULT_ROUTE_FIXED_COST,
    SINGAPORE_BOUNDS,
    LIMITS,
    inSingapore,
    unsupportedReason,
    buildProblem,
    mapSolution
  };
})(typeof window !== 'undefined' ? window : globalThis);
