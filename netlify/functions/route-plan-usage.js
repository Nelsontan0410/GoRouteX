import { getFirebaseAdmin, jsonResponse, readJson, verifyFirebaseUser } from './_shared/firebase-admin.js';
import { consumeRoutePlan, getRoutePlanStatus, isValidSessionId, refundRoutePlan } from './_shared/route-plan-usage.js';

// Automatic-planning allowance. Actions: status (no session), start and refund (with a session ID).
export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  const user = await verifyFirebaseUser(req);
  if (!user?.uid) return jsonResponse({ success: false, error: 'Login required' }, 401);
  if (user.role === 'driver' || user.uid.startsWith('drv_')) return jsonResponse({ success: false, error: 'Drivers cannot plan routes.' }, 403);
  try {
    const body = await readJson(req);
    const action = String(body.action || 'status');
    const db = getFirebaseAdmin().firestore();
    const profile = (await db.collection('users').doc(user.uid).get()).data() || {};
    if (action === 'status') return jsonResponse({ success: true, ...(await getRoutePlanStatus(db, user.uid, profile)) });
    const sessionId = String(body.sessionId || '');
    if (!isValidSessionId(sessionId)) return jsonResponse({ success: false, error: 'Invalid planning session.' }, 400);
    if (action === 'start') {
      const result = await consumeRoutePlan(db, user.uid, profile, sessionId);
      if (!result.allowed) return jsonResponse({ success: false, limitReached: true, used: result.used, limit: result.limit, remaining: 0 }, 429);
      return jsonResponse({ success: true, used: result.used, limit: result.limit, remaining: result.remaining });
    }
    if (action === 'refund') return jsonResponse({ success: true, ...(await refundRoutePlan(db, user.uid, profile, sessionId)) });
    return jsonResponse({ success: false, error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('Route plan usage failed:', error.code || error.message);
    return jsonResponse({ success: false, error: 'Route plan usage is unavailable right now.' }, 503);
  }
};
