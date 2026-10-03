import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMasterIndex,customerCandidates,stopCandidates,contactCandidates} from '../orders/customer-matcher.js';
import {resolveOrder} from '../orders/order-readiness.js';

const customer={id:'customer-abc',name:'ABC Trading Sdn Bhd',aliases:['ABC Trading'],accountNumber:'C-001'};
const rawang={id:'stop-rawang',customerId:customer.id,name:'Rawang Warehouse',label:'Rawang Warehouse',siteCode:'SH001',address:'12 Rawang Road',lat:3.3,lng:101.5};
const kl={id:'stop-kl',customerId:customer.id,name:'KL Warehouse',label:'KL Warehouse',siteCode:'SH002',address:'24 KL Road',lat:3.1,lng:101.7};
const ahming={id:'contact-ahming',customerId:customer.id,savedStopId:rawang.id,name:'Ah Ming',phone:'012-1111111'};
const jason={id:'contact-jason',customerId:customer.id,savedStopId:kl.id,name:'Jason',phone:'017-2222222'};
const purchasing={id:'contact-purchasing',customerId:customer.id,savedStopId:null,name:'Purchasing',phone:'03-3333333'};
const order={internalId:'ord-1',orderId:'ORD001',customerName:'ABC TRADING',customerAccount:'C-001',address:null,rawAddress:null,rawInput:{},baseValidationIssues:['Add a usable delivery address.']};

test('customer account and confirmed alias match, but unknown customer remains unresolved',()=>{
 const index=buildMasterIndex({customers:[customer],stops:[rawang],contacts:[]});
 assert.deepEqual(customerCandidates(order,index).map(c=>c.id),[customer.id]);
 assert.deepEqual(customerCandidates({...order,customerAccount:null},index).map(c=>c.id),[customer.id]);
 const unknown=resolveOrder({...order,customerAccount:null,customerName:'Unlisted Business'},index);
 assert.equal(unknown.order.status,'NEEDS_REVIEW');
 assert.equal(unknown.order.resolutionCode,'NEEDS_STOP');
});

test('one stop is selected automatically and contact requirement is configurable',()=>{
 const index=buildMasterIndex({customers:[customer],stops:[rawang],contacts:[]});
 const optional=resolveOrder(order,index,{contactRequired:false}).order;
 assert.equal(optional.status,'READY');
 assert.equal(optional.savedStopId,rawang.id);
 assert.equal(optional.deliveryAddress,rawang.address);
 assert.equal(optional.contactId,null);
 const required=resolveOrder(order,index,{contactRequired:true}).order;
 assert.equal(required.status,'NEEDS_REVIEW');
 assert.equal(required.resolutionCode,'NEEDS_CONTACT');
});

test('multiple stops require a per-order selection unless a site code identifies one',()=>{
 const index=buildMasterIndex({customers:[customer],stops:[rawang,kl],contacts:[]});
 const unresolved=resolveOrder(order,index).order;
 assert.equal(unresolved.savedStopId,null);
 assert.equal(unresolved.resolutionCode,'SELECT_STOP');
 const withCode=resolveOrder({...order,shipToCode:'SH002'},index).order;
 assert.equal(withCode.savedStopId,kl.id);
 assert.equal(withCode.deliveryAddress,kl.address);
 const selected=resolveOrder({...order,savedStopId:rawang.id},index).order;
 assert.equal(selected.savedStopId,rawang.id);
 assert.equal(selected.status,'READY');
});

test('contacts respect selected stop and reliable imported evidence',()=>{
 const index=buildMasterIndex({customers:[customer],stops:[rawang,kl],contacts:[ahming,jason,purchasing]});
 assert.deepEqual(contactCandidates(customer.id,rawang.id,index).map(c=>c.id),[ahming.id,purchasing.id]);
 const ambiguous=resolveOrder({...order,savedStopId:rawang.id},index,{contactRequired:true}).order;
 assert.equal(ambiguous.contactId,null);
 assert.equal(ambiguous.resolutionCode,'SELECT_CONTACT');
 const matched=resolveOrder({...order,savedStopId:rawang.id,rawInput:{contactName:'Ah Ming'}},index,{contactRequired:true}).order;
 assert.equal(matched.contactId,ahming.id);
 assert.equal(matched.contactName,ahming.name);
 assert.equal(matched.contactPhone,ahming.phone);
 const otherStop=resolveOrder({...order,savedStopId:kl.id,rawInput:{contactName:'Ah Ming'}},index,{contactRequired:true}).order;
 assert.notEqual(otherStop.contactId,ahming.id);
});

test('missing customer, stop and contact show the right resolution',()=>{
 const empty=buildMasterIndex({});
 const missing=resolveOrder(order,empty,{contactRequired:true}).order;
 assert.equal(missing.resolutionCode,'NEEDS_STOP_AND_CONTACT');
 assert.equal(missing.status,'NEEDS_REVIEW');
 const noStop=resolveOrder(order,buildMasterIndex({customers:[customer]}),{contactRequired:false}).order;
 assert.equal(noStop.resolutionCode,'NEEDS_STOP');
});

test('resolved order snapshots and row assignments stay independent',()=>{
 const index=buildMasterIndex({customers:[customer],stops:[rawang,kl],contacts:[ahming,jason]});
 const first=resolveOrder({...order,savedStopId:rawang.id,contactId:ahming.id},index,{contactRequired:true}).order;
 const second=resolveOrder({...order,internalId:'ord-2',orderId:'ORD002',savedStopId:kl.id,contactId:jason.id},index,{contactRequired:true}).order;
 assert.equal(first.status,'READY');assert.equal(second.status,'READY');
 assert.equal(first.savedStopId,rawang.id);assert.equal(second.savedStopId,kl.id);
 rawang.address='Edited address';ahming.name='Edited contact';
 assert.equal(first.deliveryAddress,'12 Rawang Road');
 assert.equal(first.contactName,'Ah Ming');
});

test('legacy stop without customerId can join exactly one matching customer',()=>{
 const legacy={id:'legacy-1',name:'ABC Trading',address:'Old depot address'};
 const index=buildMasterIndex({customers:[customer],stops:[legacy],contacts:[]});
 assert.deepEqual(stopCandidates(customer.id,index).map(s=>s.id),[legacy.id]);
});
