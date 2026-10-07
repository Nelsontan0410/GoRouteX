// Second pass after VROOM. VROOM's objective counts travel time only, so a route may wait a long time
// for a customer to open (or for a customer's lunch to end) and take the driver break separately.
// This pass re-evaluates routes with GoRouteX's objective, using the same travel-time matrix:
//   1. every stop served inside its time windows and every vehicle back inside its shift (hard)
//   2. least total route time: travel + waiting + driver break + service (+ fixed cost per used route)
//   3. least travel time
// A driver break may be taken while waiting for a customer. Moves: best order inside each route
// (exhaustive up to 8 stops) and moving a stop to another route. The result is used only when it is
// strictly better and fully feasible; otherwise VROOM's solution is returned unchanged.

const EXHAUSTIVE_LIMIT = 8;

function* permutations(items) {
  if (items.length <= 1) { yield items.slice(); return; }
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(rest)) yield [items[i], ...tail];
  }
}

/**
 * Simulates one vehicle visiting `jobIds` in order. Returns null when infeasible, else
 * { duration, travel, steps } where steps mirror VROOM's (type, id, arrival, waiting_time, service).
 */
export function simulateRoute(vehicle, jobIds, ctx) {
  const d = ctx.durations;
  const [shiftStart, shiftEnd] = vehicle.time_window;
  const brk = vehicle.breaks?.[0] || null;
  const breakFrom = brk ? brk.time_windows[0][0] : 0;
  const breakTo = brk ? brk.time_windows[0][1] : 0;
  const breakLen = brk ? brk.service : 0;
  let breakDone = !brk;
  if (Array.isArray(vehicle.capacity)) {
    const load = jobIds.reduce((sum, id) => sum + (ctx.jobs.get(id)?.delivery?.[0] || 0), 0);
    if (load > vehicle.capacity[0]) return null;
  }
  let clock = shiftStart;
  let pos = vehicle.start_index;
  let travel = 0;
  const steps = [{ type: 'start', arrival: shiftStart, waiting_time: 0, service: 0 }];

  // Takes the break at the current place if it is due; returns false if it can no longer fit.
  const takeBreakIfDue = (force) => {
    if (breakDone) return true;
    if (!force && clock < breakFrom) return true;
    const start = Math.max(clock, breakFrom);
    if (start + breakLen > breakTo) return false;
    steps.push({ type: 'break', id: brk.id, arrival: clock, waiting_time: start - clock, service: breakLen });
    clock = start + breakLen;
    breakDone = true;
    return true;
  };

  for (const jobId of jobIds) {
    const job = ctx.jobs.get(jobId);
    const leg = d[pos][job.location_index];
    travel += leg;
    clock += leg;
    const arrival = clock;
    const window = job.time_windows.find(([, end]) => end >= arrival);
    if (!window) return null;
    let serviceStart = Math.max(arrival, window[0]);
    // Use the wait for the driver break when the whole break fits inside it and its own window.
    if (!breakDone && serviceStart - arrival >= breakLen) {
      const breakStart = Math.max(arrival, breakFrom);
      if (breakStart + breakLen <= Math.min(serviceStart, breakTo)) {
        steps.push({ type: 'break', id: brk.id, arrival, waiting_time: breakStart - arrival, service: breakLen });
        breakDone = true;
        steps.push({ type: 'job', id: jobId, arrival: breakStart + breakLen, waiting_time: serviceStart - (breakStart + breakLen), service: job.service });
        clock = serviceStart + job.service;
        pos = job.location_index;
        if (!takeBreakIfDue(false)) return null;
        continue;
      }
    }
    steps.push({ type: 'job', id: jobId, arrival, waiting_time: serviceStart - arrival, service: job.service });
    clock = serviceStart + job.service;
    pos = job.location_index;
    if (!takeBreakIfDue(false)) return null;
  }
  // A route that runs into the break window must still include the break.
  if (!breakDone && clock > breakFrom && !takeBreakIfDue(true)) return null;
  if (vehicle.end_index !== undefined) {
    const leg = d[pos][vehicle.end_index];
    travel += leg;
    clock += leg;
  }
  if (clock > shiftEnd) return null;
  steps.push({ type: 'end', arrival: clock, waiting_time: 0, service: 0 });
  return { duration: clock - shiftStart, travel, steps };
}

function routeScore(vehicle, sim, jobCount) {
  if (!jobCount) return { cost: 0, travel: 0 };
  return { cost: sim.duration + (vehicle.costs?.fixed || 0), travel: sim.travel };
}

function bestOrder(vehicle, jobIds, ctx) {
  if (!jobIds.length) return { order: [], sim: simulateRoute(vehicle, [], ctx), score: { cost: 0, travel: 0 } };
  let best = null;
  const consider = (order) => {
    const sim = simulateRoute(vehicle, order, ctx);
    if (!sim) return;
    const score = routeScore(vehicle, sim, order.length);
    if (!best || score.cost < best.score.cost || (score.cost === best.score.cost && score.travel < best.score.travel)) best = { order, sim, score };
  };
  if (jobIds.length <= EXHAUSTIVE_LIMIT) for (const order of permutations(jobIds)) consider(order);
  else consider(jobIds);
  return best;
}

const total = (plan) => plan.reduce((acc, r) => ({ cost: acc.cost + r.score.cost, travel: acc.travel + r.score.travel }), { cost: 0, travel: 0 });
const better = (a, b) => a.cost < b.cost || (a.cost === b.cost && a.travel < b.travel);

/** problem: VROOM input with matrices and *_index fields; solution: VROOM output. */
export function improveSolution(problem, solution, { timeBudgetMs = 1500 } = {}) {
  if (!solution || solution.code !== 0 || !Array.isArray(solution.routes)) return solution;
  const deadline = Date.now() + timeBudgetMs;
  const ctx = { durations: problem.matrices.car.durations, jobs: new Map(problem.jobs.map((job) => [job.id, job])) };
  const vehicles = new Map(problem.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const baseline = [];
  for (const vehicle of problem.vehicles) {
    const route = solution.routes.find((r) => r.vehicle === vehicle.id);
    const jobIds = route ? route.steps.filter((s) => s.type === 'job').map((s) => s.id) : [];
    const sim = simulateRoute(vehicle, jobIds, ctx);
    if (!sim) return solution; // our evaluation disagrees with VROOM's: keep VROOM's solution
    baseline.push({ vehicleId: vehicle.id, order: jobIds, sim, score: routeScore(vehicle, sim, jobIds.length) });
  }

  // 1. Best order inside each route.
  let plan = baseline.map((r) => {
    const best = bestOrder(vehicles.get(r.vehicleId), r.order, ctx);
    return best && better(best.score, r.score) ? { ...r, ...best } : r;
  });

  // 2. Move single stops between routes while it helps (first improvement), within the time budget.
  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;
    outer:
    for (let a = 0; a < plan.length; a++) {
      for (const jobId of plan[a].order) {
        for (let b = 0; b < plan.length; b++) {
          if (a === b || Date.now() >= deadline) continue;
          const vb = vehicles.get(plan[b].vehicleId);
          if (plan[b].order.length >= vb.max_tasks) continue;
          const from = bestOrder(vehicles.get(plan[a].vehicleId), plan[a].order.filter((id) => id !== jobId), ctx);
          const to = bestOrder(vb, [...plan[b].order, jobId], ctx);
          if (!from || !to) continue;
          const before = { cost: plan[a].score.cost + plan[b].score.cost, travel: plan[a].score.travel + plan[b].score.travel };
          const after = { cost: from.score.cost + to.score.cost, travel: from.score.travel + to.score.travel };
          if (better(after, before)) {
            plan[a] = { ...plan[a], ...from };
            plan[b] = { ...plan[b], ...to };
            improved = true;
            break outer;
          }
        }
      }
    }
  }

  if (!better(total(plan), total(baseline))) return solution;
  const routes = plan.filter((r) => r.order.length).map((r) => ({
    vehicle: r.vehicleId,
    cost: r.score.cost,
    duration: r.sim.travel,
    waiting_time: r.sim.steps.reduce((sum, s) => sum + (s.waiting_time || 0), 0),
    service: r.sim.steps.reduce((sum, s) => sum + (s.type === 'job' ? s.service : 0), 0),
    steps: r.sim.steps
  }));
  const summaryOf = (key) => routes.reduce((sum, r) => sum + r[key], 0);
  return {
    ...solution,
    routes,
    summary: { ...(solution.summary || {}), cost: summaryOf('cost'), routes: routes.length, duration: summaryOf('duration'), waiting_time: summaryOf('waiting_time'), service: summaryOf('service') },
    improvedBy: 'goroutex'
  };
}

/**
 * Scores a given assignment (e.g. the plan GoRouteX would have used without the Plan Engine) on the same
 * matrix and rules, counting violations instead of rejecting: a late stop is served on arrival.
 * routes: [[jobId, ...], ...] in vehicle order. Returns totals in seconds plus violation and stop counts.
 */
export function evaluateAssignment(problem, routes) {
  const d = problem.matrices.car.durations;
  const jobs = new Map(problem.jobs.map((job) => [job.id, job]));
  const totals = { routes: 0, stops: 0, travel: 0, waiting: 0, duration: 0, violations: 0, overShift: 0 };
  (routes || []).forEach((jobIds, index) => {
    const vehicle = problem.vehicles[index] || problem.vehicles[problem.vehicles.length - 1];
    const ids = (jobIds || []).filter((id) => jobs.has(id));
    if (!ids.length) return;
    totals.routes++;
    let clock = vehicle.time_window[0];
    let pos = vehicle.start_index;
    for (const id of ids) {
      const job = jobs.get(id);
      const leg = d[pos][job.location_index];
      totals.travel += leg;
      clock += leg;
      const window = job.time_windows.find(([, end]) => end >= clock);
      if (!window) totals.violations++;
      const start = window ? Math.max(clock, window[0]) : clock;
      totals.waiting += start - clock;
      clock = start + job.service;
      pos = job.location_index;
      totals.stops++;
    }
    if (vehicle.end_index !== undefined) { totals.travel += d[pos][vehicle.end_index]; clock += d[pos][vehicle.end_index]; }
    if (clock > vehicle.time_window[1]) totals.overShift++;
    totals.duration += clock - vehicle.time_window[0];
  });
  return totals;
}

/** The same totals for a planning-service solution. */
export function evaluateSolution(problem, solution) {
  const routes = (solution?.routes || []).slice().sort((a, b) => a.vehicle - b.vehicle)
    .map((route) => route.steps.filter((s) => s.type === 'job').map((s) => s.id));
  return { ...evaluateAssignment(problem, routes), unassigned: (solution?.unassigned || []).length };
}
