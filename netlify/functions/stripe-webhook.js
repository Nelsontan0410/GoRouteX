import Stripe from 'stripe';
import {
  getFirebaseAdmin,
  jsonResponse,
  sanitizeText
} from './_shared/firebase-admin.js';
import { getGraceEndsAt, isDeveloperBillingExempt } from './_shared/billing-domain.js';
import { resolveUserIdFromStripeObject } from './_shared/billing-store.js';
import { stripeRequest, verifyStripeWebhookSignature } from './_shared/stripe-api.js';

function toTimestamp(firebaseAdmin, unixSeconds) {
  const value = Number(unixSeconds || 0);
  return value > 0 ? firebaseAdmin.firestore.Timestamp.fromMillis(value * 1000) : null;
}

function subscriptionPlan(subscription, profile) {
  const candidate = String(subscription?.metadata?.goroutex_plan || profile?.productPlanKey || '').toLowerCase();
  return candidate === 'goplan' || candidate === 'proplan' ? candidate : 'basic';
}

function subscriptionInterval(subscription, profile) {
  const candidate = String(subscription?.metadata?.goroutex_interval || profile?.billingInterval || '').toLowerCase();
  return candidate === 'year' ? 'year' : 'month';
}

async function appendBillingEvent(userRef, firebaseAdmin, type, status, details = {}, eventId = '') {
  await userRef.collection('billingEvents').doc(`stripe_${eventId || type}`).set({
    type,
    status,
    provider: 'stripe',
    ...details,
    createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
  });
}

export async function applySubscription(db, firebaseAdmin, uid, subscription, eventType, eventId) {
  const userRef = db.collection('users').doc(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) throw new Error('Stripe event user profile was not found.');
  const profile = snapshot.data() || {};
  if (isDeveloperBillingExempt(profile)) {
    await appendBillingEvent(userRef, firebaseAdmin, eventType, 'ignored_developer_exempt', { stripeSubscriptionId: subscription.id }, eventId);
    return;
  }

  if (profile.stripeSubscriptionId && profile.stripeSubscriptionId !== subscription.id
    && !['cancelled', 'expired', 'basic'].includes(String(profile.billingStatus || '').toLowerCase())) {
    throw new Error('A different subscription already controls this workspace.');
  }
  const status = String(subscription.status || '').toLowerCase();
  if (status === 'canceled') {
    await downgradeAfterSubscriptionEnd(db, firebaseAdmin, uid, subscription, eventType, eventId);
    return;
  }
  if (status === 'incomplete_expired') {
    if (profile.stripeSubscriptionId !== subscription.id) return;
    if (String(profile.billingStatus || '').toLowerCase() !== 'incomplete') {
      await downgradeAfterSubscriptionEnd(db, firebaseAdmin, uid, subscription, eventType, eventId);
      return;
    }
    // The first payment was never completed, so no paid access was granted: just release the subscription link.
    await userRef.set({
      stripeSubscriptionId: '',
      billingStatus: 'basic',
      paymentStatus: 'cancelled',
      stripeCheckoutPendingAt: null,
      stripeCheckoutPendingSessionId: '',
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await appendBillingEvent(userRef, firebaseAdmin, eventType, 'incomplete_expired', { stripeSubscriptionId: subscription.id }, eventId);
    return;
  }
  if (status === 'incomplete') {
    // First payment pending (e.g. 3DS not completed): link the subscription but grant no paid access yet.
    await userRef.set({
      stripeCustomerId: subscription.customer || profile.stripeCustomerId || '',
      stripeSubscriptionId: subscription.id,
      billingStatus: 'incomplete',
      paymentStatus: 'pending',
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await appendBillingEvent(userRef, firebaseAdmin, eventType, 'incomplete', { stripeSubscriptionId: subscription.id }, eventId);
    return;
  }
  if (!['trialing', 'active', 'past_due', 'unpaid'].includes(status)) {
    throw new Error('Unsupported Stripe subscription state.');
  }
  const plan = subscriptionPlan(subscription, profile);
  const periodEnd = toTimestamp(firebaseAdmin, subscription.current_period_end || subscription.trial_end);
  const now = new Date();
  const common = {
    stripeCustomerId: subscription.customer || profile.stripeCustomerId || '',
    stripeSubscriptionId: subscription.id,
    productPlanKey: plan,
    productPlan: plan,
    billingInterval: subscriptionInterval(subscription, profile),
    billingCurrency: String(subscription.currency || profile.billingCurrency || '').toUpperCase(),
    billingPriceVersion: sanitizeText(subscription.metadata?.goroutex_price_version || profile.billingPriceVersion || '', 80),
    stripePriceId: String(subscription.items?.data?.[0]?.price?.id || profile.stripePriceId || ''),
    subscriptionCancelAt: subscription.cancel_at_period_end ? periodEnd : null,
    updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
  };

  if (status === 'trialing') {
    await userRef.set({
      ...common,
      planStatus: 'active',
      billingStatus: subscription.cancel_at_period_end ? 'cancel_at_period_end' : 'trialing',
      paymentStatus: 'trialing',
      trialEndsAt: toTimestamp(firebaseAdmin, subscription.trial_end || subscription.current_period_end),
      planStartedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      planExpiresAt: periodEnd,
      graceEndsAt: null,
      stripeTrialUsedAt: profile.stripeTrialUsedAt || firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      stripeCheckoutPendingAt: null,
      stripeCheckoutPendingSessionId: ''
    }, { merge: true });
    await appendBillingEvent(userRef, firebaseAdmin, eventType, 'trialing', { stripeSubscriptionId: subscription.id, plan }, eventId);
    return;
  }

  if (status === 'active') {
    await userRef.set({
      ...common,
      planStatus: 'active',
      billingStatus: subscription.cancel_at_period_end ? 'cancel_at_period_end' : 'active',
      paymentStatus: 'paid',
      planStartedAt: profile.planStartedAt || firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      planExpiresAt: periodEnd,
      graceEndsAt: null,
      stripeCheckoutPendingAt: null,
      stripeCheckoutPendingSessionId: ''
    }, { merge: true });
    await appendBillingEvent(userRef, firebaseAdmin, eventType, 'active', { stripeSubscriptionId: subscription.id, plan }, eventId);
    return;
  }

  if (status === 'past_due' || status === 'unpaid') {
    const graceEndsAt = getGraceEndsAt({ existingGraceEndsAt: profile.stripeSubscriptionId === subscription.id ? (profile.graceEndsAt?.toDate?.() || profile.graceEndsAt) : null, now });
    await userRef.set({
      ...common,
      planStatus: 'active',
      billingStatus: 'grace',
      paymentStatus: 'failed',
      graceEndsAt: firebaseAdmin.firestore.Timestamp.fromDate(graceEndsAt),
      planExpiresAt: firebaseAdmin.firestore.Timestamp.fromDate(graceEndsAt)
    }, { merge: true });
    await appendBillingEvent(userRef, firebaseAdmin, eventType, 'grace', { stripeSubscriptionId: subscription.id, graceEndsAt }, eventId);
  }
}

async function downgradeAfterSubscriptionEnd(db, firebaseAdmin, uid, subscription, eventType, eventId) {
  const userRef = db.collection('users').doc(uid);
  const snapshot = await userRef.get();
  const profile = snapshot.exists ? snapshot.data() || {} : {};
  if (!snapshot.exists || isDeveloperBillingExempt(profile) || profile.stripeSubscriptionId !== subscription.id) return;
  await userRef.set({
    productPlanKey: 'basic',
    productPlan: 'basic',
    planStatus: 'expired',
    billingStatus: 'cancelled',
    paymentStatus: 'cancelled',
    planExpiresAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    graceEndsAt: null,
    subscriptionCancelAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await appendBillingEvent(userRef, firebaseAdmin, eventType, 'downgraded_to_basic', { stripeSubscriptionId: subscription.id }, eventId);
}

async function claimEvent(db, firebaseAdmin, event) {
  const eventRef = db.collection('stripeWebhookEvents').doc(event.id);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(eventRef);
    if (existing.exists && existing.data()?.status === 'processed') return false;
    const receivedAt = existing.data()?.receivedAt?.toMillis?.() || 0;
    if (existing.data()?.status === 'processing' && Date.now() - receivedAt < 10 * 60 * 1000) return false;
    transaction.set(eventRef, {
      type: event.type,
      status: 'processing',
      receivedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      attempts: firebaseAdmin.firestore.FieldValue.increment(1)
    }, { merge: true });
    return true;
  });
}

async function handleEvent(db, firebaseAdmin, event) {
  const object = event.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    const uid = await resolveUserIdFromStripeObject(db, object);
    if (!uid || !object.subscription) throw new Error('Checkout event was missing its GoRouteX account reference.');
    const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(object.subscription)}`);
    await applySubscription(db, firebaseAdmin, uid, subscription, event.type, event.id);
    return;
  }

  if (event.type.startsWith('customer.subscription.')) {
    const uid = await resolveUserIdFromStripeObject(db, object);
    if (!uid) throw new Error('Subscription event was missing its GoRouteX account reference.');
    if (event.type === 'customer.subscription.deleted') {
      await downgradeAfterSubscriptionEnd(db, firebaseAdmin, uid, object, event.type, event.id);
    } else {
      // Current Stripe state wins over out-of-order webhook snapshots.
      const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(object.id)}`);
      await applySubscription(db, firebaseAdmin, uid, subscription, event.type, event.id);
    }
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    const uid = await resolveUserIdFromStripeObject(db, object);
    if (!uid) throw new Error('Payment failure event was missing its GoRouteX account reference.');
    const subscriptionId = String(object.subscription || '').trim();
    if (!subscriptionId) return;
    const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
    await applySubscription(db, firebaseAdmin, uid, subscription, event.type, event.id);
    return;
  }

  if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
    const uid = await resolveUserIdFromStripeObject(db, object);
    const subscriptionId = String(object.subscription || '').trim();
    if (!uid || !subscriptionId) return;
    const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
    await applySubscription(db, firebaseAdmin, uid, subscription, event.type, event.id);
  }
}

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  const payload = await req.text();
  const webhookSecret = Netlify.env.get('STRIPE_WEBHOOK_SECRET') || '';
  const signature = req.headers.get('stripe-signature') || '';
  if (!verifyStripeWebhookSignature(payload, signature, webhookSecret)) {
    return jsonResponse({ success: false, error: 'Invalid Stripe signature.' }, 400);
  }

  const stripeSecretKey = Netlify.env.get('STRIPE_SECRET_KEY') || '';
  if (!stripeSecretKey) return jsonResponse({ success: false, error: 'Stripe webhook is not configured.' }, 503);
  let event;
  try {
    event = new Stripe(stripeSecretKey).webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    return jsonResponse({ success: false, error: 'Invalid webhook payload or signature.' }, 400);
  }
  if (!event?.id || !event?.type) return jsonResponse({ success: false, error: 'Invalid Stripe event.' }, 400);

  const firebaseAdmin = getFirebaseAdmin();
  const db = firebaseAdmin.firestore();
  const shouldProcess = await claimEvent(db, firebaseAdmin, event);
  if (!shouldProcess) return jsonResponse({ success: true, duplicate: true });

  try {
    await handleEvent(db, firebaseAdmin, event);
    await db.collection('stripeWebhookEvents').doc(event.id).set({
      status: 'processed',
      processedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Stripe webhook handling failed:', event.id, event.type, error.message);
    await db.collection('stripeWebhookEvents').doc(event.id).set({
      status: 'failed',
      error: sanitizeText(error.message, 300),
      failedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return jsonResponse({ success: false, error: 'Webhook processing failed.' }, 500);
  }
};
