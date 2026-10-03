const text=value=>String(value??'').trim();
const stopId=stop=>text(stop?.savedStopId||stop?.uniqueId||stop?.id);
export function enrichPlannedRoutes(plannedRoutes,orders,planningDate,{selectedOrderIds=null}={}){
 const selectedIds=Array.isArray(selectedOrderIds)?new Set(selectedOrderIds.map(text)):null;
 const groups=Array.isArray(plannedRoutes)?structuredClone(plannedRoutes):[];
 const occurrences=new Map();for(const group of groups)for(const stop of group.customerStops||[]){const id=stopId(stop);if(id)occurrences.set(id,(occurrences.get(id)||0)+1);}
 const byStop=new Map();for(const order of orders||[]){if(order?.status!=='READY'||order.executionStatus)continue;const id=text(order.savedStopId),internalId=text(order.internalId||order.id);if(!id||!internalId)continue;if(selectedIds?!selectedIds.has(internalId):order.deliveryDate!==planningDate)continue;const list=byStop.get(id)||[];list.push(order);byStop.set(id,list);}
 let linkedCount=0,ambiguousCount=0;
 for(const group of groups)for(const stop of group.customerStops||[]){const id=stopId(stop),matched=byStop.get(id)||[];if(!matched.length)continue;if(occurrences.get(id)!==1){ambiguousCount+=matched.length;continue;}const existing=Array.isArray(stop.orderIds)?stop.orderIds:[];stop.orderIds=[...new Set([...existing,...matched.map(order=>text(order.internalId||order.id))])];stop.orderNumbers=[...new Set(matched.map(order=>text(order.orderId)).filter(Boolean))];linkedCount+=matched.length;const contacts=[...new Set(matched.map(order=>text(order.contactId)).filter(Boolean))];if(contacts.length===1&&matched.every(order=>text(order.contactId)===contacts[0])){const source=matched.find(order=>text(order.contactName));stop.contactId=contacts[0];stop.contactName=text(source?.contactName)||null;stop.contactPhone=text(source?.contactPhone)||null;}const customers=[...new Set(matched.map(order=>text(order.customerId)).filter(Boolean))];if(customers.length===1)stop.customerId=customers[0];}
 return {plannedRoutes:groups,linkedCount,ambiguousCount};
}
