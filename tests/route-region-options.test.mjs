import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../route-safety.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('  async function updateRegionOptions('),source.indexOf('  const presetCodes'));
function setup() {
  const requests=[];
  let loads=0;
  const ctx={optionsSection:{hidden:false},optionRoutes:[],regionRun:0,
    RouteRegion:{hasSingaporeRoute:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))},
    loadData:async()=>{loads++;}, renderCodes(){},renderPanelPresentation(){},statusMessage(){}};
  ctx.global=ctx;
  vm.createContext(ctx);vm.runInContext(fn,ctx);
  return {ctx,requests,loads:()=>loads};
}
test('options appear only after country detection and do not alter user settings',async()=>{
  const {ctx,requests,loads}=setup();
  const pending=ctx.updateRegionOptions([{}]);
  assert.equal(ctx.optionsSection.hidden,true);
  requests[0].resolve(true);await pending;
  assert.equal(ctx.optionsSection.hidden,false);assert.equal(loads(),1);
  const next=ctx.updateRegionOptions([]);
  assert.equal(ctx.optionsSection.hidden,true);
  requests[1].resolve(false);await next;
  assert.equal(ctx.optionsSection.hidden,true);assert.equal(loads(),1);
});
test('late Singapore result cannot reveal options for a newer foreign route',async()=>{
  const {ctx,requests}=setup();
  const old=ctx.updateRegionOptions([{}]);
  const current=ctx.updateRegionOptions([{}]);
  requests[1].resolve(false);await current;
  requests[0].resolve(true);await old;
  assert.equal(ctx.optionsSection.hidden,true);
});
test('boundary failure hides options and allows a later retry',async()=>{
  const {ctx,requests}=setup();
  const failed=ctx.updateRegionOptions([{}]);requests[0].reject(new Error('offline'));await failed;
  assert.equal(ctx.optionsSection.hidden,true);
  const retry=ctx.updateRegionOptions([{}]);requests[1].resolve(true);await retry;
  assert.equal(ctx.optionsSection.hidden,false);
});
