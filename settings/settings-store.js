import { defaultSettings, normalizeSettings, validateSettings, resolveDriverRules, getCapacityMode, CAPACITY_UNITS } from './settings-model.js';

const CACHE_PREFIX = 'goroutex.settings.v1:';
const memory = new Map();
function user() {
  const current = globalThis.firebase?.auth?.().currentUser;
  if (!current?.uid) throw Error('Sign in to manage Settings.');
  if (globalThis.FirebaseApp?.auth?.isDriverAccount?.(current)) throw Error('Company Settings require a workspace account.');
  return current;
}
function root() { return firebase.firestore().collection('users').doc(user().uid); }
function cacheKey() { return CACHE_PREFIX + user().uid; }
function remember(settings) {
  const uid = user().uid;
  memory.set(uid, settings);
  try { localStorage.setItem(cacheKey(), JSON.stringify(settings)); } catch { /* Cache is optional. */ }
  globalThis.dispatchEvent?.(new CustomEvent('goroutex:settings-ready', { detail: { uid, settings } }));
}
export function getCachedSettings() {
  let uid;
  try { uid = user().uid; } catch { return defaultSettings(); }
  if (memory.has(uid)) return memory.get(uid);
  try {
    const stored = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    if (stored) return normalizeSettings(stored, stored.orders?.contactRequired);
  } catch { /* Fall through to defaults. */ }
  return defaultSettings();
}
export async function getTenantSettings() {
  const settingsRoot = root().collection('settings');
  const [operations, orderHub] = await Promise.all([
    settingsRoot.doc('operationsV1').get({ source: 'server' }),
    settingsRoot.doc('orderHub').get({ source: 'server' })
  ]);
  const settings = normalizeSettings(operations.exists ? operations.data() : {}, orderHub.exists && orderHub.data()?.contactRequired === true);
  remember(settings);
  return settings;
}
export async function saveTenantSettings(input) {
  const errors = validateSettings(input);
  if (Object.keys(errors).length) { const error = Error(Object.values(errors)[0]); error.fields = errors; throw error; }
  const settings = normalizeSettings(input, input.orders?.contactRequired);
  const settingsRoot = root().collection('settings');
  const batch = firebase.firestore().batch();
  const { orders, ...operational } = settings;
  batch.set(settingsRoot.doc('operationsV1'), { ...operational, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  batch.set(settingsRoot.doc('orderHub'), { contactRequired: orders.contactRequired, updatedAt: new Date().toISOString() }, { merge: true });
  await batch.commit();
  const verified = await settingsRoot.doc('operationsV1').get({ source: 'server' });
  if (!verified.exists) throw Error('Settings could not be confirmed in the cloud. Retry Save Changes.');
  remember(settings);
  return settings;
}
export async function listVehicles() {
  const snapshot = await root().collection('vehicles').get({ source: 'server' });
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}
export function activeVehicleCount(vehicles) { return (vehicles || []).filter(vehicle => vehicle.active !== false).length; }
export async function saveVehicle(input, settings = getCachedSettings()) {
  const name = String(input.name || '').trim().slice(0, 80);
  const registration = String(input.registration || '').trim().slice(0, 50);
  const type = String(input.type || '').trim().slice(0, 60);
  if (!name || !registration) throw Error('Vehicle name and registration are required.');
  const mode = getCapacityMode(settings);
  const requested = input.capacityValue == null || String(input.capacityValue).trim() === '' ? null : Number(input.capacityValue);
  if (requested != null && (!Number.isFinite(requested) || requested <= 0 || requested > 1000000)) throw Error('Vehicle capacity must be greater than zero.');
  if (requested != null && !mode.enabled) throw Error('Select a Capacity mode under Vehicles before adding capacity.');
  const collection = root().collection('vehicles');
  const ref = input.id ? collection.doc(String(input.id)) : collection.doc();
  const id = ref.id;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Error('Vehicle ID is invalid.');
  const prior = input.id ? await ref.get({ source: 'server' }) : null;
  if (input.id && !prior.exists) throw Error('Vehicle no longer exists. Refresh the list.');
  const record = { id, name, registration, type, active: input.active !== false,
    capacity: requested == null ? (prior?.data()?.capacity || null) : { value: requested, unit: CAPACITY_UNITS[mode.mode] },
    updatedAt: new Date().toISOString() };
  if (!input.id) record.createdAt = record.updatedAt;
  await ref.set(record, { merge: true });
  const confirmed = await ref.get({ source: 'server' });
  if (!confirmed.exists) throw Error('Vehicle save could not be confirmed. Retry.');
  return { id, ...confirmed.data() };
}
export async function setVehicleActive(id, active) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(id))) throw Error('Vehicle ID is invalid.');
  const ref = root().collection('vehicles').doc(String(id));
  const prior = await ref.get({ source: 'server' });
  if (!prior.exists) throw Error('Vehicle no longer exists. Refresh the list.');
  await ref.set({ active: active === true, updatedAt: new Date().toISOString() }, { merge: true });
  return true;
}
export async function driverAccountsApi(action = 'list', payload = {}) {
  const token = await user().getIdToken();
  const response = await fetch('/.netlify/functions/driver-accounts', {
    method: action === 'list' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(action === 'list' ? {} : { 'Content-Type': 'application/json' }) },
    body: action === 'list' ? undefined : JSON.stringify({ action, ...payload })
  });
  let result;
  try { result = await response.json(); } catch { throw Error('Driver account server is unavailable. Please try again.'); }
  if (!response.ok || !result.success) throw Error(result.error || 'Driver account request failed.');
  if (action !== 'list') window.dispatchEvent(new Event('goroutex:drivers-updated'));
  return result;
}
export async function listLinkedDrivers() {
  const token = await user().getIdToken();
  const response = await fetch('/.netlify/functions/dispatch?action=drivers', { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json();
  if (!response.ok || !result.success) throw Error(result.error || 'Driver records are unavailable.');
  return (result.drivers || []).filter(item => item?.uid);
}
export { defaultSettings, normalizeSettings, validateSettings, resolveDriverRules, getCapacityMode };
if (typeof window !== 'undefined') window.GoRouteXSettings = { getTenantSettings, saveTenantSettings, getCachedSettings, listVehicles, activeVehicleCount, saveVehicle, setVehicleActive, listLinkedDrivers, driverAccountsApi, resolveDriverRules, getCapacityMode };
