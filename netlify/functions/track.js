// Receives positions from the background location app on a driver's phone (Traccar Client, OsmAnd protocol)
// and writes the driver's latest position to users/{driverUid}/drivers_live/{driverUid}, which Dispatch's
// Live Route View already reads through dispatch.js action=monitor. The phone never writes Firestore itself.
import { getFirebaseAdmin } from './_shared/firebase-admin.js';
import { parsePosition, isTrackingToken, hashTrackingToken, isStalePoint, livePayload, TtlCache, MIN_WRITE_INTERVAL_MS } from './_shared/tracking-domain.js';

const CACHE_MS = 5 * 60 * 1000;
const deviceCache = new TtlCache(CACHE_MS);
const driverCache = new TtlCache(CACHE_MS);
const lastWrite = new TtlCache(60 * 1000, 2000);

const reply = (status, text = '') => new Response(text, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

async function readRequest(req) {
  const url = new URL(req.url);
  const params = new URLSearchParams(url.searchParams);
  let json = null;
  if (req.method === 'POST') {
    const type = String(req.headers.get('content-type') || '').toLowerCase();
    const body = await req.text().catch(() => '');
    if (body) {
      if (type.includes('json') || /^\s*[{[]/.test(body)) {
        try { json = JSON.parse(body); } catch { json = null; }
      } else {
        for (const [key, value] of new URLSearchParams(body)) if (!params.has(key)) params.set(key, value);
      }
    }
  }
  return { params, json };
}

async function lookupDevice(db, hash, now) {
  const cached = deviceCache.get(hash, now);
  if (cached !== undefined) return cached;
  const doc = await db.collection('trackingDevices').doc(hash).get();
  const data = doc.exists ? doc.data() : null;
  const device = data && data.active !== false && data.driverUid && data.ownerUid ? { driverUid: data.driverUid, ownerUid: data.ownerUid } : null;
  deviceCache.set(hash, device, now);
  return device;
}

async function driverActive(db, device, now) {
  const cached = driverCache.get(device.driverUid, now);
  if (cached !== undefined) return cached;
  const doc = await db.collection('users').doc(device.driverUid).get();
  const data = doc.exists ? doc.data() : null;
  const active = !!data && data.role === 'driver' && data.active !== false && data.tenantId === device.ownerUid;
  driverCache.set(device.driverUid, active, now);
  return active;
}

// The handler with its dependencies injectable for tests.
export async function handleTrack(req, { db, now = Date.now(), serverTimestamp } = {}) {
  if (req.method !== 'POST' && req.method !== 'GET') return reply(405);
  const { params, json } = await readRequest(req);
  const parsed = parsePosition(params, json);
  if (!parsed.ok && parsed.reason === 'format') {
    console.warn('TRACK_UNRECOGNIZED_REQUEST fields=', (parsed.fields || []).slice(0, 30).join(','));
    return reply(400, 'Unrecognized request');
  }
  const token = (parsed.ok ? parsed.point.token : parsed.token) || '';
  if (!isTrackingToken(token)) return reply(400, 'Invalid device identifier');
  const hash = hashTrackingToken(token);
  const device = await lookupDevice(db, hash, now);
  if (!device) return reply(403, 'Unknown device');
  if (!(await driverActive(db, device, now))) return reply(403, 'Driver inactive');
  // A position the app cannot use would be resent forever if rejected; acknowledge and drop it.
  if (!parsed.ok) return reply(200);
  const point = parsed.point;
  if (isStalePoint(point, now)) return reply(200);
  const previous = lastWrite.get(hash, now);
  if (previous !== undefined && now - previous < MIN_WRITE_INTERVAL_MS) return reply(200);
  lastWrite.set(hash, now, now);
  const ref = db.collection('users').doc(device.driverUid).collection('drivers_live').doc(device.driverUid);
  await ref.set(livePayload(point, device, { now: new Date(now), serverTimestamp }), { merge: true });
  return reply(200);
}

export function resetTrackCaches() { deviceCache.clear(); driverCache.clear(); lastWrite.clear(); }

export default async req => {
  try {
    const admin = getFirebaseAdmin();
    return await handleTrack(req, { db: admin.firestore(), serverTimestamp: admin.firestore.FieldValue.serverTimestamp() });
  } catch (error) {
    console.error('TRACK_FAILED', error?.code || '', error?.message || error);
    return reply(500);
  }
};
