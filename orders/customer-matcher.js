const norm=value=>String(value??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export const customerKey=norm;
export const customerIdForName=name=>`customer_${encodeURIComponent(norm(name)).slice(0,400)}`;
const push=(map,key,value)=>{if(!key)return;const items=map.get(key)||[];if(!items.some(item=>item.id===value.id))items.push(value);map.set(key,items);};
export function buildMasterIndex({customers=[],stops=[],contacts=[]}){
 const customerById=new Map(),byName=new Map(),byAccount=new Map(),stopsByCustomer=new Map(),contactsByCustomer=new Map();
 const addCustomer=customer=>{if(!customer?.id)return;customerById.set(customer.id,customer);for(const name of [customer.name,...(customer.aliases||[])])push(byName,norm(name),customer);if(customer.accountNumber)push(byAccount,norm(customer.accountNumber),customer);};
 customers.forEach(addCustomer);
 for(const stop of stops){const name=stop.customerName||(!stop.customerId?stop.name:'');const matched=!stop.customerId&&name?(byName.get(norm(name))||[]):[];const id=stop.customerId||(matched.length===1?matched[0].id:customerIdForName(name));if(!customerById.has(id))addCustomer({id,name,aliases:[],legacy:!stop.customerId});push(stopsByCustomer,id,{...stop,customerId:id});}
 for(const contact of contacts)push(contactsByCustomer,contact.customerId,contact);
 // Existing Saved Stops already carry delivery phone numbers. Expose these as
 // stop-specific contacts so imports can reuse them without duplicating records.
 for(const [customerId,customerStops] of stopsByCustomer){
  for(const stop of customerStops){
   const phone=String(stop.phone||stop['Hp No']||'').trim();
   if(!phone)continue;
   const existing=(contactsByCustomer.get(customerId)||[]).some(contact=>(!contact.savedStopId||contact.savedStopId===stop.id)&&String(contact.phone||'').replace(/\D/g,'')===phone.replace(/\D/g,''));
   if(!existing)push(contactsByCustomer,customerId,{id:`saved-stop-contact:${stop.id}`,customerId,savedStopId:stop.id,name:stop.contactName||'Delivery contact',phone,source:'saved-stop'});
  }
 }
 return {customerById,byName,byAccount,stopsByCustomer,contactsByCustomer,stops,contacts};
}
export function customerCandidates(order,index){const account=norm(order.customerAccount);const byAccount=account?index.byAccount.get(account)||[]:[];if(byAccount.length)return byAccount;return index.byName.get(norm(order.customerName))||[];}
export function stopCandidates(customerId,index){return index.stopsByCustomer.get(customerId)||[];}
export function contactCandidates(customerId,stopId,index){return (index.contactsByCustomer.get(customerId)||[]).filter(contact=>!contact.savedStopId||contact.savedStopId===stopId);}
export function selectStrongStop(order,stops){const code=norm(order.shipToCode);if(code){const matches=stops.filter(stop=>norm(stop.siteCode)===code);if(matches.length===1)return matches[0];}const address=norm(order.rawAddress||order.address);if(address){const matches=stops.filter(stop=>norm(stop.address)===address);if(matches.length===1)return matches[0];}return stops.length===1?stops[0]:null;}
export function selectStrongContact(order,contacts){const name=norm(order.rawInput?.contactName||order.contactName),phone=String(order.rawInput?.phone||order.phone||'').replace(/\D/g,'');if(name||phone){const matches=contacts.filter(contact=>(!name||norm(contact.name)===name)&&(!phone||String(contact.phone||'').replace(/\D/g,'')===phone));if(matches.length===1)return matches[0];}return contacts.length===1?contacts[0]:null;}
