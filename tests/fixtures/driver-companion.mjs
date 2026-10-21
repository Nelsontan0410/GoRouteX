// Test-only service boundary. Never included in the site's public build.
import {startExecution,arrive,deliver,fail,pause,resume,stopRoute,finish} from '../../driver/execution.js';
export function fixtureRoute() {
 const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 return {id:'test-route',assignedDriverUid:'drv_test',routeName:'Test route',date,vehicleDriver:'Test vehicle',originName:'Test depot',plannedRoutes:[{id:1,customerStops:Array.from({length:12},(_,i)=>({uniqueId:`test-${i}`,label:`Test delivery stop ${i+1}`,Address:`${i+1} Example Road · Test address`,contactName:i===0?'Test contact':null,phone:i===0?'+65 8000 0000':null,notes:i===0?'Test instruction: use the delivery entrance.':null,orderNumbers:[`TEST-${i+1}`]}))}]};
}
export function fixtureStore(route=fixtureRoute(),initial=null) {
 let execution=initial; const calls={start:0};
 return {calls,baseMode:'cloud',mode:'cloud',listAssignedRoutes:async()=>[route],loadExecution:async()=>execution,retryPendingOrderSync:async()=>{},
  start:async r=>{calls.start++;return execution=execution||startExecution(r,'drv_test');},
  arrive:async(id,stopId,pos)=>execution=arrive(execution,stopId,pos),
  deliver:async(id,stopId,pod)=>execution=deliver(execution,stopId,{id:'test-pod',...pod}),
  fail:async(id,stopId,reason,notes,pos)=>execution=fail(execution,stopId,reason,notes,pos),
  pause:async()=>execution=pause(execution),resume:async()=>execution=resume(execution),stop:async()=>execution=stopRoute(execution),finish:async()=>execution=finish(execution)};
}
