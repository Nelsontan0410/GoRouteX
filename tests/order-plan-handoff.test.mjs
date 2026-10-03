import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { loadMasterData } from '../orders/master-data.js';
import { buildMasterIndex } from '../orders/customer-matcher.js';
import { resolveOrder } from '../orders/order-readiness.js';
import { enrichPlannedRoutes } from '../driver/route-enrichment.js';

test('selected orders group by saved stop and remain scoped to the same account', async () => {
  const values = new Map();
  const window = { sessionStorage: {
    setItem: (key, value) => values.set(key, value),
    getItem: key => values.get(key) || null,
    removeItem: key => values.delete(key)
  }};
  const source = await readFile(new URL('../orders/route-plan-selection.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { window, Date, Error, Map, Set, Number, String, JSON });
  const plan = window.GoRouteXOrderPlan;
  const stops = [{ id: 'stop-1', address: '12 Main Street' }, { id: 'stop-2', address: '25 Lake Road' }];
  const orders = [
    { internalId: 'order-1', savedStopId: 'stop-1', status: 'READY' },
    { internalId: 'order-2', savedStopId: 'stop-1', status: 'READY' },
    { internalId: 'order-3', savedStopId: 'stop-2', status: 'READY' }
  ];
  const selected = plan.prepare(orders, stops, 2);
  assert.deepEqual(Array.from(selected.stopIds), ['stop-1', 'stop-2']);
  assert.equal(selected.orderIds.length, 3);
  plan.save('owner-1', selected);
  assert.equal(plan.read('owner-2'), null);
  assert.equal(plan.read('owner-1').orderIds.length, 3);
  plan.clear('owner-1');
  assert.equal(plan.read('owner-1'), null);
  assert.throws(() => plan.prepare([...orders, { internalId: 'bad', status: 'NEEDS_REVIEW', savedStopId: 'stop-1' }], stops, 2), /need review/);
  assert.throws(() => plan.prepare(orders, stops, 1), /supports 1 selected stops/);
});

test('fresh master data includes a newly saved stop in the correct account storage', async () => {
  const priorWindow = globalThis.window;
  const priorFirebase = globalThis.firebase;
  let options;
  try {
    globalThis.window = {
      currentUserProfile: { productPlanKey: 'goplan' },
      RoutePlannerStorage: { loadStops: async value => {
        options = value;
        return { success: true, stops: [{ id: 'new-stop', customerId: 'customer-1', name: 'Acme Site', address: '12 Main Street' }] };
      }}
    };
    globalThis.firebase = { firestore: () => ({
      collection: () => ({ doc: () => ({ collection: name => ({ get: async () => ({
        docs: name === 'orderCustomers'
          ? [{ id: 'customer-1', data: () => ({ name: 'Acme' }) }]
          : []
      }) }) }) })
    }) };
    const master = await loadMasterData('owner-1', { forceReload: true });
    assert.equal(options.forceReload, true);
    assert.equal(options.profile.productPlanKey, 'goplan');
    const row = resolveOrder({
      internalId: 'order-1', orderId: 'DO-1', customerName: 'Acme',
      customerId: 'customer-1', savedStopId: 'new-stop', address: '12 Main Street',
      baseValidationIssues: []
    }, buildMasterIndex(master)).order;
    assert.equal(row.status, 'READY');
    assert.equal(row.savedStopId, 'new-stop');
  } finally {
    globalThis.window = priorWindow;
    globalThis.firebase = priorFirebase;
  }
});

test('explicitly selected orders link to the route even when import dates are blank or different', () => {
  const routes = [{ id: 'route-1', customerStops: [
    { uniqueId: 'stop-1', Name: 'Acme' },
    { uniqueId: 'stop-2', Name: 'Beta' }
  ] }];
  const orders = [
    { internalId: 'order-1', orderId: 'DO-1', savedStopId: 'stop-1', deliveryDate: null, status: 'READY' },
    { internalId: 'order-2', orderId: 'DO-2', savedStopId: 'stop-2', deliveryDate: '2026-10-01', status: 'READY' },
    { internalId: 'other', orderId: 'DO-3', savedStopId: 'stop-1', deliveryDate: '2026-09-28', status: 'READY' }
  ];
  const linked = enrichPlannedRoutes(routes, orders, '2026-09-28', { selectedOrderIds: ['order-1', 'order-2'] });
  assert.equal(linked.linkedCount, 2);
  assert.deepEqual(linked.plannedRoutes[0].customerStops[0].orderNumbers, ['DO-1']);
  assert.deepEqual(linked.plannedRoutes[0].customerStops[1].orderNumbers, ['DO-2']);
  assert.equal(enrichPlannedRoutes(routes, orders, '2026-09-28').linkedCount, 1);
});

// Run the actual planner loader and handoff functions, including their options.
test('order handoff loads and selects stops beyond the first 100 saved stops', async () => {
  const html = await readFile(new URL('../app.html', import.meta.url), 'utf8');
  const extract = (name, next) => html.slice(html.indexOf(name), html.indexOf(next, html.indexOf(name)));
  const stops = Array.from({length: 150}, (_, i) => ({id: `stop-${i}`, address: `${i} Main Street`}));
  const notice = { hidden: true, textContent: '' };
  let requestedLimit;
  const context = vm.createContext({
    window: {RoutePlannerStorage: {loadStops: () => {}}, FirebaseApp: {auth: {getCurrentUser: () => ({uid: 'owner'})}}},
    document: {getElementById: () => notice}, console: {time(){}, timeEnd(){}, error(){}},
    stopsReadyTimerActive: false, STOP_INITIAL_RENDER_LIMIT: 100, stopListVisibleLimit: 100,
    renderStopsLoading(){}, renderStopsData(){}, appLog(){}, renderStopsError(error){throw error;},
    searchCustomerInput: null, allCustomerEntries: [],
    loadStopsOnce: async options => {requestedLimit = options.limit; return {success:true, stops: options.limit ? stops.slice(0, options.limit) : stops};},
    applyStopsResult(result){context.allCustomerEntries = result.stops.map(stop => ({uniqueId:stop.id, Address:stop.address}));},
    getCurrentSelectedStopsLimit: () => 25,
    updateSelectedListOnPage1(){}, renderCustomerList(){}, updateManualAssignAccessButton(){}, syncSessionToCloud(){},
    planningDateInput: {value:''}, updatePlanningDateAccess(){},
    selectedCustomers: new Set(), selectedAddresses: new Set()
  });
  const start = html.indexOf('    async function fetchInitialCustomerData(');
  const end = html.indexOf('\n    function ', start);
  vm.runInContext(html.slice(start, end), context);
  vm.runInContext(extract('    function applyOrderPlanSelection(', '    function getSelectedStopObjects('), context);
  await context.fetchInitialCustomerData({forceReload:true, loadAll:true});
  context.applyOrderPlanSelection({stopIds:['stop-149'],orderIds:['order-1'],planningDateTime:'2026-10-02T10:30'});
  assert.equal(requestedLimit, undefined);
  assert.equal(context.selectedCustomers.has('stop-149'), true);
  assert.equal(context.planningDateInput.value,'2026-10-02T10:30');
  assert.match(notice.textContent, /1 selected orders are ready/);
});

test('Saved Stop delivery phone links to an imported order without a separate contact record', () => {
  const master = {stops:[{id:'site',name:'Acme',address:'12 Road',phone:'9123 4567'}]};
  const order = resolveOrder({customerName:'Acme',address:'12 Road',baseValidationIssues:[]}, buildMasterIndex(master), {contactRequired:true}).order;
  assert.equal(order.status,'READY');
  assert.equal(order.contactId,'saved-stop-contact:site');
  assert.equal(order.contactPhone,'9123 4567');
  const other = resolveOrder({customerName:'Beta',baseValidationIssues:[]}, buildMasterIndex(master), {contactRequired:true}).order;
  assert.equal(other.contactId,null);
});

test('explicit contact is preferred to the same phone on a saved stop', () => {
  const master = {customers:[{id:'acme',name:'Acme'}],stops:[{id:'site',customerId:'acme',address:'12 Road',phone:'91234567'}],contacts:[{id:'person',customerId:'acme',savedStopId:'site',name:'Sam',phone:'9123 4567'}]};
  const order = resolveOrder({customerName:'Acme',baseValidationIssues:[]},buildMasterIndex(master)).order;
  assert.equal(order.contactId,'person');
  assert.equal(order.contactName,'Sam');
});


test('order planning follows one delivery schedule, defaults to 09:00, and rejects mixed schedules', async () => {
  const window = {sessionStorage:{setItem(){},getItem(){return null},removeItem(){}}};
  const source=await readFile(new URL('../orders/route-plan-selection.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{window,Date,Error,Map,Set,Number,String,JSON});
  const stop=[{id:'stop-1',address:'12 Road'}];
  const order=(id,extra={})=>({internalId:id,savedStopId:'stop-1',status:'READY',...extra});
  assert.equal(window.GoRouteXOrderPlan.prepare([order('a',{deliveryDate:'2026-10-02',timeWindowStart:'10:30'})],stop,16).planningDateTime,'2026-10-02T10:30');
  const fallback=window.GoRouteXOrderPlan.prepare([order('a')],stop,16).planningDateTime;
  assert.match(fallback,/^\d{4}-\d{2}-\d{2}T09:00$/);
  assert.throws(()=>window.GoRouteXOrderPlan.prepare([order('a',{deliveryDate:'2026-10-02'}),order('b',{deliveryDate:'2026-10-03'})],stop,16),/different delivery dates/);
  assert.throws(()=>window.GoRouteXOrderPlan.prepare([order('a',{deliveryDate:'2026-10-02',timeWindowStart:'09:00'}),order('b',{deliveryDate:'2026-10-02',timeWindowStart:'10:00'})],stop,16),/different delivery dates or times/);
});

test('manually entered route locations persist per signed-in account',async()=>{
 const values=new Map(),window={localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};
 const source=await readFile(new URL('../orders/route-planning-preferences.js',import.meta.url),'utf8');
 vm.runInNewContext(source,{window,JSON,Number,String,Math});
 window.GoRouteXRouteLocations.save('owner-a','start',{address:'12 Road',latLng:{lat:1.3,lng:103.8},label:'Depot'});
 window.GoRouteXRouteLocations.save('owner-a','end',{address:'25 Road',latLng:{lat:1.4,lng:103.9}});
 assert.equal(window.GoRouteXRouteLocations.read('owner-a').start.label,'Depot');
 assert.equal(window.GoRouteXRouteLocations.read('owner-a').end.address,'25 Road');
 assert.equal(window.GoRouteXRouteLocations.read('owner-b').start,null);
});

test('unified master search finds exact-field records and keeps stop-contact relationships',async()=>{
 const window={};const source=await readFile(new URL('../orders/master-search.js',import.meta.url),'utf8');
 vm.runInNewContext(source,{window,String,Map,Array});
 const master={customers:[{id:'customer-1',name:'Acme'}],stops:[{id:'stop-1',customerId:'customer-1',name:'Warehouse',address:'12 Main Road',phone:'9123 4567'}],contacts:[{id:'contact-1',customerId:'customer-1',savedStopId:'stop-1',name:'Sam Tan',phone:'9888 1111'}]};
 const search=window.GoRouteXMasterSearch.search;
 assert.equal(search(master,'customer','Acme').length,2);
 assert.equal(search(master,'contact','Sam')[0].kind,'contact');
 assert.equal(search(master,'phone','98881111')[0].stop,'Warehouse');
 assert.equal(search(master,'address','Main Road').length,2);
 assert.equal(search(master,'phone','000000').length,0);
 assert.equal(search(master,'customer','Other').length,0);
});
