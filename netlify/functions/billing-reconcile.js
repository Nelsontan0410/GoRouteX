import { getFirebaseAdmin } from './_shared/firebase-admin.js';
import { isDeveloperBillingExempt } from './_shared/billing-domain.js';
import { stripeRequest } from './_shared/stripe-api.js';
import { applySubscription } from './stripe-webhook.js';

const PAGE_SIZE = 250;

async function reconcileProfile(db, admin, doc, now) {
  const profile = doc.data() || {};
  const graceEnd = profile.graceEndsAt?.toDate?.() || new Date(profile.graceEndsAt || '');
  if (isDeveloperBillingExempt(profile) || !Number.isFinite(graceEnd.getTime()) || graceEnd > now) return 'not_due';
  if (!profile.stripeSubscriptionId || !profile.stripeCustomerId) return 'skipped';
  let subscription;
  try {
    subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(profile.stripeSubscriptionId)}`);
  } catch (error) {
    console.error('Billing grace reconciliation failed:', doc.id, error.code || error.message);
    return 'skipped';
  }
  if (subscription.customer !== profile.stripeCustomerId) return 'skipped';
  if (['active', 'trialing', 'canceled'].includes(subscription.status)) {
    await applySubscription(db, admin, doc.id, subscription, 'billing.grace_reconciled', `grace_${subscription.id}_${subscription.status}_${subscription.current_period_end || 0}`);
    return 'recovered';
  }
  if (!['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(subscription.status)) return 'skipped';
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
  return 'downgraded';
}

export async function reconcileGrace(db, admin, now = new Date()) {
  const counts = { downgraded: 0, recovered: 0, skipped: 0, failed: 0 };
  let lastDoc = null;
  // Page through every grace profile so a large backlog can't hide expired ones past the first page.
  for (;;) {
    let query = db.collection('users').where('billingStatus', '==', 'grace').limit(PAGE_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);
    const page = await query.get();
    for (const doc of page.docs) {
      try {
        const result = await reconcileProfile(db, admin, doc, now);
        if (result in counts) counts[result]++;
      } catch (error) {
        // One bad profile must not abort the rest of the hourly run.
        console.error('Billing grace reconciliation error:', doc.id, error.message);
        counts.failed++;
      }
    }
    if (page.docs.length < PAGE_SIZE) break;
    lastDoc = page.docs[page.docs.length - 1];
  }
  return counts;
}

export default async () => {
  const admin = getFirebaseAdmin();
  const counts = await reconcileGrace(admin.firestore(), admin);
  return new Response(JSON.stringify({ success: true, ...counts }), { status: 200 });
};

export const config = { schedule: '@hourly' };
