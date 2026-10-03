(function (global) {
  'use strict';
  const core = global.LorryRestrictions;
  const MAX_EXTRA_REQUESTS = 3;
  function distance(a, b) {
    return Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));
  }
  function endpoints(result) {
    const legs = result?.routes?.[0]?.legs || [];
    if (!legs.length) return null;
    const stops = [core.point(legs[0].start_location), ...legs.map((leg) => core.point(leg.end_location))];
    if (stops.some((p) => !p)) return null;
    for (let i = 1; i < legs.length; i++) {
      const start = core.point(legs[i].start_location);
      if (!start || distance(stops[i], start) > 30) return null;
    }
    return stops;
  }
  function candidatePoints(alternative, originalLeg, legIndex) {
    const oldPaths = core.extractGeometry({ routes: [{ legs: [originalLeg] }] }).paths;
    const nodes = core.extractGeometry(alternative).paths.flat();
    const stops = endpoints(alternative);
    if (!stops || !oldPaths.length) return [];
    const seen = new Set(), ranked = [];
    for (const [order, node] of nodes.entries()) {
      const key = `${node.lat},${node.lng}`;
      if (seen.has(key) || distance(node, stops[0]) < 40 || distance(node, stops.at(-1)) < 40) continue;
      seen.add(key);
      let separation = Infinity;
      for (const path of oldPaths) for (let i = 1; i < path.length; i++) {
        const match = core.measure({ latitude: node.lat, longitude: node.lng }, path[i - 1], path[i]);
        if (match) separation = Math.min(separation, match.distanceToRoute);
      }
      if (Number.isFinite(separation) && separation >= 25) ranked.push({ ...node, legIndex, order, separation, source: 'GOOGLE_ROUTE_GEOMETRY' });
    }
    ranked.sort((a, b) => b.separation - a.separation);
    const best = ranked[0];
    if (!best) return [];
    const spread = [best];
    for (const node of ranked) {
      if (spread.every((other) => distance(node, other) > 80)) spread.push(node);
      if (spread.length === 3) break;
    }
    const clean = (nodes) => nodes.sort((a, b) => a.order - b.order).map(({ lat, lng, legIndex, source }) => ({ lat, lng, legIndex, source }));
    return [clean([best]), ...(spread.length > 1 ? [clean(spread)] : [])];
  }
  function routeViaPoints(route) {
    const manual = Array.isArray(route?.manualWaypoints) ? route.manualWaypoints : [];
    return manual.map((point) => ({ ...point, source: point.source || 'MANUAL' }));
  }
  function buildRequest(stops, safetyWaypoints, manualWaypoints = []) {
    const waypoints = [];
    for (let legIndex = 0; legIndex < stops.length - 1; legIndex++) {
      for (const via of manualWaypoints.filter((p) => p.legIndex === legIndex)) waypoints.push({ location: { lat: via.lat, lng: via.lng }, stopover: false });
      for (const via of safetyWaypoints.filter((p) => p.legIndex === legIndex)) waypoints.push({ location: { lat: via.lat, lng: via.lng }, stopover: false });
      if (legIndex < stops.length - 2) waypoints.push({ location: stops[legIndex + 1], stopover: true });
    }
    if (waypoints.length > 25) return null;
    return { origin: stops[0], destination: stops.at(-1), waypoints, optimizeWaypoints: false, travelMode: 'DRIVING', region: 'sg' };
  }
  async function attemptBypass(route, initialValidation, validate, request, isCurrent = () => true) {
    const unchanged = { directionsResult: route.directionsResult, safetyWaypoints: route.safetyWaypoints || [], validation: initialValidation, reroutes: 0, changed: false };
    if (initialValidation.safe || initialValidation.issues.length || !initialValidation.conflicts.length) return unchanged;
    const stops = endpoints(route.directionsResult), legs = route.directionsResult?.routes?.[0]?.legs || [];
    const legIndex = initialValidation.conflicts.find((c) => Number.isInteger(c.legIndex))?.legIndex;
    if (!stops || stops.length !== route.optimizedStops?.length || !legs[legIndex]) return { ...unchanged, reason: 'Cannot reliably identify the affected delivery leg. Manual route review required.' };
    if ((route.manualWaypoints || []).some((point) => point.legIndex === legIndex)) {
      return { ...unchanged, reason: 'Your detour point is preserved. Move it or add another point to avoid the remaining restriction.' };
    }
    let requests = 0;
    const call = async (input) => {
      if (!isCurrent()) throw new Error('Route or restriction selection changed. Check again.');
      if (requests >= MAX_EXTRA_REQUESTS) throw new Error('Automatic bypass request limit reached.');
      requests++;
      const result = await request(input);
      if (!isCurrent()) throw new Error('Route or restriction selection changed. Check again.');
      return result;
    };
    try {
      // Google only offers alternatives without intermediate waypoints; inspect the affected leg first.
      const alternatives = await call({ origin: stops[legIndex], destination: stops[legIndex + 1], provideRouteAlternatives: true, travelMode: 'DRIVING', region: 'sg' });
      const candidates = [];
      for (const alternative of alternatives?.routes || []) {
        const result = { ...alternatives, routes: [alternative] };
        if (!validate(result).safe) continue;
        const points = endpoints(result);
        if (!points || points.length !== 2 || distance(points[0], stops[legIndex]) > 30 || distance(points[1], stops[legIndex + 1]) > 30) continue;
        for (const via of candidatePoints(result, legs[legIndex], legIndex)) {
          candidates.push({ via, duration: alternative.legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0) });
        }
      }
      candidates.sort((a, b) => a.duration - b.duration || a.via.length - b.via.length);
      for (const candidate of candidates) {
        if (requests >= MAX_EXTRA_REQUESTS) break;
        const via = [...(route.safetyWaypoints || []).filter((p) => p.legIndex !== legIndex), ...candidate.via];
        const input = buildRequest(stops, via, route.manualWaypoints || []);
        if (!input) continue;
        const final = await call(input), finalStops = endpoints(final);
        if (!finalStops || finalStops.length !== stops.length || finalStops.some((p, i) => distance(p, stops[i]) > 30)) continue;
        const result = validate(final);
        if (result.safe) return { directionsResult: final, safetyWaypoints: via, validation: result, reroutes: requests, changed: true };
      }
      return { ...unchanged, reroutes: requests, reason: 'No alternative passed the selected-code checks within the request limit. Manual route review required.' };
    } catch (error) { return { ...unchanged, reroutes: requests, reason: error.message || 'Google could not return an alternative. Manual route review required.' }; }
  }
  function navigationLinks(route) {
    const stops = endpoints(route.directionsResult);
    if (!stops || stops.length !== route.optimizedStops?.length) return [];
    const vias = routeViaPoints(route);
    if (vias.some((p) => !core.point(p) || !Number.isInteger(p.legIndex) || p.legIndex < 0 || p.legIndex >= stops.length - 1)) return [];
    const nodes = [{ ...stops[0], delivery: true }];
    for (let i = 0; i < stops.length - 1; i++) {
      const legVias = vias.filter((p) => p.legIndex === i);
      nodes.push(...legVias.map((p) => ({ ...p, delivery: false })), { ...stops[i + 1], delivery: true });
    }
    const links = [];
    for (let start = 0; start < nodes.length - 1;) {
      let end = Math.min(nodes.length - 1, start + 4); // mobile browsers: at most 3 intermediate waypoints
      const text = (p) => `${p.lat},${p.lng}`;
      const url = new URL('https://www.google.com/maps/dir/');
      url.searchParams.set('api', '1'); url.searchParams.set('origin', text(nodes[start])); url.searchParams.set('destination', text(nodes[end]));
      url.searchParams.set('travelmode', 'driving'); url.searchParams.set('dir_action', 'navigate');
      if (end - start > 1) url.searchParams.set('waypoints', nodes.slice(start + 1, end).map(text).join('|'));
      if (url.href.length > 2048) return [];
      links.push({ url: url.href, label: `Navigation ${links.length + 1}`, safetyCount: nodes.slice(start + 1, end).filter((p) => !p.delivery).length });
      start = end;
    }
    return links;
  }
  global.RestrictionRouting = { MAX_EXTRA_REQUESTS, attemptBypass, navigationLinks, candidatePoints, buildRequest, routeViaPoints, endpoints };
})(globalThis);
