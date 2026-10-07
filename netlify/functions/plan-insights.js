import { getFirebaseAdmin, jsonResponse, verifyFirebaseUser } from './_shared/firebase-admin.js';
import { requireOwner } from './_shared/driver-domain.js';
import { computePlanInsights } from './_shared/plan-insights.js';

// Planned vs actual for the workspace owner: ETA accuracy and actual service times from the driver
// executions of the owner's dispatched routes (most recent 100).
export default async (req) => {
  if (req.method !== 'GET') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  const user = await verifyFirebaseUser(req);
  if (!user?.uid) return jsonResponse({ success: false, error: 'Login required' }, 401);
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const profile = (await db.collection('users').doc(user.uid).get()).data() || {};
    try { requireOwner(user, profile); } catch { return jsonResponse({ success: false, error: 'Workspace owner required.' }, 403); }
    const dispatched = await db.collection('dispatchRoutes').where('dispatchOwnerUid', '==', user.uid).limit(100).get();
    const refs = dispatched.docs
      .map((doc) => ({ id: doc.id, driver: doc.data().assignedDriverUid }))
      .filter((item) => item.driver)
      .map((item) => db.collection('users').doc(item.driver).collection('driverExecutions').doc(item.id));
    const executions = refs.length ? (await db.getAll(...refs)).filter((doc) => doc.exists).map((doc) => doc.data()) : [];
    const settings = (await db.collection('users').doc(user.uid).collection('settings').doc('operationsV1').get()).data() || {};
    const defaultServiceMinutes = Number(settings.routePlanning?.serviceMinutes) || 15;
    return jsonResponse({ success: true, insights: computePlanInsights(executions, { defaultServiceMinutes }) });
  } catch (error) {
    console.error('Plan insights failed:', error.code || error.message);
    return jsonResponse({ success: false, error: 'Planned vs actual is unavailable right now.' }, 503);
  }
};
