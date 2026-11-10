const text=value=>String(value??'').trim();
const stopId=stop=>text(stop?.savedStopId||stop?.uniqueId||stop?.id);
// An order with a confirmed one-time address was planned as its own stop; same rule as orders/route-plan-selection.js.
const oneTimeAddress=order=>{const value=order?.deliveryOverride,lat=Number(value?.lat),lng=Number(value?.lng);return !!value&&!!text(value.address)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0);};
export function enrichPlannedRoutes(plannedRoutes,orders,planningDate,{selectedOrderIds=null}={}){
 const selectedIds=Array.isArray(selectedOrderIds)?new Set(selectedOrderIds.map(text)):null;
 const groups=Array.isArray(plannedRoutes)?structuredClone(plannedRoutes):[];
 const occurrences=new Map();for(const group of groups)for(const stop of group.customerStops||[]){const id=stopId(stop);if(id)occurrences.set(id,(occurrences.get(id)||0)+1);}
 const byStop=new Map();for(const order of orders||[]){if(order?.status!=='READY'||order.executionStatus)continue;const internalId=text(order.internalId||order.id),id=oneTimeAddress(order)&&internalId?`order-address-${internalId}`:text(order.savedStopId);if(!id||!internalId)continue;if(selectedIds?!selectedIds.has(internalId):order.deliveryDate!==planningDate)continue;const list=byStop.get(id)||[];list.push(order);byStop.set(id,list);}
 let linkedCount=0,ambiguousCount=0;
 for(const group of groups)for(const stop of group.customerStops||[]){const id=stopId(stop),matched=byStop.get(id)||[];if(!matched.length)continue;if(occurrences.get(id)!==1){ambiguousCount+=matched.length;continue;}const existing=Array.isArray(stop.orderIds)?stop.orderIds:[];stop.orderIds=[...new Set([...existing,...matched.map(order=>text(order.internalId||order.id))])];stop.orderNumbers=[...new Set(matched.map(order=>text(order.orderId)).filter(Boolean))];linkedCount+=matched.length;const contacts=[...new Set(matched.map(order=>text(order.contactId)).filter(Boolean))];if(contacts.length===1&&matched.every(order=>text(order.contactId)===contacts[0])){const source=matched.find(order=>text(order.contactName));stop.contactId=contacts[0];stop.contactName=text(source?.contactName)||null;stop.contactPhone=text(source?.contactPhone)||null;}const customers=[...new Set(matched.map(order=>text(order.customerId)).filter(Boolean))];if(customers.length===1)stop.customerId=customers[0];}
 return {plannedRoutes:groups,linkedCount,ambiguousCount};
}
// Links an Order Hub plan to the routes the planner actually confirmed. The plan is a snapshot taken in Order Hub,
// so the planner may have removed stops or left some unassigned since. Those orders are reported in `unlinked`
// (and stay in Order Hub) instead of failing the whole confirm. Only a stop placed on more than one route is a
// real conflict: it is returned in `ambiguousStopIds` and the caller must stop.
export function reconcileOrderPlan(plannedRoutes,orders,planningDate,{orderIds=[],selectedStopIds=null,stopIdForOrder=null}={}){
 const planIds=[...new Set((orderIds||[]).map(text).filter(Boolean))];
 const orderKey=order=>text(order?.internalId||order?.id);
 const byId=new Map();for(const order of orders||[]){const key=orderKey(order);if(key)byId.set(key,order);}
 const planStopId=order=>{const normalized={...order,internalId:orderKey(order)};const id=typeof stopIdForOrder==='function'?stopIdForOrder(normalized):'';return text(id)||(oneTimeAddress(order)?`order-address-${orderKey(order)}`:text(order?.savedStopId));};
 const selected=selectedStopIds&&typeof selectedStopIds.has==='function'?selectedStopIds:null;
 const keptIds=planIds.filter(id=>{const order=byId.get(id);return !!order&&(!selected||selected.has(planStopId(order)));});
 const linked=enrichPlannedRoutes(plannedRoutes,orders,planningDate,{selectedOrderIds:keptIds});
 const occurrences=new Map();for(const group of linked.plannedRoutes)for(const stop of group.customerStops||[]){const id=stopId(stop);if(id)occurrences.set(id,(occurrences.get(id)||0)+1);}
 const linkedOrderIds=new Set();for(const group of linked.plannedRoutes)for(const stop of group.customerStops||[])for(const id of stop.orderIds||[])if(keptIds.includes(text(id)))linkedOrderIds.add(text(id));
 const unlinked=[],ambiguousStopIds=[];
 for(const id of planIds){
  if(linkedOrderIds.has(id))continue;
  const order=byId.get(id),stop=order?planStopId(order):'',entry={id,orderNumber:text(order?.orderId)||null,stopId:stop||null};
  if(!order)unlinked.push({...entry,reason:'order-not-found'});
  else if(selected&&!selected.has(stop))unlinked.push({...entry,reason:'stop-removed'});
  else if(!occurrences.get(stop))unlinked.push({...entry,reason:'stop-not-assigned'});
  else if(occurrences.get(stop)>1){unlinked.push({...entry,reason:'stop-on-multiple-routes'});if(!ambiguousStopIds.includes(stop))ambiguousStopIds.push(stop);}
  else unlinked.push({...entry,reason:'order-not-ready'});
 }
 return {plannedRoutes:linked.plannedRoutes,linkedCount:linked.linkedCount,ambiguousCount:linked.ambiguousCount,ambiguousStopIds,linkedOrderIds:[...linkedOrderIds],unlinked};
}
