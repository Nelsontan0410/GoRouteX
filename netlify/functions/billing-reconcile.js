import { getFirebaseAdmin } from './_shared/firebase-admin.js';
import { isDeveloperBillingExempt } from './_shared/billing-domain.js';
import { stripeRequest } from './_shared/stripe-api.js';
import { applySubscription } from './stripe-webhook.js';

export default async () => {
  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const now = new Date();
  const profiles = await db.collection('users').where('billingStatus', '==', 'grace').limit(250).get();
  let downgraded = 0;
  let recovered = 0;
  let skipped = 0;
  for (const doc of profiles.docs) {
    const profile = doc.data() || {};
    const graceEnd = profile.graceEndsAt?.toDate?.() || new Date(profile.graceEndsAt || '');
    if (isDeveloperBillingExempt(profile) || !Number.isFinite(graceEnd.getTime()) || graceEnd > now) continue;
    if (!profile.stripeSubscriptionId || !profile.stripeCustomerId) { skipped++; continue; }
    let subscription;
    try {
      subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(profile.stripeSubscriptionId)}`);
    } catch (error) {
      console.error('Billing grace reconciliation failed:', doc.id, error.code || error.message);
      skipped++;
      continue;
    }
    if (subscription.customer !== profile.stripeCustomerId) { skipped++; continue; }
    if (['active', 'trialing', 'canceled'].includes(subscription.status)) {
      await applySubscription(db, admin, doc.id, subscription, 'billing.grace_reconciled', `grace_${subscription.id}_${subscription.status}_${subscription.current_period_end || 0}`);
      recovered++;
      continue;
    }
    if (!['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(subscription.status)) { skipped++; continue; }
    await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(doc.ref);
      if (latest.data()?.billingStatus !== 'grace') return;
      transaction.set(doc.ref, {
        productPlanKey: 'basic', productPlan: 'basic', planStatus: 'expired', billingStatus: 'expired',
        paymentStatus: 'failed', planExpiresAt: admin.firestore.Timestamp.fromDate(now),
        graceEndedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(doc.ref.collection('billingEvents').doc(`grace_expired_${subscription.id}`), {
        type: 'grace_expired', status: 'downgraded_to_basic',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    downgraded++;
  }
  return new Response(JSON.stringify({ success: true, downgraded, recovered, skipped }), { status: 200 });
};

export const config = { schedule: '@hourly' };
