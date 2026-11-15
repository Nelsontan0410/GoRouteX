// Phone tracking from a background location app (Traccar Client, OsmAnd protocol).
// The app sends a device identifier with every position; GoRouteX issues that identifier as a secret token
// per driver and stores only its SHA-256 hash in trackingDevices/{hash}.
import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_PATTERN = /^grx_[A-Za-z0-9]{32}$/;
export const MAX_POINT_AGE_MS = 2 * 60 * 1000;   // older points are buffered backlog: acknowledged, not shown
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;  // a phone clock ahead of the server by more than this is not trusted
export const MIN_WRITE_INTERVAL_MS = 8000;        // per device; extra points are acknowledged and dropped
export const APPROXIMATE_ACCURACY_M = 100;
const KNOTS_TO_MPS = 0.514444;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function newTrackingToken(random = randomBytes) {
  // 248 is the largest multiple of 62 below 256: rejecting bytes above it keeps every character equally likely.
  let out = '';
  while (out.length < 32) for (const byte of random(48)) { if (byte < 248 && out.length < 32) out += BASE62[byte % 62]; }
  return `grx_${out}`;
}
export const isTrackingToken = value => TOKEN_PATTERN.test(String(value || ''));
export const hashTrackingToken = token => createHash('sha256').update(String(token)).digest('hex');
export const tokenHint = token => String(token || '').slice(-4);

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Accepts epoch seconds, epoch milliseconds, ISO 8601 or "yyyy-MM-dd HH:mm:ss" (taken as UTC). Returns a Date or null.
export function parseFixTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const asNumber = num(value);
  if (asNumber !== null) {
    const ms = asNumber < 1e11 ? asNumber * 1000 : asNumber;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  const plain = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  const date = new Date(plain ? `${plain[1]}T${plain[2]}Z` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validCoordinates(lat, lng) {
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

// One position from any of the request shapes the app may use:
//  - OsmAnd query string or form body: id|deviceid, lat, lon | location=lat,lon, timestamp, speed (knots), bearing|heading, accuracy, batt
//  - JSON: { device_id, location: { timestamp, coords: { latitude, longitude, accuracy, speed (m/s), heading }, battery: { level } } }
// `params` is a URLSearchParams-like object (query + form merged); `json` is the parsed JSON body or null.
// Returns { ok: true, point } or { ok: false, reason, fields } where fields lists the received keys (never values).
export function parsePosition(params, json = null) {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const location = Array.isArray(json.location) ? json.location[json.location.length - 1] : json.location;
    const coords = location?.coords || {};
    const token = String(json.device_id ?? json.deviceId ?? json.id ?? '').trim();
    const lat = num(coords.latitude ?? coords.lat), lng = num(coords.longitude ?? coords.lon ?? coords.lng);
    if (token || location) {
      if (!validCoordinates(lat, lng)) return { ok: false, reason: 'coordinates', token, fields: Object.keys(json) };
      const level = num(location?.battery?.level);
      return { ok: true, point: {
        token, lat, lng,
        accuracy: num(coords.accuracy),
        speedMps: num(coords.speed) !== null && num(coords.speed) >= 0 ? num(coords.speed) : null,
        heading: num(coords.heading) !== null && num(coords.heading) >= 0 ? num(coords.heading) : null,
        fixTime: parseFixTime(location?.timestamp),
        battery: level === null ? null : level <= 1 ? Math.round(level * 100) : Math.round(level)
      } };
    }
  }
  const get = name => (params && typeof params.get === 'function' ? params.get(name) : null);
  const token = String(get('id') ?? get('deviceid') ?? '').trim();
  let lat = num(get('lat')), lng = num(get('lon') ?? get('lng'));
  const combined = get('location');
  if ((lat === null || lng === null) && combined) {
    const [a, b] = String(combined).split(',');
    lat = num(a); lng = num(b);
  }
  if (!token && lat === null && lng === null) {
    const fields = [...new Set([...(params && typeof params.keys === 'function' ? params.keys() : []), ...(json && typeof json === 'object' ? Object.keys(json) : [])])];
    return { ok: false, reason: 'format', token: '', fields };
  }
  if (!validCoordinates(lat, lng)) return { ok: false, reason: 'coordinates', token, fields: [] };
  const knots = num(get('speed'));
  const heading = num(get('bearing') ?? get('heading'));
  const battery = num(get('batt'));
  return { ok: true, point: {
    token, lat, lng,
    accuracy: num(get('accuracy')),
    speedMps: knots !== null && knots >= 0 ? Math.round(knots * KNOTS_TO_MPS * 100) / 100 : null,
    heading: heading !== null && heading >= 0 ? heading : null,
    fixTime: parseFixTime(get('timestamp')),
    battery: battery === null ? null : Math.round(battery)
  } };
}

// Whether a point is current enough to show live. A missing fix time is taken as "now".
export function pointAge(point, now = Date.now()) {
  const fix = point.fixTime instanceof Date ? point.fixTime.getTime() : now;
  return now - fix;
}
export function isStalePoint(point, now = Date.now()) {
  return pointAge(point, now) > MAX_POINT_AGE_MS;
}

// The drivers_live document the Live Route View reads (see driver/live-view-model.js gpsState).
export function livePayload(point, device, { now = new Date(), serverTimestamp } = {}) {
  const fix = point.fixTime instanceof Date && point.fixTime.getTime() <= now.getTime() + MAX_FUTURE_SKEW_MS ? point.fixTime : now;
  const accuracy = point.accuracy !== null && point.accuracy >= 0 ? Math.round(point.accuracy * 10) / 10 : null;
  return {
    driverId: device.driverUid,
    ownerUid: device.ownerUid,
    source: 'device-app',
    status: 'active',
    lat: point.lat,
    lng: point.lng,
    accuracy,
    speed: point.speedMps,
    heading: point.heading,
    battery: point.battery,
    networkStatus: 'online',
    positionAt: fix,
    lastUpdatedAt: serverTimestamp ?? now,
    lastUploadedClientAt: fix.toISOString(),
    approximate: accuracy !== null && accuracy > APPROXIMATE_ACCURACY_M,
    gpsHint: 'OK',
    gpsHintAt: now,
    lastErrorCode: null,
    lastErrorMessage: null
  };
}

// Small TTL cache used by the function between invocations of the same instance.
export class TtlCache {
  constructor(ttlMs, maxEntries = 500) { this.ttlMs = ttlMs; this.maxEntries = maxEntries; this.map = new Map(); }
  get(key, now = Date.now()) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now) { this.map.delete(key); return undefined; }
    return entry.value;
  }
  set(key, value, now = Date.now()) {
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: now + this.ttlMs });
  }
  delete(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}
