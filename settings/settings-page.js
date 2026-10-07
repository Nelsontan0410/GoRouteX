import { CAPACITY_UNITS, normalizeSettings, validateSettings } from './settings-model.js';
import { getTenantSettings, saveTenantSettings, getCachedSettings, listVehicles, activeVehicleCount, saveVehicle, setVehicleActive, driverAccountsApi } from './settings-store.js';
const $ = id => document.getElementById(id);
const state = { user: null, settings: null, baseline: '', loaded: false, saving: false, drivers: [], driverAccounts: [], driverEntitlement: null, vehicles: [], accountGeneration: 0 };
const sections = ['company', 'drivers', 'vehicles', 'routePlanning', 'orders', 'driverApp'];
function notice(message, error = false) { const el = $('settingsNotice'); el.textContent = message; el.classList.toggle('is-error', error); }
function status(message, kind = '') { const el = $('saveStatus'); el.textContent = message; el.className = kind; }
// Planned vs actual (netlify/functions/plan-insights.js); loaded once per visit to the section.
let planInsightsLoaded = false;
async function loadPlanInsights() {
  const box = $('planInsights');
  if (!box || planInsightsLoaded || !state.user) return;
  planInsightsLoaded = true;
  box.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Loading planned vs actual…' }));
  try {
    const token = await state.user.getIdToken();
    const response = await fetch('/.netlify/functions/plan-insights', { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) throw new Error(payload.error || 'unavailable');
    renderPlanInsights(box, payload.insights);
  } catch (error) {
    planInsightsLoaded = false;
    box.replaceChildren(Object.assign(document.createElement('p'), { textContent: `Planned vs actual is unavailable: ${error.message}` }));
  }
}
function renderPlanInsights(box, r) {
  const line = (text) => Object.assign(document.createElement('p'), { textContent: text });
  const parts = [];
  if (!r.completedStops) {
    box.replaceChildren(line('No completed deliveries yet. Figures appear after drivers complete dispatched routes.'));
    return;
  }
  parts.push(Object.assign(document.createElement('strong'), { textContent: `${r.completedStops} completed stops on ${r.routes} routes` }));
  if (r.eta.samples) parts.push(line(`Arrival vs plan: typically ${r.eta.p50AbsMinutes} min off (90% within ${r.eta.p90AbsMinutes} min); ${r.eta.within15MinutesShare}% within 15 min. Median ${r.eta.medianErrorMinutes > 0 ? 'late' : 'early'} by ${Math.abs(r.eta.medianErrorMinutes)} min.`));
  if (r.service.samples) parts.push(line(`Actual time at a customer: median ${r.service.medianMinutes} min (80% within ${r.service.p80Minutes} min). Default Service Time is ${r.service.defaultMinutes} min.`));
  if (r.service.suggestedDefaultMinutes) {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: `Use ${r.service.suggestedDefaultMinutes} min as Default Service Time` });
    button.addEventListener('click', () => { $('serviceMinutes').value = r.service.suggestedDefaultMinutes; updateSave(); $('serviceMinutes').focus(); });
    parts.push(button);
  }
  if (r.customerSuggestions.length) {
    parts.push(line(`Customers whose actual time differs from the default by 5 min or more (at least ${r.minimumVisitsForSuggestion} visits). Set a custom service time for them in Customer Workspace:`));
    const list = document.createElement('ul');
    for (const c of r.customerSuggestions) list.append(Object.assign(document.createElement('li'), { textContent: `${c.name}: about ${c.suggestedServiceMinutes} min (${c.visits} visits)` }));
    parts.push(list);
    parts.push(Object.assign(document.createElement('a'), { className: 'text-link', href: 'app.html#customer-workspace', textContent: 'Open Customer Workspace →' }));
  }
  box.replaceChildren(...parts);
}

function go(section) {
  if (section === 'planning' || section === 'route-planning') section = 'routePlanning';
  if (section === 'capacity') section = 'vehicles';
  if (!sections.includes(section)) section = 'company';
  for (const name of sections) $('section-' + name).hidden = name !== section;
  for (const button of $('settingsNav').querySelectorAll('button')) button.setAttribute('aria-current', button.dataset.section === section ? 'page' : 'false');
  history.replaceState(null, '', '#' + section);
  if (section === 'routePlanning') loadPlanInsights();
}
function setValue(id, value) { $(id).value = value ?? ''; }
function setChecked(id, value) { $(id).checked = value === true; }
function populate(settings) {
  const d = settings.drivers, r = settings.routePlanning, a = settings.driverApp;
  setValue('maxStops', d.maxStops); setValue('workingStart', d.workingStart); setValue('workingEnd', d.workingEnd); setValue('breakMinutes', d.breakMinutes);
  setValue('serviceMinutes', r.serviceMinutes); setValue('maxDurationMinutes', r.maxDurationMinutes); setValue('numberOfRoutes', r.numberOfRoutes); setValue('planningTime', r.planningTime);
  setValue('defaultStart', r.defaultStart?.address); setValue('defaultEnd', r.defaultEnd?.address);
  window.GoRouteXScheduleEditor?.render($('defaultDeliverySchedule'), r.defaultDeliverySchedule, { idPrefix: 'defaultSchedule' });
  setValue('capacityMode', settings.capacityPlanning.mode); setChecked('contactRequired', settings.orders.contactRequired);
  setChecked('liveTracking', a.liveTracking); setChecked('recipientRequired', a.pod.recipientRequired); setChecked('photoRequired', a.pod.photoRequired); setChecked('signatureRequired', a.pod.signatureRequired);
  updateCapacity(); renderOverrides();
}
function point(id) { const address = $(id).value.trim(); return address ? { address, label: address, latLng: null } : null; }
function readForm() {
  const source = state.settings || getCachedSettings();
  const overrides = { ...source.drivers.overrides };
  for (const row of $('driverOverrides').querySelectorAll('[data-driver-uid]')) {
    const item = {};
    for (const field of ['maxStops', 'workingStart', 'workingEnd', 'breakMinutes']) {
      const input = row.querySelector(`[data-field="${field}"]`);
      item[field] = input.value.trim() === '' ? null : field.includes('working') ? input.value : Number(input.value);
    }
    overrides[row.dataset.driverUid] = item;
  }
  const mode = $('capacityMode').value;
  return {
    version: 1,
    drivers: { maxStops: Number($('maxStops').value), workingStart: $('workingStart').value, workingEnd: $('workingEnd').value, breakMinutes: $('breakMinutes').value === '' ? NaN : Number($('breakMinutes').value), overrides },
    routePlanning: { serviceMinutes: Number($('serviceMinutes').value), maxDurationMinutes: Number($('maxDurationMinutes').value), numberOfRoutes: Number($('numberOfRoutes').value), planningTime: $('planningTime').value, defaultStart: point('defaultStart'), defaultEnd: point('defaultEnd'), defaultDeliverySchedule: window.GoRouteXScheduleEditor ? window.GoRouteXScheduleEditor.read($('defaultDeliverySchedule')) : source.routePlanning.defaultDeliverySchedule },
    capacityPlanning: { enabled: mode !== 'off', mode, unit: CAPACITY_UNITS[mode] },
    orders: { contactRequired: $('contactRequired').checked },
    driverApp: { liveTracking: $('liveTracking').checked, pod: { recipientRequired: $('recipientRequired').checked, photoRequired: $('photoRequired').checked, signatureRequired: $('signatureRequired').checked } }
  };
}
function dirty() { return state.loaded && JSON.stringify(readForm()) !== state.baseline; }
function updateSave() { const changed = dirty(); $('saveSettings').disabled = !state.loaded || state.saving || !changed; if (!state.saving) status(changed ? 'Unsaved changes' : 'All changes saved', changed ? 'is-dirty' : ''); }
function updateCapacity() {
  const mode = $('capacityMode').value, unit = CAPACITY_UNITS[mode];
  $('capacitySummary').textContent = mode === 'off' ? 'Capacity checks are off' : `Capacity unit: ${unit}`;
  $('capacityDescription').textContent = mode === 'off' ? 'Routes can be planned without load data. No Order demand or Vehicle capacity is guessed.' : `Order demand and Vehicle capacity both need ${unit}. Missing demand remains unknown; Settings does not invent it.`;
  $('vehicleCapacityUnit').textContent = unit || '';
  $('vehicleCapacity').disabled = !unit;
  $('vehicleCapacityWrap').querySelector('small').textContent = unit ? `Optional; enter a positive amount in ${unit}.` : 'Choose a capacity mode below to enter a capacity.';
}
function renderOverrides() {
  const list = $('driverOverrides'); list.replaceChildren();
  if (!state.drivers.length) { const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = 'No active Drivers available. Add a Driver account above to set an individual override.'; list.append(p); return; }
  for (const driver of state.drivers) {
    const row = document.createElement('article'); row.className = 'override-item'; row.dataset.driverUid = driver.uid;
    const head = document.createElement('header'); const name = document.createElement('strong'); name.textContent = driver.name || driver.email; const email = document.createElement('span'); email.textContent = driver.email || ''; head.append(name, email); row.append(head);
    const grid = document.createElement('div'); grid.className = 'override-grid';
    const existing = state.settings?.drivers?.overrides?.[driver.uid] || {};
    for (const [field, label, type] of [['maxStops','Max Stops','number'],['workingStart','Start','time'],['workingEnd','End','time'],['breakMinutes','Break (min)','number']]) {
      const wrapper = document.createElement('label'); wrapper.textContent = label; const input = document.createElement('input'); input.type = type; input.dataset.field = field; input.value = existing[field] ?? ''; input.placeholder = 'Company default'; if (type === 'number') { input.min = field === 'breakMinutes' ? '0' : '1'; input.max = field === 'breakMinutes' ? '240' : '200'; input.step = '1'; } wrapper.append(input); grid.append(wrapper);
    }
    row.append(grid); list.append(row);
  }
}
function driverStatus(message, error = false) { const node = $('driverAccountStatus'); node.textContent = message; node.classList.toggle('is-error', error); }
function resetDriverForm() {
  for (const id of ['driverAccountId','driverAccountName','driverAccountUsername','driverAccountPin','driverAccountPinConfirm']) setValue(id, '');
  setChecked('driverAccountActive', true);
  $('driverAccountUsername').disabled = false; $('driverAccountActive').disabled = false;
  $('driverFormHeading').textContent = 'Add Driver'; $('driverAccountSave').textContent = 'Create Driver';
  $('driverAccountResetPin').hidden = true; $('driverAccountCancel').hidden = true; driverStatus('');
}
function editDriverAccount(driver) {
  setValue('driverAccountId', driver.uid); setValue('driverAccountName', driver.name); setValue('driverAccountUsername', driver.username);
  setValue('driverAccountPin', ''); setValue('driverAccountPinConfirm', ''); setChecked('driverAccountActive', driver.active);
  $('driverAccountUsername').disabled = true; $('driverAccountActive').disabled = true;
  $('driverFormHeading').textContent = `Edit ${driver.name}`; $('driverAccountSave').textContent = 'Save Driver';
  $('driverAccountResetPin').hidden = false; $('driverAccountCancel').hidden = false;
  driverStatus('Username stays the same. Enter a new PIN and choose Reset PIN only when needed.');
  go('drivers'); $('driverAccountName').focus();
}
function renderDriverAccounts() {
  const list = $('driverAccountList'); list.replaceChildren();
  const entitlement = state.driverEntitlement;
  if (entitlement) { $('driverEntitlement').textContent = `${entitlement.activeCount} / ${entitlement.maxActiveDrivers} active drivers · ${entitlement.plan === 'basic' ? 'Free' : entitlement.plan === 'goplan' ? 'Go' : 'Pro'} plan`; $('driverUpgradeLink').hidden = entitlement.activeCount < entitlement.maxActiveDrivers; }
  if (!state.driverAccounts.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No Driver accounts yet. Add your first Driver below.'; list.append(empty); return; }
  for (const driver of state.driverAccounts) {
    const item = document.createElement('article'); item.className = 'vehicle-item';
    const details = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small');
    title.textContent = driver.name; meta.textContent = `@${driver.username} · ${driver.active ? 'Active' : 'Inactive'}`; details.append(title, meta);
    const actions = document.createElement('div');
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'View / Edit'; edit.onclick = () => editDriverAccount(driver);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = driver.active ? 'Deactivate' : 'Reactivate';
    toggle.onclick = async () => { toggle.disabled = true; driverStatus('Saving Driver status…'); try { await driverAccountsApi('status', { driverUid: driver.uid, active: !driver.active }); await refreshResources(); driverStatus(`Driver ${driver.active ? 'deactivated' : 'reactivated'}.`); } catch (error) { driverStatus(error.message, true); toggle.disabled = false; } };
    actions.append(edit, toggle); item.append(details, actions); list.append(item);
  }
}
async function saveDriverAccount() {
  const button = $('driverAccountSave'), driverUid = $('driverAccountId').value;
  button.disabled = true; driverStatus('Saving Driver…');
  try {
    if (driverUid) await driverAccountsApi('edit', { driverUid, name: $('driverAccountName').value });
    else await driverAccountsApi('create', { name: $('driverAccountName').value, username: $('driverAccountUsername').value, pin: $('driverAccountPin').value, confirmPin: $('driverAccountPinConfirm').value, active: $('driverAccountActive').checked });
    resetDriverForm(); await refreshResources(); driverStatus(driverUid ? 'Driver updated.' : 'Driver created. Share the username and PIN privately.');
  } catch (error) { driverStatus(error.message, true); }
  finally { button.disabled = false; }
}
async function resetDriverPin() {
  const button = $('driverAccountResetPin'), driverUid = $('driverAccountId').value;
  if (!driverUid) return;
  button.disabled = true; driverStatus('Resetting Driver PIN…');
  try { await driverAccountsApi('reset-pin', { driverUid, pin: $('driverAccountPin').value, confirmPin: $('driverAccountPinConfirm').value }); setValue('driverAccountPin', ''); setValue('driverAccountPinConfirm', ''); driverStatus('Driver PIN reset. Share the new PIN privately.'); }
  catch (error) { driverStatus(error.message, true); }
  finally { button.disabled = false; }
}
function renderVehicles() {
  const list = $('vehicleList'); list.replaceChildren();
  $('activeVehicleCount').textContent = String(activeVehicleCount(state.vehicles));
  $('vehicleCountNote').textContent = `${state.vehicles.length} Vehicle record${state.vehicles.length === 1 ? '' : 's'} total`;
  if (!state.vehicles.length) { const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = 'No Vehicle records yet. Add one below; old Vehicle / Driver labels are not counted as Vehicles.'; list.append(p); return; }
  for (const vehicle of state.vehicles) {
    const item = document.createElement('article'); item.className = 'vehicle-item';
    const details = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small');
    title.textContent = vehicle.name || 'Vehicle';
    const capacity = vehicle.capacity?.value > 0 ? `${vehicle.capacity.value} ${vehicle.capacity.unit || ''}` : 'Capacity unknown';
    meta.textContent = [vehicle.registration, vehicle.type, vehicle.active === false ? 'Inactive' : 'Active', capacity].filter(Boolean).join(' · ');
    details.append(title, meta);
    const actions = document.createElement('div'); const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit'; edit.onclick = () => editVehicle(vehicle);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = vehicle.active === false ? 'Activate' : 'Deactivate'; toggle.onclick = async () => {
      toggle.disabled = true; try { await setVehicleActive(vehicle.id, vehicle.active === false); state.vehicles = await listVehicles(); renderVehicles(); vehicleStatus('Vehicle status saved.'); } catch (error) { vehicleStatus(error.message, true); toggle.disabled = false; }
    }; actions.append(edit, toggle); item.append(details, actions); list.append(item);
  }
}
function vehicleStatus(message, error = false) { const node = $('vehicleStatus'); node.textContent = message; node.classList.toggle('is-error', error); }
function editVehicle(vehicle) {
  setValue('vehicleId', vehicle.id); setValue('vehicleName', vehicle.name); setValue('vehicleRegistration', vehicle.registration); setValue('vehicleType', vehicle.type);
  const mode = $('capacityMode').value;
  setValue('vehicleCapacity', vehicle.capacity?.unit === CAPACITY_UNITS[mode] ? vehicle.capacity.value : ''); setChecked('vehicleActive', vehicle.active !== false);
  $('vehicleFormHeading').textContent = 'Edit Vehicle'; $('vehicleCancel').hidden = false; go('vehicles'); $('vehicleName').focus();
}
function resetVehicleForm() { for (const id of ['vehicleId','vehicleName','vehicleRegistration','vehicleType','vehicleCapacity']) setValue(id,''); setChecked('vehicleActive',true); $('vehicleFormHeading').textContent = 'Add Vehicle'; $('vehicleCancel').hidden = true; vehicleStatus(''); }
async function refreshResources() {
  const generation = state.accountGeneration;
  const [vehicles, accounts] = await Promise.allSettled([listVehicles(), driverAccountsApi()]);
  if (generation !== state.accountGeneration) return;
  if (vehicles.status === 'fulfilled') {
    state.vehicles = vehicles.value;
    renderVehicles();
  } else {
    $('activeVehicleCount').textContent = '—';
    $('vehicleCountNote').textContent = 'Could not load Vehicle records.';
    $('vehicleList').textContent = vehicles.reason.message;
  }
  if (accounts.status === 'fulfilled') {
    state.driverAccounts = accounts.value.drivers || [];
    state.driverEntitlement = accounts.value.entitlement || null;
    state.drivers = state.driverAccounts.filter(driver => driver.active === true || driver.status === 'ACTIVE');
    renderOverrides();
    renderDriverAccounts();
    const activeCount = state.driverEntitlement?.activeCount ?? state.drivers.length;
    $('activeDriverCount').textContent = String(activeCount);
    $('driverCountNote').textContent = String(activeCount) + ' active Driver account' + (activeCount === 1 ? '' : 's');
  } else {
    state.drivers = [];
    state.driverAccounts = [];
    state.driverEntitlement = null;
    $('activeDriverCount').textContent = '—';
    $('driverCountNote').textContent = 'Driver records unavailable while Dispatch access is blocked.';
    $('driverOverrides').textContent = accounts.reason.message;
    $('driverAccountList').textContent = accounts.reason.message;
    $('driverEntitlement').textContent = 'Driver accounts unavailable';
  }
}
async function load() {
  if (!state.user) return;
  const generation = state.accountGeneration;
  notice('Loading company settings…'); $('retryLoad').hidden = true; $('saveSettings').disabled = true;
  try { const settings = await getTenantSettings(); if (generation !== state.accountGeneration) return; state.settings = settings; populate(state.settings); state.baseline = JSON.stringify(readForm()); state.loaded = true; $('settingsForm').hidden = false; notice(''); updateSave(); await refreshResources(); }
  catch (error) { if (generation !== state.accountGeneration) return; state.loaded = false; $('settingsForm').hidden = false; state.settings = getCachedSettings(); populate(state.settings); $('retryLoad').hidden = false; notice(`Could not load company settings from the cloud: ${error.message}. Retry before saving.`, true); status('Cloud settings unavailable', 'is-error'); }
}
async function save(event) {
  event.preventDefault(); if (!state.loaded || state.saving) return;
  const input = readForm(), errors = validateSettings(input);
  if (Object.keys(errors).length) { const [field, message] = Object.entries(errors)[0]; status(message, 'is-error'); $(({maxStops:'maxStops',workingHours:'workingStart',breakMinutes:'breakMinutes',serviceMinutes:'serviceMinutes',maxDurationMinutes:'maxDurationMinutes',numberOfRoutes:'numberOfRoutes',planningTime:'planningTime',capacityMode:'capacityMode',overrides:'driverOverrides',deliverySchedule:'defaultDeliverySchedule'})[field])?.focus?.(); if (field === 'deliverySchedule') go('routePlanning'); return; }
  state.saving = true; $('saveSettings').disabled = true; status('Saving…');
  try { state.settings = await saveTenantSettings(input); state.baseline = JSON.stringify(readForm()); status('Saved'); notice('Company settings saved.'); }
  catch (error) { status(`Failed to save: ${error.message}. Retry Save Changes.`, 'is-error'); notice('Changes were not confirmed in the cloud.', true); }
  finally { state.saving = false; $('saveSettings').disabled = !dirty(); }
}
function bind() {
  $('settingsNav').addEventListener('click', event => { const button = event.target.closest('[data-section]'); if (button) go(button.dataset.section); });
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
  $('settingsForm').addEventListener('input', updateSave); $('settingsForm').addEventListener('change', event => { if (event.target.id === 'capacityMode') updateCapacity(); updateSave(); });
  $('settingsForm').addEventListener('submit', save); $('retryLoad').addEventListener('click', load);
  $('vehicleSave').addEventListener('click', async () => {
    const button = $('vehicleSave');
    const vehicle = { id: $('vehicleId').value, name: $('vehicleName').value, registration: $('vehicleRegistration').value, type: $('vehicleType').value, capacityValue: $('vehicleCapacity').disabled ? null : $('vehicleCapacity').value, active: $('vehicleActive').checked };
    if (!vehicle.name.trim() || !vehicle.registration.trim()) { vehicleStatus('Enter a Vehicle name and registration / ID.', true); return; }
    button.disabled = true; vehicleStatus('Saving Vehicle…');
    try {
      // A Vehicle write must not depend on unrelated unsaved Driver or delivery defaults.
      const selectedMode = $('capacityMode').value;
      if (selectedMode !== state.settings.capacityPlanning.mode) {
        const capacityPlanning = { enabled: selectedMode !== 'off', mode: selectedMode, unit: CAPACITY_UNITS[selectedMode] };
        state.settings = await saveTenantSettings({ ...state.settings, capacityPlanning });
        const previousBaseline = JSON.parse(state.baseline || '{}');
        state.baseline = JSON.stringify({ ...previousBaseline, capacityPlanning });
        updateSave();
      }
      await saveVehicle(vehicle, state.settings);
      state.vehicles = await listVehicles(); renderVehicles(); resetVehicleForm(); vehicleStatus('Vehicle saved.');
    } catch (error) { vehicleStatus(`Could not save Vehicle: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
  $('vehicleCancel').addEventListener('click', resetVehicleForm);
  $('driverAccountSave').addEventListener('click', saveDriverAccount);
  $('driverAccountResetPin').addEventListener('click', resetDriverPin);
  $('driverAccountCancel').addEventListener('click', resetDriverForm);
  $('driverAccountForm').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault(); });
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  go(location.hash.slice(1) || 'company');
}
bind();
if (!window.FirebaseApp?.init?.()) notice('Sign-in service is unavailable. Reload this page.', true);
else window.FirebaseApp.auth.onAuthStateChange(async user => {
  const generation = ++state.accountGeneration;
  window.GoRouteXAccountContext?.clear();
  state.user = null;
  state.loaded = false;
  $('settingsForm').hidden = true;
  if (!user) { location.href = `login.html?next=${encodeURIComponent('settings.html')}`; return; }
  if (window.FirebaseApp.auth.isDriverAccount?.(user)) { location.replace('driver.html'); return; }
  $('settingsAccount').textContent = 'Loading account…';
  try {
    const identity = await window.GoRouteXAccountContext.loadIdentity(user);
    if (generation !== state.accountGeneration || window.FirebaseApp.auth.getCurrentUser()?.uid !== identity.uid) return;
    state.user = user;
    if (location.hash === '#routePlanning') loadPlanInsights();
    let planLabel = 'Plan unavailable';
    try { planLabel = window.GoRouteXAccountContext.resolvePlan(identity).planLabel; }
    catch (error) { console.warn('SETTINGS_PLAN_UNAVAILABLE', { code: String(error?.code || 'unknown').slice(0, 60) }); }
    $('settingsAccount').textContent = identity.displayName + ' · ' + planLabel;
    await load();
  } catch (error) {
    if (generation !== state.accountGeneration) return;
    state.user = null;
    $('settingsAccount').textContent = 'Account unavailable';
    notice(`Unable to load your account: ${error.message}. Refresh this page to retry.`, true);
  }
});
