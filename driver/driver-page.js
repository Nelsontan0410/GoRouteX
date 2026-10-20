import {DriverRouteStore} from './route-store.js';
import {progress,snapshotRouteStops} from './route-model.js';
import {navigationUrl,callUrl,navigationParts,whatsappUrl} from './navigation.js';
import {loadContactRequired} from '../orders/master-data.js';
const $=id=>document.getElementById(id);
const state={user:null,store:null,routes:[],route:null,execution:null,busy:false,contactRequired:false,photoUrl:null,selectedStopId:null,screen:'route'};
function notice(message='',error=false){const node=$('driverNotice');node.textContent=message;node.classList.toggle('is-error',error);node.hidden=!message;}
function label(value,fallback='—'){return String(value??'').trim()||fallback;}
function stopRows(){return state.execution?.stops||snapshotRouteStops(state.route);}
function displayStop(stop){const node=$('driverStopDetail');if(!stop){node.hidden=true;return;}node.replaceChildren();const title=document.createElement('strong');title.textContent=`${stop.sequence}. ${stop.stopName}`;const body=document.createElement('p');body.textContent=[stop.deliveryAddress,stop.contactName,stop.contactPhone,...(stop.orderIds||[]),stop.failureReason,stop.failureNotes].filter(Boolean).join(' · ');node.append(title,body);node.hidden=false;}
function routeChoices(){const list=$('driverRouteList');list.replaceChildren();if(!state.routes.length){const empty=document.createElement('p');empty.textContent='No route assigned. Your dispatcher will add one when it is ready.';list.append(empty);return;}for(const route of state.routes){const button=document.createElement('button');button.type='button';button.className='driver-route-choice';button.dataset.routeId=route.id;button.setAttribute('aria-current',String(state.route?.id===route.id));const title=document.createElement('strong');const siblings=route.dispatchPlanId?state.routes.filter(item=>item.dispatchPlanId===route.dispatchPlanId).length:1;title.textContent=(route.routeName||`Route ${route.id}`)+(siblings>1?` (of ${siblings})`:'');const meta=document.createElement('small');meta.textContent=[route.date||route.planningDate,route.vehicleDriver].filter(Boolean).join(' · ')||'Saved route';button.append(title,meta);list.append(button);}}
const statusLabel = value => ({ASSIGNED:'Assigned', IN_PROGRESS:'In progress', PAUSED:'Paused', COMPLETED:'Completed', STOPPED:'Stopped', PENDING:'Pending', ARRIVED:'Arrived', DELIVERED:'Delivered', FAILED:'Failed'}[value] || value || 'Pending');
function setScreen(screen, focus = false) {
 state.screen = screen;
 $('driverExecution').dataset.screen = screen;
 $('driverRouteView').dataset.screen = screen;
 for (const [id, name] of [['driverOverviewTab','route'],['driverCurrentTab','current']]) {
  if (screen === name) $(id).setAttribute('aria-current','page'); else $(id).removeAttribute('aria-current');
 }
 if (focus) {
  const target = $(screen === 'current' ? 'driverCurrentHeading' : 'driverRouteName');
  target.setAttribute('tabindex','-1');
  target.focus({preventScroll:true});
  target.scrollIntoView({behavior:'instant',block:'start'});
 }
}
function render() {
 routeChoices();
 const route=state.route, execution=state.execution;
 $('driverRouteView').hidden=!route;
 $('driverCurrentTab').disabled=!execution;
 $('driverRefreshBtn').disabled=state.busy;
 $('driverExecution').setAttribute('aria-busy',String(state.busy));
 if (!route) { setScreen('route'); return; }
 const stops=stopRows(), p=progress(stops);
 const active=execution?.status==='IN_PROGRESS', paused=execution?.status==='PAUSED';
 $('driverRouteName').textContent=label(route.routeName,`Route ${route.id}`);
 $('driverRouteDate').textContent=label(route.date||route.planningDate,'Saved route');
 $('driverRouteMeta').textContent=[route.vehicleDriver||'',`${p.total} stops`,route.orderLinkStatus==='UNAVAILABLE'?'Order Hub links unavailable when saved':route.orderLinkStatus==='AMBIGUOUS'?'Some orders need route review':null].filter(Boolean).join(' · ');
 $('driverRouteStatus').textContent=statusLabel(execution?.status||'ASSIGNED');
 $('driverRouteStatus').dataset.status=execution?.status||'ASSIGNED';
 $('driverProgress').replaceChildren();
 const strong=document.createElement('strong'); strong.textContent=`${p.processed} of ${p.total} stops processed`;
 $('driverProgress').append(strong);
 $('driverProgressBar').max=p.total||1; $('driverProgressBar').value=p.processed;
 $('driverProgressBar').setAttribute('aria-valuetext',`${p.processed} of ${p.total} stops processed`);
 $('driverMetrics').replaceChildren();
 for (const [name,value] of [['Delivered',p.delivered],['Failed',p.failed],['Remaining',p.remaining]]) {
  const item=document.createElement('div'), count=document.createElement('strong'), caption=document.createElement('span');
  count.textContent=value; caption.textContent=name; item.append(count,caption); $('driverMetrics').append(item);
 }
 $('driverStartArea').hidden=!!execution;
 $('driverStartBtn').disabled=state.busy||!p.total;
 $('driverRouteControls').hidden=!active&&!paused;
 $('driverContinueBtn').hidden=!active;
 $('driverPauseBtn').hidden=!active;
 $('driverResumeBtn').hidden=!paused;
 for (const id of ['driverContinueBtn','driverPauseBtn','driverResumeBtn','driverStopBtn']) $(id).disabled=state.busy;
 $('driverEndedSummary').hidden=!['COMPLETED','STOPPED'].includes(execution?.status);
 $('driverEndedSummary').textContent=execution?.status==='COMPLETED'?'Route completed. Location sharing has ended.':`Route stopped with ${p.remaining} stops remaining. Undelivered stops keep their recorded status.`;
 $('driverNextStop').hidden=!active||!p.next;
 $('driverFinishArea').hidden=!active||!!p.next;
 $('driverCurrentEmpty').hidden=active;
 $('driverCurrentEmpty').replaceChildren();
 if (!active) {
  const title=document.createElement('h3'), copy=document.createElement('p');
  title.textContent=paused?'Route paused':execution?.status==='COMPLETED'?'Route completed':execution?.status==='STOPPED'?'Route stopped':'Ready when you are';
  copy.textContent=paused?'Continue Route to resume location sharing and delivery actions.':execution?'View your route for stop results.':'Start Route to open your first stop and share location.';
  $('driverCurrentEmpty').append(title,copy);
 }
 if (active&&p.next) {
  const stop=p.next;
  $('driverStopSequence').textContent=`Stop ${stop.sequence} of ${p.total}`;
  $('driverStopState').textContent=statusLabel(stop.executionStatus);
  $('driverStopName').textContent=label(stop.stopName);
  $('driverStopCustomer').textContent=stop.customerName&&stop.customerName!==stop.stopName?stop.customerName:'';
  $('driverStopCustomer').hidden=!$('driverStopCustomer').textContent;
  $('driverStopAddress').textContent=label(stop.deliveryAddress,'Delivery address missing — contact operations');
  $('driverStopContact').textContent=[stop.contactName,stop.contactPhone].filter(Boolean).join(' · ')||(state.contactRequired?'Contact missing in saved route':'No contact listed');
  $('driverStopNotes').textContent=stop.notes||''; $('driverStopNotes').hidden=!stop.notes;
  const orders=$('driverStopOrders'); orders.replaceChildren();
  for (const id of stop.orderNumbers?.length?stop.orderNumbers:stop.orderIds||[]) {const chip=document.createElement('span');chip.textContent=id;orders.append(chip);}
  const nav=navigationUrl(stop), call=callUrl(stop), whatsapp=whatsappUrl(stop);
  for (const [id,url] of [['driverNavigate',nav],['driverCall',call],['driverWhatsApp',whatsapp]]) {
   $(id).hidden=!url; if(url) $(id).href=url; else $(id).removeAttribute('href');
  }
  $('driverContactHint').textContent=[!nav?'Navigation unavailable: no saved address or coordinates.':'',!call?'No callable phone number saved.':!whatsapp?'WhatsApp needs a saved number with + and country code.':''].filter(Boolean).join(' ');
  $('driverContactHint').hidden=!$('driverContactHint').textContent;
  $('driverArriveBtn').hidden=stop.executionStatus!=='PENDING';
  $('driverDeliverBtn').hidden=stop.executionStatus!=='ARRIVED';
  $('driverOutcomeHint').textContent=stop.executionStatus==='ARRIVED'?'Confirm delivery details before saving the result.':'Mark arrived before recording a delivery.';
  for (const id of ['driverArriveBtn','driverDeliverBtn','driverFailBtn']) $(id).disabled=state.busy;
 }
 const upcoming=active&&p.next?stops.find(stop=>stop.sequence>p.next.sequence&&!['DELIVERED','FAILED'].includes(stop.executionStatus)):null;
 $('driverUpcoming').hidden=!upcoming;
 if(upcoming){$('driverUpcoming').dataset.stopId=upcoming.id;$('driverUpcomingName').textContent=`${upcoming.sequence}. ${upcoming.stopName}`;$('driverUpcomingAddress').textContent=upcoming.deliveryAddress||'Address unavailable';}
 renderNavigateAll(route,stops,execution);
 if(active&&!p.next){$('driverFinishSummary').textContent=`${p.delivered} delivered, ${p.failed} failed. The failed stops will remain failed.`;$('driverFinishBtn').disabled=state.busy;}
 for(const form of [$('driverPodForm'),$('driverFailureForm')]) for(const control of form.elements) control.disabled=state.busy;
 const list=$('driverStopList'); list.replaceChildren(); $('driverStopsCount').textContent=`${p.total} stops`;
 for(const stop of stops) {
  const button=document.createElement('button');button.type='button';
  button.className=`driver-stop-item is-${String(stop.executionStatus||'PENDING').toLowerCase()}${p.next?.id===stop.id?' is-current':''}`;
  button.dataset.stopId=stop.id; button.setAttribute('aria-expanded',String(state.selectedStopId===stop.id));button.setAttribute('aria-controls','driverStopDetail');
  const num=document.createElement('span');num.className='driver-stop-number';num.textContent=String(stop.sequence).padStart(2,'0');
  const copy=document.createElement('span');copy.className='driver-stop-copy';
  const title=document.createElement('strong');title.textContent=stop.stopName;
  const sub=document.createElement('small');sub.textContent=stop.deliveryAddress||'Address unavailable';copy.append(title,sub);
  const badge=document.createElement('span');badge.className='driver-stop-badge';badge.textContent=p.next?.id===stop.id&&active?'Current':statusLabel(stop.executionStatus||'PENDING');
  button.append(num,copy,badge);list.append(button);
 }
 displayStop(stops.find(stop=>stop.id===state.selectedStopId)||null);
 setScreen(state.screen||'route');
 renderLocationAlert();
}
// The driver sees today's routes only; routes of other days stay in Dispatch history.
const todayKey=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const todaysRoutes=routes=>routes.filter(route=>String(route.date||route.planningDate||'').slice(0,10)===todayKey());
async function loadRoutes(preferredId){if(!state.user)return;notice('Loading assigned routes…');state.routes=todaysRoutes(await state.store.listAssignedRoutes());const id=preferredId||new URLSearchParams(location.search).get('routeId')||state.route?.id||state.routes[0]?.id;state.route=state.routes.find(route=>String(route.id)===String(id))||(!preferredId?state.routes[0]:null)||null;state.store.mode=state.route?.__storageMode||state.store.baseMode;state.store.dispatchOwnerUid=state.route?.dispatchOwnerUid||null;state.execution=state.route?await state.store.loadExecution(state.route.id):null;if(state.route?.dispatchOwnerUid)state.store.retryPendingOrderSync(state.route.id).catch(console.warn);state.selectedStopId=null;hideForms();clearPhoto();$('driverPodForm').reset();$('driverFailureForm').reset();if(!state.execution)state.screen='route';render();notice(state.route?'':'No route for today.');if(state.route&&state.execution?.status==='IN_PROGRESS')await resumeTracking();else if(state.route&&['COMPLETED','STOPPED','PAUSED'].includes(state.execution?.status)&&await waitTrackingReady()){try{window.DriverTrackingPage.setRouteContext(state.route);if(window.DriverTrackingPage.getStatus()!=='stopped')await window.DriverTrackingPage.stopTracking();}catch(error){notice(`Route complete, but tracking status could not sync: ${error.message}`,true);}}else if(!state.route&&await waitTrackingReady()&&!['ready','stopped'].includes(window.DriverTrackingPage.getStatus())){try{await window.DriverTrackingPage.stopTracking();}catch(error){notice(`Location status could not sync: ${error.message}`,true);}}}
async function waitTrackingReady(){if(window.DriverTrackingPage?.isReady?.())return true;return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),8000);window.addEventListener('goroutex:tracking-ready',()=>{clearTimeout(timer);resolve(true);},{once:true});});}
async function resumeTracking(){if(!await waitTrackingReady()){notice('Route is active. Location module is unavailable; reload to retry.',true);return;}try{window.DriverTrackingPage.setRouteContext(state.route);if(window.DriverTrackingPage.getStatus()!=='active'){const started=await window.DriverTrackingPage.startTracking();if(!started)notice('Route is active. Location unavailable; check browser permission and try refreshing.',true);}}catch(error){notice(`Route is active. Location unavailable: ${error.message}`,true);}}
async function perform(work){if(state.busy)return;state.busy=true;render();notice('Saving…');try{await work();render();}catch(error){notice(`${error.message||'Save failed.'} Retry the action.`,true);}finally{state.busy=false;render();if(state.execution?.status==='IN_PROGRESS')window.DriverTrackingPage?.refreshNow?.();}}
// Starting the route creates the execution (progress for the office) and starts location sharing.
function startRoute(){return perform(async()=>{state.execution=await state.store.start(state.route);notice('Route started. Location sharing requested.');setScreen('current',true);await resumeTracking();});}
// Location problems stay visible until fixed: without location the office's Live view cannot see the driver.
function renderLocationAlert(){const box=$('driverLocationAlert');if(!box)return;const problem=state.execution?.status==='IN_PROGRESS'?window.DriverTrackingPage?.getProblem?.():null;box.hidden=!problem;if(!problem)return;$('driverLocationAlertText').textContent=problem.denied?'Location is off, so the office cannot see you on Live view. iPhone: Settings › Privacy & Security › Location Services › Safari Websites › While Using the App. Android: allow Location for Chrome. Then tap Retry.':`Location problem: ${problem.message} Tap Retry.`;}
async function compressPhoto(file){if(!file)return null;if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw Error('Choose a JPEG, PNG or WebP photo.');if(file.size>15_000_000)throw Error('Photo exceeds 15 MB. Choose a smaller image.');const bitmap=await createImageBitmap(file);try{let scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));for(let attempt=0;attempt<4;attempt++){const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',Math.max(.52,.8-attempt*.08));if(data.length<=550000)return data;scale*=.75;}throw Error('Photo is still too large after resizing. Choose a smaller image.');}finally{bitmap.close?.();}}
function hideForms(){$('driverPodForm').hidden=true;$('driverFailureForm').hidden=true;}
function clearPhoto(){if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);state.photoUrl=null;$('driverPhoto').value='';$('driverPhotoPreview').hidden=true;$('driverPhotoClear').hidden=true;}
function bind(){
 $('driverOverviewTab').onclick=()=>setScreen('route',true);
 $('driverCurrentTab').onclick=()=>setScreen('current',true);
 $('driverContinueBtn').onclick=()=>setScreen('current',true);
 $('driverBackToRoute').onclick=()=>setScreen('route',true);
 $('driverUpcoming').onclick=()=>{state.selectedStopId=$('driverUpcoming').dataset.stopId;render();setScreen('route');$('driverStopDetail').focus();$('driverStopDetail').scrollIntoView({block:'center'});};
 $('driverLocationRetry').onclick=()=>{resumeTracking().then(()=>{window.DriverTrackingPage?.refreshNow?.();renderLocationAlert();});};
 $('driverRefreshBtn').onclick=()=>perform(async()=>{await loadRoutes();notice('Routes refreshed.');});$('driverRouteList').onclick=event=>{const button=event.target.closest('[data-route-id]');if(button&&!state.busy)perform(async()=>{if(state.execution?.status==='IN_PROGRESS'&&state.route?.id!==button.dataset.routeId)throw Error('Complete the active route before switching.');await loadRoutes(button.dataset.routeId);notice('');});};$('driverStopList').onclick=event=>{const button=event.target.closest('[data-stop-id]');if(button){state.selectedStopId=state.selectedStopId===button.dataset.stopId?null:button.dataset.stopId;render();if(state.selectedStopId){$('driverStopDetail').focus();$('driverStopDetail').scrollIntoView({block:'nearest'});}}};
 $('driverStartBtn').onclick=startRoute;
 $('driverArriveBtn').onclick=()=>perform(async()=>{const stop=progress(state.execution.stops).next;state.execution=await state.store.arrive(state.route.id,stop.id,window.DriverTrackingPage?.getLatestPosition?.());notice(`${stop.stopName}: arrival saved.`);});
 $('driverDeliverBtn').onclick=()=>{hideForms();const stop=progress(state.execution.stops).next;$('driverRecipient').value=stop.contactName||'';$('driverPodForm').hidden=false;$('driverPodForm').scrollIntoView({behavior:'smooth',block:'center'});};$('driverPodCancel').onclick=()=>{$('driverPodForm').hidden=true;clearPhoto();$('driverPodForm').reset();};$('driverPhoto').onchange=()=>{if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);const file=$('driverPhoto').files?.[0];state.photoUrl=file?URL.createObjectURL(file):null;$('driverPhotoPreview').hidden=!state.photoUrl;$('driverPhotoClear').hidden=!state.photoUrl;if(state.photoUrl)$('driverPhotoPreview').src=state.photoUrl;};$('driverPhotoClear').onclick=clearPhoto;
 $('driverPodForm').onsubmit=event=>{event.preventDefault();perform(async()=>{const stop=progress(state.execution.stops).next,photo=await compressPhoto($('driverPhoto').files?.[0]);state.execution=await state.store.deliver(state.route.id,stop.id,{recipientName:$('driverRecipient').value,notes:$('driverPodNotes').value,photoDataUrl:photo,position:window.DriverTrackingPage?.getLatestPosition?.()});hideForms();clearPhoto();$('driverPodForm').reset();notice(`${stop.stopName} delivered. Next stop is ready.`);});};
 $('driverFailBtn').onclick=()=>{hideForms();$('driverFailureForm').hidden=false;$('driverFailureForm').scrollIntoView({behavior:'smooth',block:'center'});};$('driverFailureCancel').onclick=()=>{$('driverFailureForm').hidden=true;$('driverFailureForm').reset();};$('driverFailureForm').onsubmit=event=>{event.preventDefault();perform(async()=>{const stop=progress(state.execution.stops).next;state.execution=await state.store.fail(state.route.id,stop.id,$('driverFailureReason').value,$('driverFailureNotes').value,window.DriverTrackingPage?.getLatestPosition?.());hideForms();$('driverFailureForm').reset();notice(`${stop.stopName} marked failed. Continue to the next stop.`);});};
 $('driverPauseBtn').onclick=()=>perform(async()=>{state.execution=await state.store.pause(state.route.id);const stopped=await window.DriverTrackingPage?.stopTracking?.();notice(stopped?'Route paused. Location sharing is off.':'Route paused. Location stopped on this device; remote status will retry when online.',!stopped);});
 $('driverResumeBtn').onclick=()=>perform(async()=>{state.execution=await state.store.resume(state.route.id);notice('Route resumed. Location sharing requested.');setScreen('current',true);await resumeTracking();});
 $('driverStopBtn').onclick=()=>{const left=progress(stopRows()).remaining;if(!confirm(left?`Stop this route now? ${left} stop(s) are not delivered yet and stay undelivered.`:'Stop this route now?'))return;perform(async()=>{state.execution=await state.store.stop(state.route.id);const stopped=await window.DriverTrackingPage?.stopTracking?.();notice(stopped?'Route stopped. Location sharing is off.':'Route stopped. Location stopped on this device; remote status will retry when online.',!stopped);});};
 $('driverFinishBtn').onclick=()=>perform(async()=>{state.execution=await state.store.finish(state.route.id);const stopped=await window.DriverTrackingPage?.stopTracking?.();notice(stopped?'Route completed. Location sharing stopped.':'Route completed. Location stopped on this device; remote status will retry when online.',!stopped);});
}
bind();
if(!window.FirebaseApp?.auth?.onAuthStateChange)notice('Sign-in service is unavailable. Reload this page.',true);else window.FirebaseApp.auth.onAuthStateChange(async user=>{if(!user){notice('Sign in to view your assigned routes.',true);return;}state.user=user;try{const profileResult=await window.FirebaseApp.auth.getProfile?.();const profile=profileResult?.success?profileResult.profile||{}:{};if(!window.FirebaseApp.auth.isDriverAccount?.(user)||profile.role!=='driver'||profile.active===false){notice('Driver account required. Use Driver Login.',true);return;}state.store=await DriverRouteStore.create(user,profile);try{state.contactRequired=await loadContactRequired(user.uid);}catch{state.contactRequired=false;}await loadRoutes();}catch(error){notice(`Could not load assigned routes: ${error.message}`,true);}});
// One tap opens Google Maps with the day's stops, in parts of 9 stops (driver/navigation.js). Before the route
// starts: from the start location; once started: the remaining stops from the phone's location.
function renderNavigateAll(route,stops,execution){const box=$('driverNavigateAll');if(!box)return;box.replaceChildren();const started=execution?.status==='IN_PROGRESS';const remaining=stops.filter(stop=>['PENDING','ARRIVED'].includes(stop.executionStatus||'PENDING'));const list=started?remaining:stops;if(!list.length||['COMPLETED','STOPPED','PAUSED'].includes(execution?.status)){box.hidden=true;return;}
 const group=Array.isArray(route.plannedRoutes)&&route.plannedRoutes.length===1?route.plannedRoutes[0]:null;const offset=stops.length-list.length;
 const detours=group?[...(group.manualWaypoints||[]),...(group.safetyWaypoints||[])].map(point=>({...point,legIndex:point.legIndex-offset})).filter(point=>point.legIndex>=0):[];
 const parts=navigationParts({origin:started?null:(route.originLatLng||{address:route.originName}),originLabel:'Start',end:route.endLatLng||(route.endLocationLabel&&route.endLocationLabel!=='Same as Start'?{address:route.endLocationLabel}:null),endLabel:'End',stops:list,detours});if(!parts.length){box.hidden=true;return;}
 const title=document.createElement('h3');title.textContent='Google Maps navigation';const row=document.createElement('div');row.className='driver-navigate-parts';
 parts.forEach((part,index)=>{const link=document.createElement('a');link.className='driver-secondary';link.href=part.url;link.target='_blank';link.rel='noopener';// Navigation only opens Maps. Start Route owns execution and GPS.
link.textContent=`${index===0?'Start Navigation · ':''}Part ${index+1}: ${part.fromLabel} → ${part.toLabel}`;row.append(link);});
 const hint=document.createElement('small');hint.textContent=parts.length>1?'Up to 9 stops per part. Open the next part at the last stop of this one. Navigation does not start your route or location sharing.':'Opens Google Maps in saved stop order. Navigation does not start your route or location sharing.';box.append(title,row,hint);box.hidden=false;}


// Back from Google Maps: send the position at once and make sure location sharing still runs.
document.addEventListener('visibilitychange',()=>{if(document.hidden||state.execution?.status!=='IN_PROGRESS')return;resumeTracking().then(()=>window.DriverTrackingPage?.refreshNow?.()).catch(console.warn);});
setInterval(renderLocationAlert,3000);
