/**
 * Plan Engine feedback: how much the planner changed the automatic plan before saving it.
 * Stored on the saved plan (history entry `planEngine`) so plan quality can be measured over time:
 * an automatic plan that is saved unchanged is a good plan.
 */
(function (root) {
  /** routes: [[stopId, ...], ...] in order. Returns counts of the planner's edits. */
  function comparePlans(initialRoutes, finalRoutes) {
    const routeOf = (routes) => {
      const map = new Map();
      routes.forEach((ids, routeIndex) => ids.forEach((id, position) => map.set(String(id), { routeIndex, position })));
      return map;
    };
    const before = routeOf(initialRoutes || []);
    const after = routeOf(finalRoutes || []);
    let moved = 0, removed = 0, added = 0;
    for (const [id, place] of before) {
      const next = after.get(id);
      if (!next) removed++;
      else if (next.routeIndex !== place.routeIndex) moved++;
    }
    for (const id of after.keys()) if (!before.has(id)) added++;
    // A route counts as reordered when the stops it shares with its automatic version are in another order.
    let reordered = 0;
    (finalRoutes || []).forEach((ids, routeIndex) => {
      const original = (initialRoutes || [])[routeIndex] || [];
      const shared = ids.map(String).filter((id) => original.map(String).includes(id));
      const originalOrder = original.map(String).filter((id) => shared.includes(id));
      if (shared.join('|') !== originalOrder.join('|')) reordered++;
    });
    return { moved, removed, added, reordered, unchanged: moved + removed + added + reordered === 0 };
  }

  root.GoRouteXPlanEdits = { comparePlans };
})(typeof window !== 'undefined' ? window : globalThis);
