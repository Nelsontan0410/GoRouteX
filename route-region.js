(function (global) {
  'use strict';
  let pending;
  function boundary() {
    if (!pending) pending = fetch('data/singapore-boundary.geojson')
      .then(r => { if (!r.ok) throw new Error('Country boundary unavailable'); return r.json(); })
      .catch(e => { pending = null; throw e; });
    return pending;
  }
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function overlaps(a, b, c, d) {
    return Math.max(a[0],b[0]) >= Math.min(c[0],d[0]) && Math.max(c[0],d[0]) >= Math.min(a[0],b[0])
      && Math.max(a[1],b[1]) >= Math.min(c[1],d[1]) && Math.max(c[1],d[1]) >= Math.min(a[1],b[1]);
  }
  function inRing(p, ring) {
    let inside = false;
    for (let i=0,j=ring.length-1; i<ring.length; j=i++) {
      const a=ring[i],b=ring[j];
      if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
    }
    return inside;
  }
  function touchesSingapore(routes, data) {
    const polygons=data.features.flatMap(f=>f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates])
      .map(rings=>({rings, low:[Math.min(...rings[0].map(p=>p[0])),Math.min(...rings[0].map(p=>p[1]))],
        high:[Math.max(...rings[0].map(p=>p[0])),Math.max(...rings[0].map(p=>p[1]))]}));
    for (const route of routes || []) {
      let geometry;
      try { geometry=global.LorryRestrictions.extractGeometry(route?.directionsResult); } catch { continue; }
      // Use actual route geometry, never the viewport or a line between stops.
      for (const path of geometry.paths || []) for (const {rings,low,high} of polygons) {
        for (let i=0;i<path.length;i++) {
          const p=[path[i].lng,path[i].lat], a=i?[path[i-1].lng,path[i-1].lat]:p;
          if (!overlaps(a,p,low,high)) continue;
          if (inRing(p,rings[0]) && !rings.slice(1).some(h=>inRing(p,h))) return true;
          if (!i) continue;
          const ring=rings[0];
          for(let j=1;j<ring.length;j++) {
            const c=ring[j-1],d=ring[j];
            if(overlaps(a,p,c,d) && cross(a,p,c)*cross(a,p,d)<=0 && cross(c,d,a)*cross(c,d,p)<=0) return true;
          }
        }
      }
    }
    return false;
  }
  global.RouteRegion={touchesSingapore, async hasSingaporeRoute(routes) {
    if (!(routes || []).some(r=>r?.directionsResult?.routes?.length)) return false;
    return touchesSingapore(routes,await boundary());
  }};
})(globalThis);
