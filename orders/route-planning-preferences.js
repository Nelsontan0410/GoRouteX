(function (global) {
  const prefix = 'goroutex.route-locations.v1:';
  function key(uid) { return prefix + String(uid || ''); }
  function validPoint(value) {
    if (!value || typeof value !== 'object') return null;
    const address = String(value.address || '').trim();
    if (!address) return null;
    const lat = Number(value.latLng?.lat), lng = Number(value.latLng?.lng);
    return { address, label: String(value.label || address), latLng: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? {lat, lng} : null };
  }
  function read(uid) {
    if (!uid) return {};
    try { const value = JSON.parse(global.localStorage.getItem(key(uid)) || '{}');
      return { start: validPoint(value.start), end: validPoint(value.end) }; }
    catch { return {}; }
  }
  function save(uid, kind, point) {
    if (!uid || !['start','end'].includes(kind)) return false;
    const clean = validPoint(point);
    if (!clean) return false;
    try { global.localStorage.setItem(key(uid), JSON.stringify({...read(uid), [kind]: clean})); return true; }
    catch { return false; }
  }
  global.GoRouteXRouteLocations = {read, save};
})(window);
