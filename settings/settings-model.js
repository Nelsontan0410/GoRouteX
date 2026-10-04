import '../delivery-constraints.js';
const DeliveryConstraints = globalThis.GoRouteXDeliveryConstraints;
export const CAPACITY_UNITS = Object.freeze({ off: null, weight: 'kg', pallet: 'pallet', carton: 'carton' });
const isTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validInt = (value, min, max) => value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
const cleanPoint = value => {
  const address = String(value?.address || '').trim().slice(0, 240);
  return address ? { address, label: String(value?.label || address).trim().slice(0, 120), latLng: null } : null;
};
export function defaultSettings() {
  return {
    version: 1,
    drivers: { maxStops: 20, workingStart: '08:00', workingEnd: '17:00', breakMinutes: 60, overrides: {} },
    routePlanning: { serviceMinutes: 15, maxDurationMinutes: 480, numberOfRoutes: 1, planningTime: '09:00', defaultStart: null, defaultEnd: null, defaultDeliverySchedule: DeliveryConstraints.defaultSchedule() },
    capacityPlanning: { enabled: false, mode: 'off', unit: null },
    orders: { contactRequired: false },
    driverApp: { liveTracking: true, pod: { recipientRequired: false, photoRequired: false, signatureRequired: false } }
  };
}
export function normalizeSettings(raw = {}, contactRequired = false) {
  const base = defaultSettings();
  const d = raw.drivers || {}, r = raw.routePlanning || {}, c = raw.capacityPlanning || {}, a = raw.driverApp || {};
  const mode = Object.hasOwn(CAPACITY_UNITS, c.mode) ? c.mode : 'off';
  const overrides = {};
  for (const [uid, item] of Object.entries(d.overrides || {})) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !item || typeof item !== 'object') continue;
    overrides[uid] = {
      maxStops: validInt(item.maxStops, 1, 200) ? Number(item.maxStops) : null,
      workingStart: isTime(item.workingStart) ? item.workingStart : null,
      workingEnd: isTime(item.workingEnd) ? item.workingEnd : null,
      breakMinutes: validInt(item.breakMinutes, 0, 240) ? Number(item.breakMinutes) : null
    };
  }
  return {
    version: 1,
    drivers: {
      maxStops: validInt(d.maxStops, 1, 200) ? Number(d.maxStops) : base.drivers.maxStops,
      workingStart: isTime(d.workingStart) ? d.workingStart : base.drivers.workingStart,
      workingEnd: isTime(d.workingEnd) ? d.workingEnd : base.drivers.workingEnd,
      breakMinutes: validInt(d.breakMinutes, 0, 240) ? Number(d.breakMinutes) : base.drivers.breakMinutes,
      overrides
    },
    routePlanning: {
      serviceMinutes: validInt(r.serviceMinutes, 1, 240) ? Number(r.serviceMinutes) : base.routePlanning.serviceMinutes,
      maxDurationMinutes: validInt(r.maxDurationMinutes, 30, 1440) ? Number(r.maxDurationMinutes) : base.routePlanning.maxDurationMinutes,
      numberOfRoutes: validInt(r.numberOfRoutes, 1, 50) ? Number(r.numberOfRoutes) : base.routePlanning.numberOfRoutes,
      planningTime: isTime(r.planningTime) ? r.planningTime : base.routePlanning.planningTime,
      defaultStart: cleanPoint(r.defaultStart),
      defaultEnd: cleanPoint(r.defaultEnd),
      // Customer Delivery Schedule default: customers in default mode resolve this at planning time.
      defaultDeliverySchedule: r.defaultDeliverySchedule && DeliveryConstraints.validateSchedule(r.defaultDeliverySchedule).valid
        ? DeliveryConstraints.cloneSchedule(r.defaultDeliverySchedule)
        : DeliveryConstraints.defaultSchedule()
    },
    capacityPlanning: { enabled: mode !== 'off', mode, unit: CAPACITY_UNITS[mode] },
    orders: { contactRequired: contactRequired === true },
    driverApp: {
      liveTracking: a.liveTracking !== false,
      pod: {
        recipientRequired: a.pod?.recipientRequired === true,
        photoRequired: a.pod?.photoRequired === true,
        signatureRequired: a.pod?.signatureRequired === true
      }
    }
  };
}
export function validateSettings(value) {
  const errors = {};
  const d = value?.drivers || {}, r = value?.routePlanning || {}, c = value?.capacityPlanning || {};
  if (!validInt(d.maxStops, 1, 200)) errors.maxStops = 'Enter a whole number from 1 to 200.';
  if (!isTime(d.workingStart) || !isTime(d.workingEnd) || d.workingStart >= d.workingEnd) errors.workingHours = 'Choose valid times with the end later than the start.';
  if (!validInt(d.breakMinutes, 0, 240)) errors.breakMinutes = 'Enter a whole number from 0 to 240.';
  if (!validInt(r.serviceMinutes, 1, 240)) errors.serviceMinutes = 'Enter a whole number from 1 to 240.';
  if (!validInt(r.maxDurationMinutes, 30, 1440)) errors.maxDurationMinutes = 'Enter a whole number from 30 to 1440.';
  if (!validInt(r.numberOfRoutes, 1, 50)) errors.numberOfRoutes = 'Enter a whole number from 1 to 50.';
  if (!isTime(r.planningTime)) errors.planningTime = 'Choose a valid planning time.';
  const schedule = DeliveryConstraints.validateSchedule(r.defaultDeliverySchedule);
  if (!schedule.valid) errors.deliverySchedule = schedule.errors[0].message;
  if (!Object.hasOwn(CAPACITY_UNITS, c.mode)) errors.capacityMode = 'Choose a capacity mode.';
  else if (c.enabled !== (c.mode !== 'off') || c.unit !== CAPACITY_UNITS[c.mode]) errors.capacityMode = 'Capacity mode and unit do not match.';
  for (const [uid, override] of Object.entries(d.overrides || {})) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) errors.overrides = 'A driver ID is invalid.';
    if (override.maxStops != null && !validInt(override.maxStops, 1, 200)) errors.overrides = 'A driver maximum stops value is invalid.';
    if (override.breakMinutes != null && !validInt(override.breakMinutes, 0, 240)) errors.overrides = 'A driver break value is invalid.';
    const start = override.workingStart || d.workingStart, end = override.workingEnd || d.workingEnd;
    if ((override.workingStart && !isTime(override.workingStart)) || (override.workingEnd && !isTime(override.workingEnd)) || start >= end) errors.overrides = 'A driver working-hours override is invalid.';
  }
  return errors;
}
export function resolveDriverRules(settings, driverUid, sessionOverride = {}) {
  const d = normalizeSettings(settings, settings?.orders?.contactRequired).drivers;
  const individual = d.overrides[String(driverUid)] || {};
  const resolved = {};
  for (const field of ['maxStops', 'workingStart', 'workingEnd', 'breakMinutes']) resolved[field] = sessionOverride[field] ?? individual[field] ?? d[field];
  return resolved;
}
export function getCapacityMode(settings) { return normalizeSettings(settings).capacityPlanning; }
