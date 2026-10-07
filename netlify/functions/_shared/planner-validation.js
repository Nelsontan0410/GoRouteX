// Validates a VROOM problem from the browser and rebuilds it from whitelisted fields only, so nothing
// else reaches the planning service. Mirrors the limits and service area in planner-problem.js.
export const PLANNER_LIMITS = Object.freeze({ maxJobs: 100, maxVehicles: 20, maxStopsPerRoute: 8, maxDaySeconds: 2 * 86400, maxServiceSeconds: 4 * 3600 });
const BOUNDS = { minLat: 1.15, maxLat: 1.48, minLng: 103.59, maxLng: 104.1 };

class ProblemError extends Error {}
const fail = (message) => { throw new ProblemError(message); };
const int = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} is out of range.`);
  return value;
};
const location = (value, label) => {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} is not a location.`);
  const [lng, lat] = value;
  if (![lng, lat].every((n) => typeof n === 'number' && Number.isFinite(n))) fail(`${label} is not a location.`);
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) fail(`${label} is outside the service area.`);
  return [lng, lat];
};
const window = (value, label) => {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} is not a time window.`);
  const start = int(value[0], 0, PLANNER_LIMITS.maxDaySeconds, label);
  const end = int(value[1], 0, PLANNER_LIMITS.maxDaySeconds, label);
  if (end < start) fail(`${label} ends before it starts.`);
  return [start, end];
};
const windows = (value, label, max = 10) => {
  if (!Array.isArray(value) || !value.length || value.length > max) fail(`${label} needs 1-${max} time windows.`);
  return value.map((w) => window(w, label));
};

/** Returns { ok: true, problem } or { ok: false, error }. */
export function sanitizePlannerProblem(raw) {
  try {
    if (!raw || typeof raw !== 'object') fail('Missing problem.');
    const jobs = Array.isArray(raw.jobs) ? raw.jobs : fail('Missing jobs.');
    const vehicles = Array.isArray(raw.vehicles) ? raw.vehicles : fail('Missing vehicles.');
    if (!jobs.length || jobs.length > PLANNER_LIMITS.maxJobs) fail(`Plan 1-${PLANNER_LIMITS.maxJobs} stops.`);
    if (!vehicles.length || vehicles.length > PLANNER_LIMITS.maxVehicles) fail(`Use 1-${PLANNER_LIMITS.maxVehicles} vehicles.`);
    const jobIds = new Set();
    const cleanJobs = jobs.map((job, index) => {
      const id = int(job?.id, 1, 100000, `Stop ${index + 1}`);
      if (jobIds.has(id)) fail('Duplicate stop.');
      jobIds.add(id);
      return {
        id,
        location: location(job.location, `Stop ${index + 1}`),
        service: int(job.service, 0, PLANNER_LIMITS.maxServiceSeconds, `Stop ${index + 1} service`),
        time_windows: windows(job.time_windows, `Stop ${index + 1}`)
      };
    });
    const cleanVehicles = vehicles.map((vehicle, index) => {
      const label = `Vehicle ${index + 1}`;
      const clean = {
        id: int(vehicle?.id, 1, 1000, label),
        profile: 'car',
        start: location(vehicle.start, `${label} start`),
        time_window: window(vehicle.time_window, label),
        max_tasks: int(vehicle.max_tasks, 1, PLANNER_LIMITS.maxStopsPerRoute, `${label} stops`),
        costs: { fixed: int(vehicle.costs?.fixed ?? 0, 0, 1000000, `${label} cost`) }
      };
      if (vehicle.end !== undefined) clean.end = location(vehicle.end, `${label} end`);
      if (vehicle.breaks !== undefined) {
        if (!Array.isArray(vehicle.breaks) || vehicle.breaks.length > 3) fail(`${label} breaks are invalid.`);
        clean.breaks = vehicle.breaks.map((item, b) => ({
          id: int(item?.id, 1, 100000, `${label} break`),
          time_windows: windows(item.time_windows, `${label} break ${b + 1}`, 3),
          service: int(item.service, 0, PLANNER_LIMITS.maxServiceSeconds, `${label} break`)
        }));
      }
      return clean;
    });
    return { ok: true, problem: { jobs: cleanJobs, vehicles: cleanVehicles, options: { g: false } } };
  } catch (error) {
    if (error instanceof ProblemError) return { ok: false, error: error.message };
    throw error;
  }
}

/** 2-27 [lng, lat] points inside the service area, in visiting order. */
export function sanitizeRouteRequest(raw) {
  try {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 27) fail('Send 2-27 points.');
    return { ok: true, coordinates: raw.map((p, i) => location(p, `Point ${i + 1}`)) };
  } catch (error) {
    if (error instanceof ProblemError) return { ok: false, error: error.message };
    throw error;
  }
}
