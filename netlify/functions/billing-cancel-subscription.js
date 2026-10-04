import { randomUUID } from 'node:crypto';
import {
  getFirebaseAdmin,
  jsonResponse,
  readJson,
  sanitizeText,
  verifyFirebaseUser
} from './_shared/firebase-admin.js';
import { requireBillingOwner } from './_shared/driver-domain.js';
import { isDeveloperBillingExempt } from './_shared/billing-domain.js';
import { stripeRequest } from './_shared/stripe-api.js';

const ALLOWED_REASONS = new Set(['too_expensive', 'not_using_enough', 'missing_features', 'technical_issue', 'switching_service', 'other']);

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  const user = await verifyFirebaseUser(req);
  if (!user?.uid) return jsonResponse({ success: false, error: 'Login required' }, 401);

  const body = await readJson(req);
  const reason = sanitizeText(body.reason, 80).toLowerCase();
  const otherReason = sanitizeText(body.otherReason, 500);
  const feedback = sanitizeText(body.feedback, 1200);
  if (!ALLOWED_REASONS.has(reason)) return jsonResponse({ success: false, error: 'Select a cancellation reason.' }, 400);
  if (reason === 'other' && otherReason.length < 3) return jsonResponse({ success: false, error: 'Describe the other cancellation reason before continuing.' }, 400);

  try {
    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();
    const userRef = db.collection('users').doc(user.uid);
    const profile = (await userRef.get()).data() || {};
    try { requireBillingOwner(user, profile); } catch (error) { return jsonResponse({ success: false, error: 'Workspace account required.', code: error?.code || 'FORBIDDEN' }, 403); }
    if (isDeveloperBillingExempt(profile)) return jsonResponse({ success: false, error: 'Developer access does not have a Stripe subscription to cancel.' }, 409);
    if (!profile.stripeSubscriptionId) return jsonResponse({ success: false, error: 'No active Stripe subscription was found.' }, 404);

    // Cancelling at period end also cancels a trial at its end, preventing the
    // first charge while preserving the remaining trial access.
    const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(profile.stripeSubscriptionId)}`, {
      method: 'POST',
      data: { cancel_at_period_end: true },
      // Unique per request: a fixed key would replay a cached response after a portal resume + re-cancel.
      idempotencyKey: `goroutex-cancel-${user.uid}-${profile.stripeSubscriptionId}-${randomUUID()}`
    });
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp();
    const periodEnd = Number(subscription.current_period_end || subscription.trial_end || 0);
    const periodEndAt = periodEnd > 0 ? firebaseAdmin.firestore.Timestamp.fromMillis(periodEnd * 1000) : null;
    await db.runTransaction(async (transaction) => {
      transaction.set(userRef.collection('cancellationRequests').doc(subscription.id), {
        stripeSubscriptionId: subscription.id,
        reason,
        otherReason: reason === 'other' ? otherReason : '',
        feedback,
        status: 'scheduled',
        requestedAt: now,
        accessEndsAt: periodEndAt
      }, { merge: true });
      transaction.set(userRef, {
        billingStatus: 'cancel_at_period_end',
        paymentStatus: String(subscription.status || 'active'),
        subscriptionCancelRequestedAt: now,
        subscriptionCancelAt: periodEndAt,
        updatedAt: now
      }, { merge: true });
    });
    return jsonResponse({
      success: true,
      accessEndsAt: periodEndAt ? periodEndAt.toDate().toISOString() : '',
      message: 'Cancellation is scheduled. No charge will be made after the current trial or paid period ends.'
    });
  } catch (error) {
    console.error('Subscription cancellation failed:', error.code || error.message);
    return jsonResponse({ success: false, error: 'Cancellation could not be completed. Please try again.' }, 503);
  }
};
