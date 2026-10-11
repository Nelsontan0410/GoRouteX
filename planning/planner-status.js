/**
 * Which planner made the plan on screen, and why stops were left unassigned.
 * Classic script: window.GoRouteXPlannerStatus.
 *
 * Each Review & Assign entry starts a new plan id. Results from an older, still-running plan are
 * ignored, so a slow answer never overwrites a newer plan. The optimizer (who chose routes and order)
 * is kept apart from the road source (who drew the roads).
 *   optimizer: 'plan-engine' | 'google' | 'local-clustering' | 'direction-return' | 'manual' | 'none'
 *   roadRouting: 'osrm' | 'google'
 *   state: 'running' | 'done' | 'failed'
 * window._plannerUnassignedIds and window._plannerUsedEngine stay available, derived from the status.
 */
(function (root) {
  const OPTIMIZER_LABELS = {
    'plan-engine': 'Plan Engine',
    google: 'Google',
    'local-clustering': 'Local grouping',
    'direction-return': 'Direction order',
    manual: 'Manual',
    none: 'None'
  };
  let lastPlanId = 0;

  function emptyStatus(planId) {
    return { planId, optimizer: null, roadRouting: null, reason: '', state: 'running', unassigned: new Map() };
  }

  function derive(status) {
    root._plannerUnassignedIds = Array.from(status.unassigned.keys());
    root._plannerUsedEngine = status.state === 'done' && status.optimizer === 'plan-engine';
  }

  /** Starts a new plan; clears the previous plan's flags, reasons and notice. Returns its id. */
  function begin() {
    const planId = ++lastPlanId;
    root._plannerStatus = emptyStatus(planId);
    root._timeWindowPlanningNotice = '';
    derive(root._plannerStatus);
    return planId;
  }

  function current() { return root._plannerStatus || null; }
  function isCurrent(planId) { return !!planId && current()?.planId === planId; }

  /**
   * Records the plan actually applied. unassigned: [{ id, message|reason }] keyed by stop id.
   * Returns false (and changes nothing) when a newer plan has started.
   */
  function finish(planId, { optimizer, roadRouting = null, reason = '', unassigned = [] } = {}) {
    if (!isCurrent(planId)) return false;
    const status = current();
    status.optimizer = optimizer || 'none';
    status.roadRouting = roadRouting;
    status.reason = String(reason || '');
    status.state = 'done';
    status.unassigned = new Map();
    for (const item of unassigned || []) {
      const id = String(item?.id ?? '');
      if (id) status.unassigned.set(id, String(item.message || item.reason || ''));
    }
    derive(status);
    return true;
  }

  function fail(planId, reason) {
    if (!isCurrent(planId)) return false;
    const status = current();
    status.state = 'failed';
    status.reason = String(reason || '');
    derive(status);
    return true;
  }

  function reasonFor(stopId) {
    return current()?.unassigned.get(String(stopId)) || '';
  }

  /**
   * One line for the message bar, e.g. "Planner: Plan Engine · roads: OSRM" or
   * "Planner: Google (Plan Engine not used: <reason>)". Empty unless the test switch is on or a
   * fallback reason other than 'disabled' exists.
   */
  function line({ testSwitchOn = false } = {}) {
    const status = current();
    if (!status || status.state === 'running') return '';
    const reason = status.reason && status.reason !== 'disabled' ? status.reason : '';
    if (!testSwitchOn && !reason) return '';
    const name = OPTIMIZER_LABELS[status.optimizer] || 'None';
    const roads = status.roadRouting ? ` · roads: ${status.roadRouting === 'osrm' ? 'OSRM' : 'Google'}` : '';
    if (status.state === 'failed') return `Planner: failed${reason ? ` (${reason})` : ''}.`;
    if (status.optimizer === 'plan-engine' || status.optimizer === 'manual') return `Planner: ${name}${roads}${reason && status.optimizer === 'manual' ? ` (${reason})` : ''}.`;
    if (status.optimizer === 'none') return `Planner: no route was planned${reason ? ` (${reason})` : ''}.`;
    return `Planner: ${name}${roads}${reason ? ` (Plan Engine not used: ${reason})` : ''}.`;
  }

  root.GoRouteXPlannerStatus = { begin, current, isCurrent, finish, fail, reasonFor, line, OPTIMIZER_LABELS };
})(typeof window !== 'undefined' ? window : globalThis);
