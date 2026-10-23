/** Read-only route presentation. Never requests directions or writes planning state. */
(function (global) {
  'use strict';
  const point = (value) => {
    if (!value) return null;
    const lat = Number(typeof value.lat === 'function' ? value.lat() : value.lat);
    const lng = Number(typeof value.lng === 'function' ? value.lng() : value.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  };
  const distance = (a, b) => {
    const radians = Math.PI / 180, dy = (b.lat - a.lat) * radians, dx = (b.lng - a.lng) * radians;
    const h = Math.sin(dy / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dx / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  };
  function geometry(result, decode = () => []) {
    const route = result?.routes?.[0];
    if (!route?.legs?.length) return null;
    const path = [], cumulative = [0], arrivals = [];
    const add = (value) => {
      const next = point(value);
      if (!next || (path.length && distance(path.at(-1), next) < .01)) return;
      if (path.length) cumulative.push(cumulative.at(-1) + distance(path.at(-1), next));
      path.push(next);
    };
    // An animation requires actual road geometry. Endpoints alone are never interpolated.
    let complete = true;
    route.legs.forEach((leg) => {
      const legPath = [];
      (leg.steps || []).forEach((step) => {
        let points = step.path;
        if (!points?.length && step.polyline?.points) {
          try { points = decode(step.polyline.points); } catch { points = []; }
        }
        (points || []).forEach((p) => { if (point(p)) legPath.push(p); });
      });
      if (legPath.length < 2) complete = false;
      legPath.forEach(add);
      arrivals.push(cumulative.at(-1));
    });
    if (!complete) {
      if (!route.overview_path?.length || route.overview_path.length < 2) return null;
      path.length = 0; cumulative.splice(0, cumulative.length, 0);
      route.overview_path.forEach(add);
      let lower = 0;
      route.legs.forEach((leg, index) => {
        const end = point(leg.end_location);
        if (!end) { complete = false; return; }
        let best = lower;
        for (let n = lower; n < path.length; n++) if (distance(path[n], end) < distance(path[best], end)) best = n;
        lower = best; arrivals[index] = cumulative[best];
      });
    }
    const start = point(route.legs[0].start_location), end = point(route.legs.at(-1).end_location);
    if (path.length < 2 || !start || !end || !cumulative.at(-1)) return null;
    return { path, cumulative, arrivals, start, end, total: cumulative.at(-1), legs: route.legs };
  }
  function sample(model, fraction) {
    const target = Math.max(0, Math.min(1, fraction)) * model.total;
    let lo = 1, hi = model.cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (model.cumulative[mid] < target) lo = mid + 1; else hi = mid; }
    const a = model.path[lo - 1], b = model.path[lo];
    const t = (target - model.cumulative[lo - 1]) / (model.cumulative[lo] - model.cumulative[lo - 1] || 1);
    const heading = Math.atan2((b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI;
    return { position: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, heading, next: model.arrivals.findIndex((n) => n > target + .01) };
  }
  global.GoRouteXRoutePreviewGeometry = { point, distance, geometry, sample };
  if (!global.document) return;

  const geometryCache = new WeakMap();
  let root, map, selected = null, models = [], layers = [], hiddenMarkers = new Map(), fadedLines = new Map();
  let refs = [], lineRefs = [], markerRefs = [], playing = false, progress = 0, lastFrame = 0, frame = 0, van, currentModel;
  const $ = (id) => document.getElementById(id) || root?.querySelector(`#${id}`);
  const sameRefs = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
  const text = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
  const stopId = (stop) => typeof stop === 'string' ? stop : stop?.id || stop?.uniqueId || stop?.customerId || stop?.stopId;
  const nativeMarkers = () => typeof masterListPreviewMarkers !== 'undefined' ? masterListPreviewMarkers : [];
  const nativeLines = () => typeof dynamicRouteRenderersPage2 !== 'undefined' ? dynamicRouteRenderersPage2 : [];
  function pause() {
    playing = false; cancelAnimationFrame(frame); lastFrame = 0;
    text($('raPreviewPlay'), 'Play'); $('raPreviewPlay')?.setAttribute('aria-pressed', 'false');
  }
  function restoreNative() {
    hiddenMarkers.forEach((backup, marker) => {
      if (backup.node) backup.node.style.visibility = backup.visibility;
      else marker.setVisible?.(backup.visible);
    });
    hiddenMarkers.clear();
    fadedLines.forEach((backup, line) => line.setOptions?.(backup)); fadedLines.clear();
  }
  function clear() {
    pause(); layers.forEach((layer) => layer.setMap?.(null)); layers = []; van = null; currentModel = null;
    restoreNative();
    root?.querySelectorAll('.ra-preview-next, .ra-preview-passed').forEach((slot) => slot.classList.remove('ra-preview-next', 'ra-preview-passed'));
  }
  function marker(position, label, tone, title) {
    const width = Math.max(34, label.length * 8 + 20);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="42"><path d="M${width/2-5} 32 L${width/2} 41 L${width/2+5} 32" fill="${tone}"/><rect x="1" y="1" width="${width-2}" height="32" rx="16" fill="${tone}" stroke="white" stroke-width="2"/></svg>`;
    const item = new google.maps.Marker({ map, position, title, clickable: false, zIndex: 80,
      icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, anchor: new google.maps.Point(width / 2, 41), labelOrigin: new google.maps.Point(width / 2, 17) },
      label: { text: label, color: '#fff', fontSize: '12px', fontWeight: '700' } });
    layers.push(item); return item;
  }
  function fit() {
    if (!map || !models.length || !global.google?.maps) return false;
    const bounds = new google.maps.LatLngBounds();
    const visible = selected === 'all' ? models : models.filter((m) => m.key === selected);
    visible.forEach((m) => { m.geometry?.path.forEach((p) => bounds.extend(p)); });
    if (!visible.some((m) => m.geometry)) return false;
    map.fitBounds(bounds, 65); return true;
  }
  function paintProgress() {
    if (!currentModel?.geometry) return;
    const model = currentModel, g = model.geometry, at = sample(g, progress);
    van?.setPosition(at.position);
    // A top-view van, rotated in the direction of travel; it is a local visual only.
    van?.setIcon({ path: 'M -4,-9 L 4,-9 Q 6,-9 6,-6 L 6,7 Q 6,9 4,9 L -4,9 Q -6,9 -6,7 L -6,-6 Q -6,-9 -4,-9 M -4,-4 L 4,-4 M -4,4 L 4,4', fillColor: '#123e76', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.5, rotation: at.heading });
    $('raPreviewProgress').value = String(Math.round(progress * 1000));
    const next = at.next;
    const target = next >= 0 && next < model.slots.length ? model.slots[next] : null;
    const name = target?.querySelector('.ra-stop-name')?.textContent;
    text($('raPreviewStatus'), progress >= 1 ? 'End reached' : target ? `${Math.round(progress*100)}% · Next: stop ${target.querySelector('.slot-number')?.textContent} · ${name || ''}` : `${Math.round(progress*100)}% · ${next < 0 ? 'End reached' : 'To end location'}`);
    model.slots.forEach((slot, index) => {
      slot.classList.toggle('ra-preview-next', index === next);
      slot.classList.toggle('ra-preview-passed', g.arrivals[index] <= progress * g.total);
    });
  }
  function animate(now) {
    if (!playing || !root?.isConnected || !root.classList.contains('active-page') || document.hidden) return pause();
    if (lastFrame) progress += (now - lastFrame) / 60000 * Number($('raPreviewSpeed').value);
    lastFrame = now;
    if (progress >= 1) {
      if ($('raPreviewLoop').getAttribute('aria-pressed') === 'true') progress %= 1;
      else { progress = 1; pause(); }
    }
    paintProgress(); if (playing) frame = requestAnimationFrame(animate);
  }
  function buildLayers() {
    clear(); progress = 0; $('raPreviewProgress').value = '0';
    const visible = selected === 'all' ? models : models.filter((m) => m.key === selected);
    const ready = visible.filter((m) => m.geometry);
    $('raPreviewPlay').disabled = ready.length !== 1 || selected === 'all';
    $('raPreviewProgress').disabled = $('raPreviewPlay').disabled;
    if (!map || !global.google?.maps || !ready.length) {
      text($('raPreviewStatus'), selected === 'all' ? 'Select a route to play its preview.' : 'Waiting for this route to finish calculating.'); return;
    }
    // Keep originals on the same map and restore their presentation when leaving this view.
    const replacedIds = new Set(ready.flatMap((m) => m.slots.map((slot) => slot.dataset.customerId)));
    nativeMarkers().filter((m) => replacedIds.has(m.stopId)).forEach((item) => {
      const node = item.content;
      if (node?.style) { hiddenMarkers.set(item, { node, visibility: node.style.visibility }); node.style.visibility = 'hidden'; }
      else if (item.setVisible) { hiddenMarkers.set(item, { visible: item.getVisible?.() ?? true }); item.setVisible(false); }
    });
    nativeLines().forEach((line) => {
      fadedLines.set(line, { strokeOpacity: line.get?.('strokeOpacity') ?? .9 });
      line.setOptions?.({ strokeOpacity: selected === 'all' ? .15 : .12 });
    });
    ready.forEach((model) => {
      const g = model.geometry, color = model.route.color || '#2456c4';
      const line = new google.maps.Polyline({ map, path: g.path, strokeColor: color, strokeWeight: 6, strokeOpacity: .94, clickable: false, zIndex: 12,
        icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.2, strokeColor: '#fff', strokeWeight: 1, fillColor: color, fillOpacity: 1 }, offset: '60px', repeat: '100px' }] });
      layers.push(line);
      const prefix = selected === 'all' ? `R${model.number} · ` : '';
      const roundTrip = distance(g.start, g.end) < 8;
      marker(g.start, `${prefix}${roundTrip ? 'START / END' : 'START'}`, '#08775c', `Route ${model.number} start${roundTrip ? ' and end' : ''}`);
      model.slots.forEach((slot, index) => {
        const position = point(g.legs[index]?.end_location);
        if (!position) return;
        const number = slot.querySelector('.slot-number')?.textContent || String(index + 1);
        const isEnd = index === model.slots.length - 1 && distance(position, g.end) < 8 && !roundTrip;
        marker(position, `${prefix}${number}${isEnd ? ' · END' : ''}`, isEnd ? '#a53e39' : color, `Stop ${number}: ${slot.querySelector('.ra-stop-name')?.textContent || ''}${isEnd ? ' · End' : ''}`);
      });
      const lastDelivery = point(g.legs[model.slots.length - 1]?.end_location);
      if (!roundTrip && (!lastDelivery || distance(lastDelivery, g.end) >= 8)) marker(g.end, `${prefix}END`, '#a53e39', `Route ${model.number} end`);
    });
    if (ready.length === 1 && selected !== 'all') {
      currentModel = ready[0];
      van = new google.maps.Marker({ map, position: currentModel.geometry.start, title: 'Route preview — not live GPS', clickable: false, zIndex: 120 });
      layers.push(van); paintProgress();
    } else text($('raPreviewStatus'), 'All routes · Select a route to play its preview.');
    fit();
  }
  function refresh() {
    if (!root?.isConnected || !root.classList.contains('active-page')) { if (layers.length) clear(); refs = []; return; }
    const routes = typeof manualPreviewRoutes !== 'undefined' ? manualPreviewRoutes : [];
    const sections = [...root.querySelectorAll('#routesSection [data-ra-key]')];
    const next = sections.map((section) => {
      const number = Number(section.dataset.raKey.slice(6)), key = section.dataset.raKey;
      const slots = [...section.querySelectorAll('.route-slot.filled')];
      const route = routes.find((r) => Number(r.index ?? Number(r.id) - 1) === number - 1);
      const ids = slots.map((slot) => slot.dataset.customerId);
      const actual = (route?.originalWaypoints || route?.customerStops?.map(stopId) || []);
      const matches = ids.length && ids.join('|') === actual.join('|');
      const decode = (encoded) => global.LorryRestrictions?.decodePolyline?.(encoded) || google.maps.geometry?.encoding?.decodePath?.(encoded) || [];
      let computed = null;
      if (matches && route?.directionsResult) {
        if (!geometryCache.has(route.directionsResult)) geometryCache.set(route.directionsResult, geometry(route.directionsResult, decode));
        computed = geometryCache.get(route.directionsResult);
      }
      return { key, number, slots, route, geometry: computed };
    }).filter((m) => m.slots.length);
    const signature = next.map((m) => m.key).join('|');
    const picker = $('raMapRoute');
    if (picker.dataset.signature !== signature) {
      picker.replaceChildren(new Option('All routes', 'all'), ...next.map((m) => new Option(`Route ${m.number} · ${m.slots.length} stops`, m.key)));
      picker.dataset.signature = signature;
    }
    if (!next.some((m) => m.key === selected) && selected !== 'all') selected = next[0]?.key || 'all';
    picker.value = selected;
    const nextMap = typeof mapPage2 !== 'undefined' ? mapPage2 : null;
    const nextRefs = next.flatMap((m) => [m.route?.directionsResult, m.geometry ? true : false, ...m.slots]);
    const changed = map !== nextMap || !sameRefs(refs, nextRefs) || !sameRefs(lineRefs, nativeLines()) || !sameRefs(markerRefs, nativeMarkers());
    map = nextMap; models = next;
    if (changed) { refs = nextRefs; lineRefs = [...nativeLines()]; markerRefs = [...nativeMarkers()]; buildLayers(); }
  }
  function init() {
    root = $('page-manual-assign'); if (!root || root.dataset.raOverview) return;
    root.dataset.raOverview = 'true';
    $('raMapRoute').addEventListener('change', (event) => {
      selected = event.target.value; buildLayers(); fit();
      if (selected !== 'all') global.dispatchEvent(new CustomEvent('goroutex:map-group', { detail: { key: selected } }));
    });
    global.addEventListener('goroutex:review-group', (event) => {
      if (!event.detail.key?.startsWith('route-') || selected === event.detail.key) return;
      selected = event.detail.key; refresh(); $('raMapRoute').value = selected; buildLayers();
    });
    $('raFitRoute').addEventListener('click', fit);
    $('raPreviewPlay').addEventListener('click', () => {
      if (playing) return pause();
      if (!currentModel) return;
      if (progress >= 1) progress = 0;
      playing = true; lastFrame = 0; text($('raPreviewPlay'), 'Pause'); $('raPreviewPlay').setAttribute('aria-pressed', 'true'); frame = requestAnimationFrame(animate);
    });
    $('raPreviewProgress').addEventListener('input', () => { pause(); progress = Number($('raPreviewProgress').value) / 1000; paintProgress(); });
    $('raPreviewLoop').addEventListener('click', () => {
      const on = $('raPreviewLoop').getAttribute('aria-pressed') !== 'true';
      $('raPreviewLoop').setAttribute('aria-pressed', String(on)); text($('raPreviewLoop'), `Loop ${on ? 'on' : 'off'}`);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    new MutationObserver(() => { if (!root.isConnected || !root.classList.contains('active-page')) { clear(); refs = []; } else refresh(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
    global.setInterval(refresh, 600); refresh();
  }
  global.GoRouteXRouteOverviewUi = { fit };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window === 'undefined' ? globalThis : window);
