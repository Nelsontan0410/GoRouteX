/**
 * Address → coordinates for route start/end locations (Settings and Planning).
 * Classic script: window.GoRouteXGeocode. No dependency on app.html's MapHandler.
 *
 * A geocoder answer is accepted only when it is unambiguous: exactly one result, not a partial
 * match, with a location that is not merely approximate. Anything else returns a reason, and the
 * user picks the place from the suggestion list instead. Coordinates are never guessed.
 */
(function (root) {
  const MAPS_KEY = 'AIzaSyA0rhYLn9QRwRw8VRqXSKMMij1snRsYsQ8'; // same browser key as app.html (referrer-restricted)
  const LOAD_TIMEOUT_MS = 10000;
  const GEOCODE_TIMEOUT_MS = 8000;
  const CALLBACK = '__goroutexGeocodeMapsReady';

  const isCoordinate = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
  function cleanLatLng(value) {
    if (!value || typeof value !== 'object') return null;
    const lat = typeof value.lat === 'function' ? value.lat() : value.lat;
    const lng = typeof value.lng === 'function' ? value.lng() : value.lng;
    return isCoordinate(lat, 90) && isCoordinate(lng, 180) ? { lat, lng } : null;
  }

  /** Same address for matching purposes: trimmed, single spaces, case-insensitive, no space before commas. */
  function sameAddress(a, b) {
    const norm = (value) => String(value || '').trim().replace(/\s+/g, ' ').replace(/\s+,/g, ',').toLowerCase();
    return !!norm(a) && norm(a) === norm(b);
  }

  function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'TIMEOUT' })), ms); })
    ]).finally(() => clearTimeout(timer));
  }

  const REASONS = {
    ZERO_RESULTS: 'No matching address found. Check the address or pick it from the suggestions.',
    REQUEST_DENIED: 'The map service rejected the request (key or API not allowed for this site).',
    OVER_QUERY_LIMIT: 'The map service is busy. Try again in a moment.',
    OVER_DAILY_LIMIT: 'The map service quota is used up for today.',
    INVALID_REQUEST: 'Enter an address first.',
    TIMEOUT: 'The map service did not answer in time. Try again.',
    MAPS_UNAVAILABLE: 'The map service could not be loaded. Check the connection and try again.',
    AUTH_FAILED: 'The map service rejected this site’s key.'
  };
  function reasonFor(code) { return REASONS[code] || 'The address could not be verified. Pick it from the suggestions.'; }
  function errorCode(error) {
    const code = String(error?.code || '').toUpperCase();
    if (REASONS[code]) return code;
    const text = String(error?.message || '');
    const match = Object.keys(REASONS).find((key) => text.includes(key));
    return match || 'UNKNOWN';
  }

  /** Geocoder results → { ok, address, latLng, quality } or { ok:false, code, reason }. */
  function classifyResults(results) {
    const list = Array.isArray(results) ? results : [];
    if (!list.length) return { ok: false, code: 'ZERO_RESULTS', reason: reasonFor('ZERO_RESULTS') };
    if (list.length > 1) return { ok: false, code: 'AMBIGUOUS', reason: `Several places match this address (${list.length}). Pick the right one from the suggestions.` };
    const result = list[0];
    if (result.partial_match) return { ok: false, code: 'PARTIAL', reason: 'Only part of this address matched. Pick the right place from the suggestions.' };
    const latLng = cleanLatLng(result.geometry?.location);
    if (!latLng) return { ok: false, code: 'NO_GEOMETRY', reason: 'The match has no map position. Pick the place from the suggestions.' };
    if (result.geometry?.location_type === 'APPROXIMATE') return { ok: false, code: 'APPROXIMATE', reason: 'The match is only approximate (an area, not a building). Pick the exact place from the suggestions.' };
    return { ok: true, address: result.formatted_address || '', latLng, quality: 'address' };
  }

  /** Autocomplete place → verified point, or null when the place has no position. */
  function fromPlace(place, typed) {
    const latLng = cleanLatLng(place?.geometry?.location);
    if (!latLng) return null;
    return { address: place.formatted_address || place.name || String(typed || '').trim(), latLng, quality: 'place' };
  }

  let loading = null;
  let authFailed = false;
  /** Loads Maps JS (places + geocoding) once; concurrent callers share the promise; a failure can be retried. */
  function loadMapsApi(options = {}) {
    if (root.google?.maps?.Geocoder && root.google?.maps?.places) return Promise.resolve(root.google.maps);
    if (authFailed) return Promise.reject(Object.assign(new Error(reasonFor('AUTH_FAILED')), { code: 'AUTH_FAILED' }));
    if (loading) return loading;
    const doc = options.document || root.document;
    loading = withTimeout(new Promise((resolve, reject) => {
      const previousAuthFailure = root.gm_authFailure;
      root.gm_authFailure = function () {
        authFailed = true;
        if (typeof previousAuthFailure === 'function') previousAuthFailure();
        reject(Object.assign(new Error(reasonFor('AUTH_FAILED')), { code: 'AUTH_FAILED' }));
      };
      root[CALLBACK] = () => resolve(root.google.maps);
      const script = doc.createElement('script');
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places,geocoding&loading=async&language=en&callback=${CALLBACK}`;
      script.onerror = () => { script.remove(); reject(Object.assign(new Error(reasonFor('MAPS_UNAVAILABLE')), { code: 'MAPS_UNAVAILABLE' })); };
      doc.head.appendChild(script);
    }), options.timeoutMs || LOAD_TIMEOUT_MS, reasonFor('MAPS_UNAVAILABLE')).catch((error) => {
      loading = null; // allow a retry
      throw Object.assign(error, { code: error.code === 'TIMEOUT' ? 'MAPS_UNAVAILABLE' : error.code });
    });
    return loading;
  }

  /** Geocodes with a timeout and the acceptance rules. Never throws: returns { ok:false, code, reason } instead. */
  async function geocodeAddress(address, options = {}) {
    const query = String(address || '').trim();
    if (!query) return { ok: false, code: 'INVALID_REQUEST', reason: reasonFor('INVALID_REQUEST') };
    try {
      const maps = options.maps || await loadMapsApi(options);
      const geocoder = options.geocoder || new maps.Geocoder();
      const response = await withTimeout(Promise.resolve(geocoder.geocode({ address: query, region: 'sg' })), options.timeoutMs || GEOCODE_TIMEOUT_MS, reasonFor('TIMEOUT'));
      return classifyResults(response?.results);
    } catch (error) {
      const code = errorCode(error);
      return { ok: false, code, reason: reasonFor(code) };
    }
  }

  /** The stored point for a typed address: coordinates only when verified for exactly this address. */
  function pointFor(typed, verified, loaded) {
    const address = String(typed || '').trim();
    if (!address) return null;
    return {
      address,
      label: loaded && loaded.address === address ? loaded.label : address,
      latLng: verified && verified.address === address && cleanLatLng(verified.latLng) ? { ...cleanLatLng(verified.latLng) } : null
    };
  }

  /**
   * Save check on a snapshot { field: point|null }: a new or edited address without coordinates is geocoded;
   * an unchanged older address (same as `loaded`) is left as it is and never blocks saving.
   * Fills point.latLng in the snapshot. Returns { ok:true, matched:[field] } or { ok:false, field, reason, code }.
   */
  async function verifyPoints(snapshot, loaded, geocode = geocodeAddress) {
    const matched = [];
    for (const field of Object.keys(snapshot)) {
      const target = snapshot[field];
      if (!target || cleanLatLng(target.latLng)) continue;
      if (loaded?.[field]?.address === target.address) continue;
      const result = await geocode(target.address);
      if (!result?.ok) return { ok: false, field, matched, code: result?.code || 'UNKNOWN', reason: result?.reason || reasonFor('UNKNOWN') };
      target.latLng = { ...result.latLng };
      matched.push(field);
    }
    return { ok: true, matched };
  }

  root.GoRouteXGeocode = { cleanLatLng, sameAddress, classifyResults, fromPlace, loadMapsApi, geocodeAddress, reasonFor, withTimeout, pointFor, verifyPoints };
})(typeof window !== 'undefined' ? window : globalThis);
