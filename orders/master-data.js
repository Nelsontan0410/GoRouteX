import { customerIdForName,customerKey } from './customer-matcher.js';
const db=()=>firebase.firestore();
const userRoot=uid=>db().collection('users').doc(uid);
export async function loadMasterData(uid,{forceReload=false}={}){const root=userRoot(uid);const [customersSnap,contactsSnap,stopsResult]=await Promise.all([root.collection('orderCustomers').get(),root.collection('orderContacts').get(),window.RoutePlannerStorage.loadStops({forceReload,serverFirst:true,allowCacheFallback:!forceReload,profile:window.currentUserProfile||{}})]);if(!stopsResult.success)throw Error(stopsResult.error||'Saved stops could not be loaded.');return {customers:customersSnap.docs.map(d=>({id:d.id,...d.data()})),contacts:contactsSnap.docs.map(d=>({id:d.id,...d.data()})),stops:stopsResult.stops||[]};}
export async function ensureCustomer(uid,{id,name,accountNumber}={}){if(!name?.trim())throw Error('Customer name is required.');const root=userRoot(uid),snapshot=await root.collection('orderCustomers').get();const existing=snapshot.docs.map(d=>({id:d.id,...d.data()})).find(c=>id?c.id===id:customerKey(c.name)===customerKey(name)||c.aliases?.some(alias=>customerKey(alias)===customerKey(name)));if(existing)return existing;const customerId=id||customerIdForName(name),ref=root.collection('orderCustomers').doc(customerId);const data={id:customerId,name:name.trim(),accountNumber:accountNumber?.trim()||null,aliases:[],createdAt:new Date().toISOString()};await ref.set(data,{merge:true});return data;}
export async function saveContact(uid,input){const customerId=String(input.customerId||'').trim(),name=String(input.name||'').trim(),phone=String(input.phone||'').trim(),savedStopId=input.savedStopId||null;if(!customerId||!name)throw Error('Customer and contact name are required.');const root=userRoot(uid),collection=root.collection('orderContacts'),snapshot=await collection.get();const duplicate=snapshot.docs.find(doc=>{const c=doc.data();return c.customerId===customerId&&(c.savedStopId||null)===savedStopId&&customerKey(c.name)===customerKey(name)&&String(c.phone||'').replace(/\D/g,'')===phone.replace(/\D/g,'');});if(duplicate)return {id:duplicate.id,...duplicate.data(),duplicate:true};const id=crypto.randomUUID(),contact={id,customerId,savedStopId,name,phone,role:String(input.role||'').trim(),createdAt:new Date().toISOString()};await collection.doc(id).set(contact);return contact;}
export async function loadContactRequired(uid){const doc=await userRoot(uid).collection('settings').doc('orderHub').get();return doc.exists&&doc.data()?.contactRequired===true;}
export async function saveContactRequired(uid,value){await userRoot(uid).collection('settings').doc('orderHub').set({contactRequired:value===true,updatedAt:new Date().toISOString()},{merge:true});}

export async function updateContact(uid,id,input){
 const ref=userRoot(uid).collection('orderContacts').doc(String(id||''));
 const current=await ref.get();if(!current.exists)throw Error('This contact no longer exists. Refresh Search.');
 const customerId=String(input.customerId||'').trim(),name=String(input.name||'').trim();
 if(!customerId||!name)throw Error('Customer and contact name are required.');
 const next={customerId,savedStopId:input.savedStopId||null,name,phone:String(input.phone||'').trim(),role:String(input.role||'').trim(),updatedAt:new Date().toISOString()};
 await ref.set(next,{merge:true});return {id,...current.data(),...next};
}
export async function deleteContact(uid,id){
 const ref=userRoot(uid).collection('orderContacts').doc(String(id||''));
 const current=await ref.get();if(!current.exists)throw Error('This contact no longer exists. Refresh Search.');
 await ref.delete();return true;
}
