import { getFirebaseAdmin, jsonResponse, readJson, verifyFirebaseUser } from './_shared/firebase-admin.js';
import { consumeRoutePlan } from './_shared/route-plan-usage.js';

const ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  const user = await verifyFirebaseUser(req);
  if (!user?.uid) return jsonResponse({ success: false, error: 'Login required' }, 401);
  if (user.role === 'driver' || user.uid.startsWith('drv_')) return jsonResponse({ success: false, error: 'Drivers cannot plan routes.' }, 403);
  try {
    const body = await readJson(req);
    const routeId = String(body.routeId || '');
    if (!ROUTE_ID_PATTERN.test(routeId)) return jsonResponse({ success: false, error: 'Invalid route ID.' }, 400);
    const db = getFirebaseAdmin().firestore();
    const profile = (await db.collection('users').doc(user.uid).get()).data() || {};
    const result = await consumeRoutePlan(db, user.uid, profile, routeId);
    if (!result.allowed) return jsonResponse({ success: false, limitReached: true, used: result.used, limit: result.limit }, 429);
    return jsonResponse({ success: true, used: result.used, limit: result.limit });
  } catch (error) {
    console.error('Route plan usage failed:', error.code || error.message);
    return jsonResponse({ success: false, error: 'Route plan usage is unavailable right now.' }, 503);
  }
};
