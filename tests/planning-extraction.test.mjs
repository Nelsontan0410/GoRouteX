import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const state = read('planning/planning-state.js');
const finalization = read('planning/route-finalization.js');
const persistence = read('planning/planning-persistence.js');
function stateContext() {
 const planned = [{ id: 'existing' }];
 const c = vm.createContext({window:{}, AppState:{plannedRoutes:planned}, MAX_WAYPOINTS_PER_ROUTE:8,
 getDefaultStayMinutes:()=>15,getDefaultStayMinutesForStop:()=>15, getPreferredPlanningTime:()=> '10:30', getDateKey:()=> '2026-10-03',
 localStorage:{getItem:()=>null},VEHICLE_DRIVER_STORAGE_KEY:'vehicle',DEFAULT_VEHICLE_DRIVER:'fixture',
 getStoredVehicleDriverItems:()=>['fixture'],getRouteKeyIndex:k=>Number(k.slice(5))-1,
 isManualRouteListType:k=>/^route\d+$/.test(k),normalizeStayMinutes:v=>Number(v)||15});
 vm.runInContext(state,c);return c;
}
function flow() {
 const events=[];const calls={profile:0,stops:0,orders:0,routing:0,eta:0,writes:0,history:0};
 const c=vm.createContext({window:{},AppState:{plannedRoutes:[]},performance:{mark(){},measure(){}},messageBarPg2:{},
 RouteEngine:{async buildPlannedRoutes(){events.push('build');calls.routing++;return {plannedRoutes:[{id:1,directionsResult:{}}]}}},
 RouteSafety:{async validateRoutes(){events.push('safety')}},
 ensureManualRouteCheckCurrent:async()=>events.push('manual-check'),
 generateTimeListAndShowOnPage3Legacy(){events.push('eta');calls.eta++},
 currentRouteConfirmationState:{},updateConfirmRouteButtonState(){},renderConfirmRouteModalState(){}});
 vm.runInContext(persistence,c);vm.runInContext(finalization,c);
 c.validateRouteInputs=()=>{events.push('preflight');return {success:true}};
 c.prepareRoutePlanningUi=async()=>events.push('prepare');
 c.renderPlannedRoutes=()=>{events.push('render');return {success:true}};
 c.saveCurrentRouteToHistory=async()=>{events.push('persist');calls.writes++;calls.history++;return {success:true,id:'stable_plan'}};
 c.openDispatchPage=id=>events.push('dispatch:'+id);
 return {c,events,calls};
}
test('Planning module evaluation is passive and preserves the existing routes reference',()=>{
 const c=stateContext();vm.runInContext(finalization,c);vm.runInContext(persistence,c);
 assert.equal(vm.runInContext('selectedCustomers',c),undefined);
 vm.runInContext('initializePlanningRoutesBridge()',c);
 assert.equal(c.window.plannedRoutes,c.AppState.plannedRoutes);assert.equal(c.AppState.plannedRoutes[0].id,'existing');
});
test('Planning defaults preserve selection, slot, date and confirmation values',()=>{
 const c=stateContext();vm.runInContext('initializePlanningSelectionState();initializePlanningDraftState();initializePlanningLocationState();initializePlanningDirectionState();initializePlanningConfirmationState()',c);
 const actual=JSON.parse(vm.runInContext('JSON.stringify({selected:selectedCustomers.size,addresses:selectedAddresses.size,keys:Object.keys(manualRouteSlots),slot:manualRouteSlots.route1["1"],date:planningDate,time:routeStartTime,mode:routeOriginMode,end:routeEndRequired,order:directionOrder,confirmation:currentRouteConfirmationState})',c));
 assert.deepEqual(actual,{selected:0,addresses:0,keys:['route1','route2'],slot:{location:null,stay:15},date:'2026-10-03',time:'10:30',mode:'current',end:true,order:['WEST','NORTH','EAST','SOUTH'],confirmation:{saved:false,saving:false,historyId:null,source:'draft'}});
});
test('existing slot API keeps assigned-stop order and normalizes stay values',()=>{
 const c=stateContext();vm.runInContext('initializePlanningDraftState()',c);
 c.setRouteSlotEntry('route2',0,{location:'stop-b',stay:20});c.setRouteSlotEntry('route1',0,{location:'stop-a',stay:0});
 assert.deepEqual(Array.from(c.getAssignedStopIds()),['stop-a','stop-b']);assert.equal(c.getRouteSlotEntry('route1',0).stay,15);
 c.clearRouteSlot('route1',0);assert.deepEqual(Array.from(c.getAssignedStopIds()),['stop-b']);
});
test('Planning UI continues to invoke the existing confirmation action',()=>{
 const handlers={};const button={addEventListener:(type,fn)=>handlers[type]=fn};let confirms=0;
 const c=vm.createContext({confirmRouteBtn:button,retrieveStopsBtn:null,planningDateInput:null,confirmRouteCancelBtn:null,confirmRouteConfirmBtn:null,confirmRouteModal:null,handleConfirmRouteButtonClick:()=>confirms++});
 vm.runInContext(read('planning/planning-page.js'),c);c.bindPlanningConfirmationControls();handlers.click();assert.equal(confirms,1);
});
test('finalization keeps manual check, build, safety, render, ETA, persistence and handoff order',async()=>{
 const {c,events}=flow();await c.handleProceedToOptimizeRoutes({saveAfterPlan:true});
 assert.deepEqual(events,['preflight','manual-check','prepare','build','safety','render','eta','persist','dispatch:stable_plan']);
});
test('safety failure prevents ETA and finalized persistence',async()=>{
 const {c,calls}=flow();c.RouteSafety.validateRoutes=async()=>{throw Error('validation unavailable')};
 await assert.rejects(c.handleProceedToOptimizeRoutes({saveAfterPlan:true}),/validation unavailable/);
 assert.equal(calls.eta,0);assert.equal(calls.writes,0);
});
test('one explicit finalization generates ETA once and saves once without profile or stop reads',async()=>{
 const {c,calls}=flow();await c.handleProceedToOptimizeRoutes({saveAfterPlan:true});
 assert.deepEqual(calls,{profile:0,stops:0,orders:0,routing:1,eta:1,writes:1,history:1});
});
test('preview preserves ETA generation but skips finalized persistence and Dispatch handoff',async()=>{
 const {c,calls,events}=flow();await c.handleProceedToOptimizeRoutes({saveAfterPlan:false});
 assert.equal(calls.eta,1);assert.equal(calls.writes,0);assert.ok(!events.some(x=>x.startsWith('dispatch:')));
});
test('missing persisted plan ID prevents Dispatch handoff',async()=>{
 const {c,events}=flow();c.saveCurrentRouteToHistory=async()=>({success:true});
 const result=await c.handleProceedToOptimizeRoutes({saveAfterPlan:true});
 assert.equal(result.success,false);assert.match(result.error,/no saved plan ID/);assert.ok(!events.some(x=>x.startsWith('dispatch:')));
});
test('Dispatch navigation uses the saved ID without starting any Planning work',()=>{
 let destination;const writes=[];const c=vm.createContext({window:{location:{assign:url=>destination=url},FirebaseApp:{auth:{getCurrentUser:()=>({uid:'fixture'})}}},sessionStorage:{setItem:(...args)=>writes.push(args)},showToast(){}});
 vm.runInContext(finalization,c);c.openDispatchPage('stable_123');assert.equal(destination,'dispatch.html?planId=stable_123');assert.deepEqual(writes,[['grxLastFinalizedPlan:fixture','stable_123']]);
});

test('repeated app initialization registers Planning confirmation handlers once',()=>{
 const app=read('app.html');const start=app.indexOf('    function initializeUIEventListeners()');
 const end=app.indexOf('    function safeNumber',start);const initializer=app.slice(start,end);
 const globals=Object.fromEntries([...initializer.matchAll(/if \((\w+)\)/g)].map(m=>[m[1],null]));
 let listeners=0,pageBindings=0;
 Object.assign(globals,{uiEventListenersInitialized:false,confirmRouteBtn:{addEventListener(){listeners++}},
 retrieveStopsBtn:null,planningDateInput:null,confirmRouteCancelBtn:null,confirmRouteConfirmBtn:null,confirmRouteModal:null,
 handleConfirmRouteButtonClick(){},bindHistoryPrimaryControls(){},bindDashboardControls(){},bindHistoryFilterControls(){}});
 const c=vm.createContext(globals);vm.runInContext(read('planning/planning-page.js'),c);
 c.bindPlanningPageControls=()=>pageBindings++;
 vm.runInContext(initializer,c);c.initializeUIEventListeners();c.initializeUIEventListeners();c.initializeUIEventListeners();
 assert.equal(listeners,1);assert.equal(pageBindings,1);
});
