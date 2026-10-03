import { getFirebaseAdmin, jsonResponse, readJson, verifyFirebaseUser } from './_shared/firebase-admin.js';
import { requireBillingOwner } from './_shared/driver-domain.js';
import { stripeRequest } from './_shared/stripe-api.js';
import { applySubscription } from './stripe-webhook.js';

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  const user = await verifyFirebaseUser(req);
  if (!user?.uid) return jsonResponse({ success: false, error: 'Login required' }, 401);
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const profile = (await db.collection('users').doc(user.uid).get()).data() || {};
    try { requireBillingOwner(user, profile); } catch (error) { return jsonResponse({ success: false, error: 'Workspace owner or admin required.', code: error?.code || 'FORBIDDEN' }, 403); }
    if (!profile.stripeCustomerId) return jsonResponse({ success: true, status: 'not_started' });

    const body = await readJson(req);
    const pendingSessionId = String(profile.stripeCheckoutPendingSessionId || '');
    if (body.action === 'cancel_checkout' && /^cs_[A-Za-z0-9_]+$/.test(pendingSessionId)) {
      const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(pendingSessionId)}`);
      if (session.customer !== profile.stripeCustomerId) throw new Error('Checkout customer mismatch.');
      if (session.status === 'open') {
        await stripeRequest(`/checkout/sessions/${encodeURIComponent(pendingSessionId)}/expire`, { method: 'POST', idempotencyKey: `goroutex-expire-${pendingSessionId}` });
      }
      if (session.status !== 'complete') {
        const userRef = db.collection('users').doc(user.uid);
        await db.runTransaction(async (transaction) => {
          const latest = await transaction.get(userRef);
          if (latest.data()?.stripeCheckoutPendingSessionId === pendingSessionId) {
            transaction.set(userRef, {
              stripeCheckoutPendingAt: null, stripeCheckoutPendingSessionId: '',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          }
        });
        return jsonResponse({ success: true, status: 'cancelled' });
      }
    }

    let subscriptionId = String(profile.stripeSubscriptionId || '');
    if (!subscriptionId && /^cs_[A-Za-z0-9_]+$/.test(String(profile.stripeCheckoutPendingSessionId || ''))) {
      const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(profile.stripeCheckoutPendingSessionId)}`);
      if (session.customer !== profile.stripeCustomerId) throw new Error('Checkout customer mismatch.');
      if (session.status !== 'complete' || !session.subscription) return jsonResponse({ success: true, status: 'processing' });
      subscriptionId = String(session.subscription);
    }
    if (!subscriptionId) return jsonResponse({ success: true, status: 'processing' });
    const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (subscription.customer !== profile.stripeCustomerId) throw new Error('Subscription customer mismatch.');
    await applySubscription(db, admin, user.uid, subscription, 'billing.reconciled', `sync_${subscription.id}_${subscription.status}_${subscription.current_period_end || 0}`);
    return jsonResponse({ success: true, status: subscription.status });
  } catch (error) {
    console.error('Billing sync failed:', user.uid, error.code || error.message);
    return jsonResponse({ success: false, error: 'Subscription status is temporarily unavailable.' }, 503);
  }
};
