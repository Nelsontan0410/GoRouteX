import { customerCandidates,stopCandidates,contactCandidates,selectStrongStop,selectStrongContact } from './customer-matcher.js';
// A usable map position: finite numbers in range, not the 0,0 placeholder.
export function hasMapPosition(stop){const lat=stop?.lat,lng=stop?.lng;return typeof lat==='number'&&typeof lng==='number'&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0);}
// A one-time delivery address for this order only (the customer's saved stop stays unchanged).
// Usable only with a confirmed map position.
export function deliveryOverrideOf(order){const value=order?.deliveryOverride;if(!value||!String(value.address||'').trim())return null;const point={lat:Number(value.lat),lng:Number(value.lng)};return hasMapPosition(point)?{address:String(value.address).trim(),...point}:null;}
// Issues this module adds; stripped from the input so resolving a saved order again does not repeat them.
const RESOLUTION_ISSUES=new Set(['Select the correct customer.','Customer not found. Add a delivery stop for this customer.','Select a delivery stop for this order.','Add a delivery stop for this customer.','This delivery stop has no map position. Open the stop and pick its address on the map.','Select the correct contact.','Add a contact for this order.']);
export function resolveOrder(order,index,{contactRequired=false}={}){
 const customerOptions=customerCandidates(order,index);const customer=order.customerId?index.customerById.get(order.customerId):customerOptions.length===1?customerOptions[0]:null;
 const stops=customer?stopCandidates(customer.id,index):[];
 // A saved stop that no longer exists (deleted and re-imported) falls back to the same strong match as a new order.
 const stop=(order.savedStopId&&stops.find(item=>item.id===order.savedStopId))||selectStrongStop(order,stops);
 const contacts=customer?contactCandidates(customer.id,stop?.id,index):[];
 const contact=(order.contactId&&contacts.find(item=>item.id===order.contactId))||selectStrongContact(order,contacts);
 const override=stop?deliveryOverrideOf(order):null;
 const issues=(order.baseValidationIssues||order.validationIssues||[]).filter(issue=>!RESOLUTION_ISSUES.has(issue)&&!(stop&&issue==='Add a usable delivery address.'));
 if(!customer)issues.push(customerOptions.length>1?'Select the correct customer.':'Customer not found. Add a delivery stop for this customer.');
 if(customer&&!stop)issues.push(stops.length>1?'Select a delivery stop for this order.':'Add a delivery stop for this customer.');
 // Route planning needs a map position, not only address text: the one-time address's, else the stop's.
 const onMap=!!override||hasMapPosition(stop);
 if(stop&&!onMap)issues.push('This delivery stop has no map position. Open the stop and pick its address on the map.');
 if(contactRequired&&!contact)issues.push(contacts.length>1?'Select the correct contact.':'Add a contact for this order.');
 let resolutionCode=null;if(!customer||!stop)resolutionCode=!customer||!stops.length?'NEEDS_STOP':'SELECT_STOP';if(contactRequired&&!contact)resolutionCode=resolutionCode?'NEEDS_STOP_AND_CONTACT':contacts.length?'SELECT_CONTACT':'NEEDS_CONTACT';if(!resolutionCode&&stop&&!onMap)resolutionCode='STOP_NOT_ON_MAP';
 const address=override?.address||stop?.address||order.address||null;
 const resolved={...order,customerId:customer?.id||null,savedStopId:stop?.id||null,contactId:contact?.id||null,
  address,deliveryAddress:address,
  latitude:override?override.lat:stop?.lat??order.latitude??null,longitude:override?override.lng:stop?.lng??order.longitude??null,
  contactName:contact?.name||null,contactPhone:contact?.phone||null,
  validationIssues:issues,validationStatus:issues.length?'INVALID':'VALID',resolutionCode,
  status:order.duplicateKind?'DUPLICATE':issues.length?'NEEDS_REVIEW':'READY'};
 return {order:resolved,customerOptions,stops,contacts};
}
