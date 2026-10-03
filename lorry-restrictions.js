(function (global) {
  'use strict';
  const VERSION = 3, CELL = 0.002, METRES = 111320;
  function point(value) {
    const lat = typeof value?.lat === 'function' ? value.lat() : value?.lat;
    const lng = typeof value?.lng === 'function' ? value.lng() : value?.lng;
    return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  function decodePolyline(encoded) {
    if (typeof encoded !== 'string') throw new Error('Missing encoded polyline');
    const points = []; let index = 0, lat = 0, lng = 0;
    const next = () => {
      let value = 0, shift = 0, byte;
      do {
        if (index >= encoded.length || shift > 30) throw new Error('Malformed encoded polyline');
        byte = encoded.charCodeAt(index++) - 63;
        if (byte < 0 || byte > 63) throw new Error('Malformed encoded polyline');
        value |= (byte & 31) << shift; shift += 5;
      } while (byte >= 32);
      return value & 1 ? ~(value >> 1) : value >> 1;
    };
    while (index < encoded.length) { lat += next(); lng += next(); points.push({ lat: lat / 1e5, lng: lng / 1e5 }); }
    return points;
  }
  function extractGeometry(result) {
    const route = result?.routes?.[0];
    if (!route) return { paths: [], quality: 'MISSING' };
    const paths = [], pathLegIndices = [];
    let incomplete = false;
    for (const [legIndex, leg] of (route.legs || []).entries()) {
      if (!leg.steps?.length) incomplete = true;
      for (const step of leg.steps || []) {
        const values = step.path || (step.polyline?.points ? decodePolyline(step.polyline.points) : []);
        const path = values.map(point);
        if (path.length < 2 || path.some((p) => !p)) incomplete = true;
        else { paths.push(path); pathLegIndices.push(legIndex); }
      }
    }
    if (paths.length && !incomplete) return { paths, pathLegIndices, quality: 'STEPS' };
    const encoded = typeof route.overview_polyline === 'string' ? route.overview_polyline : route.overview_polyline?.points;
    const overview = (route.overview_path || (encoded ? decodePolyline(encoded) : [])).map(point);
    if (overview.length >= 2 && overview.every(Boolean)) return { paths: [overview], pathLegIndices: [null], quality: 'OVERVIEW' };
    return { paths, pathLegIndices, quality: 'INCOMPLETE' };
  }
  function buildIndex(signs) {
    const cells = new Map();
    for (const sign of signs) {
      if (!Number.isFinite(sign.latitude) || !Number.isFinite(sign.longitude)) throw new Error('Invalid sign coordinates');
      const key = `${Math.floor(sign.latitude / CELL)},${Math.floor(sign.longitude / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(sign);
    }
    return cells;
  }
  function measure(sign, a, b) {
    const scaleX = METRES * Math.cos(a.lat * Math.PI / 180);
    const x = (b.lng - a.lng) * scaleX, y = (b.lat - a.lat) * METRES;
    const sx = (sign.longitude - a.lng) * scaleX, sy = (sign.latitude - a.lat) * METRES;
    const length2 = x * x + y * y;
    if (length2 < 0.01) return null;
    const rawT = (sx * x + sy * y) / length2, t = Math.max(0, Math.min(1, rawT));
    return { distanceToRoute: Math.hypot(sx - t * x, sy - t * y), routeHeading: (Math.atan2(x, y) * 180 / Math.PI + 360) % 360, entering: rawT > 0 && rawT < 1 };
  }
  function validateRouteAgainstLorryRestrictions(geometry, selectedCodes, dataset, index = buildIndex(dataset.signs)) {
    const issues = [], conflicts = new Map(), nearby = new Map();
    const selected = new Set((selectedCodes || []).map(String));
    if (!selected.size) issues.push('Select at least one restriction code to avoid.');
    const available = new Set(dataset.signs.map((sign) => sign.signCode));
    if ([...selected].some((code) => !available.has(code))) issues.push('A selected code is absent from this dataset. Review the selection.');
    if (geometry.quality !== 'STEPS') issues.push('Detailed route geometry is missing or incomplete; review required.');
    if (!geometry.paths.length) return { safe: false, status: 'WARNING', conflicts: [], issues, rulesVersion: VERSION };
    const generated = Date.parse(dataset.generatedAt);
    if (!Number.isFinite(generated) || Date.now() - generated > 14 * 86400000) issues.push('Restriction data has not been refreshed within 14 days.');
    for (const [pathIndex, path] of geometry.paths.entries()) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if ([a, b].some((p) => p.lat < 1 || p.lat > 2 || p.lng < 103 || p.lng > 105)) {
        if (!issues.includes('Route extends outside dataset coverage.')) issues.push('Route extends outside dataset coverage.');
        continue;
      }
      const padding = 35 / METRES;
      const loY = Math.floor((Math.min(a.lat, b.lat) - padding) / CELL), hiY = Math.floor((Math.max(a.lat, b.lat) + padding) / CELL);
      const loX = Math.floor((Math.min(a.lng, b.lng) - padding * 1.01) / CELL), hiX = Math.floor((Math.max(a.lng, b.lng) + padding * 1.01) / CELL);
      for (let y = loY; y <= hiY; y++) for (let x = loX; x <= hiX; x++) for (const sign of index.get(`${y},${x}`) || []) {
        if (!selected.has(String(sign.signCode))) continue;
        const match = measure(sign, a, b);
        if (!match || match.distanceToRoute > 35) continue;
        if (match.distanceToRoute <= 20 && (!nearby.has(sign.id) || match.distanceToRoute < nearby.get(sign.id).distanceToRoute)) {
          nearby.set(sign.id, { restrictionId: sign.id, signCode: sign.signCode, ...match,
            legIndex: geometry.pathLegIndices?.[pathIndex] ?? null,
            reason: `Selected code ${sign.signCode} is ${match.distanceToRoute.toFixed(1)} m from this route. Proximity reminder; entry into a restricted road is not confirmed.` });
        }
        const bearingKnown = sign.bearingConvention === 'TRAVEL_DIRECTION' && Number.isFinite(sign.bearing);
        const delta = bearingKnown ? Math.abs(((match.routeHeading - sign.bearing + 540) % 360) - 180) : null;
        // A selected code is an avoidance preference, not a declaration of legal applicability.
        const sameRoad = !!sign.roadSegmentId && a.roadSegmentId === sign.roadSegmentId && b.roadSegmentId === sign.roadSegmentId;
        if (sameRoad && bearingKnown && delta > 100) continue;
        const differentRoad = !!sign.roadSegmentId && !!a.roadSegmentId && a.roadSegmentId !== sign.roadSegmentId;
        if (differentRoad) continue;
        const high = geometry.quality === 'STEPS' && bearingKnown && delta < 35 && match.entering && match.distanceToRoute <= 12;
        const conflict = { restrictionId: sign.id, restrictionType: sign.signName, latitude: sign.latitude, longitude: sign.longitude,
          ...match, legIndex: geometry.pathLegIndices?.[pathIndex] ?? null, signBearing: sign.bearing, bearingDifference: delta, severity: high ? 'BLOCKED' : 'WARNING', confidence: high ? 'HIGH' : 'MEDIUM',
          reason: high ? `Route closely follows selected code ${sign.signCode} in its indicated direction. Avoidance preference; legal applicability is not assessed.` : `Selected code ${sign.signCode} is nearby; road association or entry direction needs review.`,
          threshold: sign.threshold, unit: sign.unit, signCode: sign.signCode };
        const previous = conflicts.get(sign.id);
        if (!previous || (high && previous.severity !== 'BLOCKED') || (previous.severity === conflict.severity && match.distanceToRoute < previous.distanceToRoute)) conflicts.set(sign.id, conflict);
      }
    }
    const values = [...conflicts.values()].sort((a, b) => a.distanceToRoute - b.distanceToRoute);
    const status = values.some((c) => c.severity === 'BLOCKED') ? 'BLOCKED' : values.length || issues.length ? 'WARNING' : 'SAFE';
    return { safe: status === 'SAFE', status, conflicts: values, nearbyRestrictions: [...nearby.values()], issues, rulesVersion: VERSION };
  }
  global.LorryRestrictions = { VERSION, decodePolyline, extractGeometry, buildIndex, point, measure, validateRouteAgainstLorryRestrictions };
})(globalThis);
