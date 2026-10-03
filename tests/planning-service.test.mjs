import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const start = source.indexOf('    async function ensurePlanningDirectionsService()');
const end = source.indexOf('    async function generateDirectionOrderedActiveRoutes', start);
function setup(loader, factory) {
 const context = vm.createContext({directionsService:null,window:{waitForMapsReady:loader},MapHandler:{initDirectionsService:factory}});
 vm.runInContext(source.slice(start,end), context);
 return context;
}
test('cold planning waits for Maps before creating service and reuses it', async () => {
 let ready=false, created=0;
 const service={};
 const c=setup(async()=>{await Promise.resolve();ready=true;},()=>{assert.equal(ready,true);created++;return service;});
 assert.equal(await c.ensurePlanningDirectionsService(),service);
 assert.equal(await c.ensurePlanningDirectionsService(),service);
 assert.equal(created,1);
});
test('Maps loading failure can be retried without storing a failed service', async()=>{
 let fail=true;
 const c=setup(async()=>{if(fail)throw new Error('Offline');},()=>({}));
 await assert.rejects(c.ensurePlanningDirectionsService(),/Offline/);
 assert.equal(c.directionsService,null);
 fail=false;
 assert.ok(await c.ensurePlanningDirectionsService());
});
