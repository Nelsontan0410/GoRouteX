import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../planning/route-overview-ui.js', import.meta.url), 'utf8'), context);
const { geometry, sample, distance } = context.GoRouteXRoutePreviewGeometry;
const a = {lat:1.30,lng:103.80}, b = {lat:1.30,lng:103.81}, c = {lat:1.31,lng:103.81}, d = {lat:1.31,lng:103.82};
const leg = (start,end,path) => ({start_location:start,end_location:end,steps:path?[{path}]:[]});
test('preview follows calculated road bends, with ordered leg arrivals and no result mutations', () => {
 const result={routes:[{legs:[leg(a,c,[a,b,c]),leg(c,d,[c,d])]}]};
 const before=JSON.stringify(result), model=geometry(result);
 assert.equal(model.path.length,4);assert.equal(model.arrivals.length,2);assert.ok(model.arrivals[0]<model.arrivals[1]);
 const atB=sample(model, distance(a,b)/model.total);
 assert.ok(distance(atB.position,b)<.01);assert.equal(atB.next,0);
 assert.equal(sample(model,.9).next,1);assert.equal(sample(model,1).next,-1);
 assert.equal(JSON.stringify(result),before);
});
test('missing geometry disables the animation rather than inventing a straight road', () => {
 assert.equal(geometry({routes:[{legs:[leg(a,c)]}]}),null);
 assert.equal(geometry({routes:[]}),null);
});
test('existing overview geometry can locate stop arrivals when step paths are unavailable', () => {
 const model=geometry({routes:[{legs:[leg(a,c),leg(c,d)],overview_path:[a,b,c,d]}]});
 assert.equal(model.path.length,4);assert.ok(model.arrivals[0]<model.total);
 assert.ok(distance(sample(model,1).position,d)<.01);
});
test('encoded paths and Google LatLng objects use the same computed geometry', () => {
 const latlng=p=>({lat:()=>p.lat,lng:()=>p.lng});
 const result={routes:[{legs:[{start_location:latlng(a),end_location:latlng(c),steps:[{polyline:{points:'encoded'}}]}]}]};
 const model=geometry(result,()=>[latlng(a),latlng(b),latlng(c)]);
 assert.equal(model.path.length,3);assert.ok(distance(model.end,c)<.01);
});
