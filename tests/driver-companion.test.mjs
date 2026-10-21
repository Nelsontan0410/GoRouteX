import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fixtureRoute,fixtureStore} from './fixtures/driver-companion.mjs';
import {progress,snapshotRouteStops} from '../driver/route-model.js';
import {navigationUrl,callUrl,navigationParts,whatsappUrl} from '../driver/navigation.js';
const html=readFileSync(new URL('../driver-tracking.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../driver/driver-page.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
class Element {
 constructor(){this.children=[];this.dataset={};this.attributes={};this.hidden=false;this.value='';this.listeners={};this.elements=[];this.files=[];this.classList={toggle(){}};}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 setAttribute(name,value){this.attributes[name]=value;}
 removeAttribute(name){delete this.attributes[name];}
 addEventListener(name,fn){this.listeners[name]=fn;}
 focus(){} scrollIntoView(){} reset(){} closest(){return this;}
}
async function page({route=fixtureRoute(),initial=null,profile={role:'driver',active:true}}={}) {
 const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
 const store=fixtureStore(route,initial), gps={starts:0,stops:0,refreshes:0};let status='ready';let authReady;
 const context=vm.createContext({console,URL,URLSearchParams,location:{search:''},setTimeout,clearTimeout,setInterval(){},confirm:()=>true,
  document:{getElementById:id=>nodes[id],createElement:()=>new Element(),addEventListener(){}},
  window:{addEventListener(){},FirebaseApp:{auth:{onAuthStateChange:fn=>authReady=fn({uid:'drv_test'}),getProfile:async()=>({success:true,profile}),isDriverAccount:()=>true}},
   DriverTrackingPage:{isReady:()=>true,setRouteContext(){},getStatus:()=>status,getProblem:()=>null,startTracking:async()=>{gps.starts++;status='active';return true;},stopTracking:async()=>{gps.stops++;status='stopped';return true;},refreshNow:()=>gps.refreshes++}},
  DriverRouteStore:{create:async()=>store},loadContactRequired:async()=>true,progress,snapshotRouteStops,navigationUrl,callUrl,navigationParts,whatsappUrl});
 vm.runInContext(source,context);await authReady;return {nodes,store,gps,context};
}
test('Maps parts never create execution or GPS; Start Route does, then Continue only changes view',async()=>{
 const {nodes:n,store,gps}=await page();const parts=n.driverNavigateAll.children[1].children;
 assert.equal(parts.length,2);assert.match(parts[0].href,/origin=Test%20depot/);
 assert.deepEqual(parts[0].listeners,{});assert.equal(store.calls.start,0);assert.equal(gps.starts,0);
 await n.driverStartBtn.onclick();assert.equal(store.calls.start,1);assert.equal(gps.starts,1);
 assert.equal(n.driverRouteView.dataset.screen,'current');assert.equal(n.driverDeliverBtn.hidden,true);
 assert.doesNotMatch(n.driverNavigateAll.children[1].children[0].href,/origin=/);
 n.driverOverviewTab.onclick();n.driverContinueBtn.onclick();assert.equal(store.calls.start,1);assert.equal(gps.starts,1);
});
test('arrival, POD, failure validation, next-stop preview and pause use existing execution transitions',async()=>{
 const {nodes:n,store}=await page();await n.driverStartBtn.onclick();
 n.driverUpcoming.onclick();assert.equal((await store.loadExecution()).stops[1].executionStatus,'PENDING');
 assert.equal(n.driverRouteView.dataset.screen,'route');assert.equal(n.driverStopDetail.hidden,false);
 n.driverCurrentTab.onclick();await n.driverArriveBtn.onclick();assert.equal(n.driverDeliverBtn.hidden,false);
 n.driverDeliverBtn.onclick();n.driverRecipient.value='Test receiver';
 await n.driverPodForm.onsubmit({preventDefault(){}}); // perform is async; wait on its observable busy state.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await store.loadExecution()).stops[0].executionStatus,'DELIVERED');assert.equal(n.driverStopSequence.textContent,'Stop 2 of 12');
 n.driverFailureReason.value='Other';n.driverFailureNotes.value='';n.driverFailureForm.onsubmit({preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));assert.match(n.driverNotice.textContent,/note/);assert.equal((await store.loadExecution()).stops[1].executionStatus,'PENDING');
 n.driverFailureNotes.value='Test access issue';n.driverFailureForm.onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await store.loadExecution()).stops[1].executionStatus,'FAILED');
 await n.driverPauseBtn.onclick();assert.equal(n.driverNextStop.hidden,true);assert.equal(n.driverNavigateAll.hidden,true);
 await n.driverResumeBtn.onclick();assert.equal(n.driverNextStop.hidden,false);assert.equal(n.driverStopSequence.textContent,'Stop 3 of 12');
});
test('empty and inactive accounts do not show an actionable route',async()=>{
 const empty=await page({route:{...fixtureRoute(),date:'2000-01-01'}});assert.equal(empty.nodes.driverRouteView.hidden,true);assert.equal(empty.nodes.driverCurrentTab.disabled,true);
 const denied=await page({profile:{role:'driver',active:false}});assert.match(denied.nodes.driverNotice.textContent,/Driver account required/);assert.equal(denied.store.calls.start,0);
});
test('WhatsApp accepts only explicit international contacts and never pre-fills a message',()=>{
 assert.equal(whatsappUrl({contactPhone:'+65 8000-0000'}),'https://wa.me/6580000000');
 for(const contactPhone of ['80000000','0123456789','javascript:alert(1)','+0123456789','+65',null])assert.equal(whatsappUrl({contactPhone}),null);
});
