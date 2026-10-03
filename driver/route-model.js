const text=value=>String(value??'').trim();
const finite=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
const point=stop=>{let lat=finite(stop.lat??stop.latitude),lng=finite(stop.lng??stop.longitude);if((lat===null||lng===null)&&text(stop.coordinate)){const pair=text(stop.coordinate).split(',').map(Number);if(pair.length===2&&pair.every(Number.isFinite))[lat,lng]=pair;}return {lat:lat!==null&&Math.abs(lat)<=90?lat:null,lng:lng!==null&&Math.abs(lng)<=180?lng:null};};
export function snapshotRouteStops(route){
 const groups=Array.isArray(route?.plannedRoutes)?route.plannedRoutes:[];const stops=[];
 for(const [groupIndex,group] of groups.entries()){
  if(!group)continue;const source=Array.isArray(group.customerStops)?group.customerStops:[];
  const byId=new Map(source.map(stop=>[text(stop?.id||stop?.uniqueId||stop?.savedStopId),stop]).filter(([id])=>id));
  const optimized=Array.isArray(group.optimizedStops)?group.optimizedStops.map(value=>text(value?.id||value?.uniqueId||value)).filter(id=>byId.has(id)):[];
  const fallback=Array.isArray(group.originalWaypoints)&&group.originalWaypoints.length?group.originalWaypoints.map(value=>text(value?.id||value?.uniqueId||value)):source.map(stop=>text(stop?.id||stop?.uniqueId||stop?.savedStopId));
  const ids=[...new Set([...optimized,...fallback])];
  for(const [index,id] of ids.entries()){
   const stop=byId.get(id)||source[index]||null;if(!stop)continue;
   const savedStopId=text(stop.savedStopId||stop.id||stop.uniqueId||id);const {lat,lng}=point(stop);
   const address=text(stop.deliveryAddress||stop.address||stop.Address);
   const stopName=text(stop.stopName||stop.label||stop.name||stop.Name)||`Stop ${stops.length+1}`;
   const rawOrders=Array.isArray(stop.orderIds)?stop.orderIds:Array.isArray(stop.orders)?stop.orders:[];
   const orderIds=[...new Set(rawOrders.map(item=>text(typeof item==='object'?(item.internalId||item.id||item.orderId):item)).filter(Boolean))];const orderNumbers=[...new Set((Array.isArray(stop.orderNumbers)?stop.orderNumbers:[]).map(text).filter(Boolean))];
   const timing=(Array.isArray(group.detailedStopTimes)?group.detailedStopTimes:[]).find(item=>text(item?.stopId)===savedStopId&&item?.arrivalTimeStr);
   stops.push({id:`${text(group.id)||groupIndex+1}:${savedStopId||index+1}:${index+1}`,sequence:stops.length+1,groupId:text(group.id||groupIndex+1),customerId:text(stop.customerId)||null,savedStopId:savedStopId||null,customerName:text(stop.customerName||stop.Name||stop.name),stopName,deliveryAddress:address||null,lat,lng,contactId:text(stop.contactId)||null,contactName:text(stop.contactName)||null,contactPhone:text(stop.contactPhone||stop.phone||stop['Hp No'])||null,orderIds,orderNumbers,plannedEta:timing?.arrivalTimeStr||null,notes:text(stop.notes||stop.note)||null,executionStatus:'PENDING',actualArrivalAt:null,actualCompletedAt:null});
  }
 }
 return stops;
}
export function progress(stops){const rows=Array.isArray(stops)?stops:[];const delivered=rows.filter(s=>s.executionStatus==='DELIVERED').length,failed=rows.filter(s=>s.executionStatus==='FAILED').length;return {total:rows.length,delivered,failed,processed:delivered+failed,remaining:rows.length-delivered-failed,next:rows.find(s=>!['DELIVERED','FAILED'].includes(s.executionStatus))||null};}
export const isActionable=stop=>stop&&['PENDING','ARRIVED'].includes(stop.executionStatus||'PENDING');
