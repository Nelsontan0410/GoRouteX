import {
  getFirebaseAdmin,
  jsonResponse,
  readJson,
  sanitizeText,
  verifyFirebaseUser
} from './_shared/firebase-admin.js';
import { requireBillingOwner } from './_shared/driver-domain.js';
import { isDeveloperBillingExempt, isSupportedOffer, normalizeCurrency, normalizeInterval, normalizePlan } from './_shared/billing-domain.js';
import { getBillingCatalog, getOrCreateStripeCustomer, isCatalogUsable } from './_shared/billing-store.js';
import { stripeRequest, validateStripePrice } from './_shared/stripe-api.js';

function getEnv(name) {
  return Netlify.env.get(name) || '';
}

function getAppUrl() {
  const raw = getEnv('APP_PUBLIC_URL') || getEnv('URL');
  try {
    return new URL(raw).origin;
  } catch (error) {
    return '';
  }
}

function checkoutError(error) {
  const code = String(error?.code || 'checkout_unavailable');
  if (code === 'stripe_not_configured') return 'Stripe checkout is not configured yet.';
  return 'Checkout could not be created. Please try again later.';
}

function toMillis(value) {
  if (value?.toDate) return value.toDate().getTime();
  return new Date(value || '').getTime();
}

function hasOpenSubscription(profile = {}) {
  // An expired payment grace period can still have an unpaid Stripe
  // subscription. Sending it to a second Checkout could create two bills.
  return Boolean(profile.stripeSubscriptionId)
    && !['cancelled', 'canceled'].includes(String(profile.billingStatus || '').toLowerCase());
}

async function acquireCheckoutLock(db, firebaseAdmin, userRef) {
  const lockId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const profile = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const latest = snapshot.exists ? snapshot.data() || {} : {};
    if (isDeveloperBillingExempt(latest)) return null;
    if (hasOpenSubscription(latest)) return null;
    const pendingCheckoutAt = toMillis(latest.stripeCheckoutPendingAt);
    if (Number.isFinite(pendingCheckoutAt) && Date.now() - pendingCheckoutAt < 30 * 60 * 1000) return null;
    transaction.set(userRef, {
      stripeCheckoutPendingAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      stripeCheckoutPendingSessionId: lockId,
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return latest;
  });
  return { lockId, profile };
}

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const decodedToken = await verifyFirebaseUser(req);
  if (!decodedToken?.uid) return jsonResponse({ success: false, error: 'Login required' }, 401);

  const body = await readJson(req);
  const plan = normalizePlan(body.plan);
  const interval = normalizeInterval(body.interval);
  const currency = normalizeCurrency(body.currency);
  if (!plan || !interval || !currency || !isSupportedOffer(plan, interval)) {
    return jsonResponse({ success: false, error: 'Choose a supported plan, billing interval, and currency.' }, 400);
  }

  if (!getEnv('STRIPE_SECRET_KEY') || !getEnv('STRIPE_WEBHOOK_SECRET')) {
    return jsonResponse({ success: false, error: 'Stripe checkout is not configured yet.' }, 503);
  }

  const appUrl = getAppUrl();
  if (!appUrl) return jsonResponse({ success: false, error: 'Checkout is not configured with the app URL.' }, 503);

  let checkoutLock = null;
  let checkoutUserRef = null;
  try {
    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();
    const userRef = db.collection('users').doc(decodedToken.uid);
    const requesterProfile = (await userRef.get()).data() || {};
    try { requireBillingOwner(decodedToken, requesterProfile); } catch (error) { return jsonResponse({ success: false, error: 'Workspace account required.', code: error?.code || 'FORBIDDEN' }, 403); }
    const catalog = await getBillingCatalog(db);
    const selectedOffer = catalog?.offers?.[plan]?.[interval]?.[currency];
    if (!selectedOffer?.priceId || (currency !== 'SGD' && !isCatalogUsable(catalog))) {
      return jsonResponse({ success: false, error: 'The selected currency price is temporarily unavailable. Choose SGD or try again after prices refresh.' }, 503);
    }

    // Check the server-selected Price against Stripe before creating a customer
    // or holding a checkout lock. A test key cannot charge a live Price.
    await validateStripePrice(selectedOffer.priceId, { currency, interval });

    checkoutUserRef = userRef;
    checkoutLock = await acquireCheckoutLock(db, firebaseAdmin, userRef);
    if (!checkoutLock.profile) {
      return jsonResponse({ success: false, error: 'This account already has a subscription, developer access, or an open checkout session. Manage existing billing before starting another.' }, 409);
    }
    const profile = checkoutLock.profile;

    const customerId = await getOrCreateStripeCustomer({
      db,
      userRef,
      profile,
      uid: decodedToken.uid,
      email: decodedToken.email || profile.email || '',
      name: sanitizeText(profile.name || decodedToken.name || '', 160)
    });
    const trialEligible = !profile.stripeTrialUsedAt;
    const requestRef = userRef.collection('paymentRequests').doc();
    const checkout = await stripeRequest('/checkout/sessions', {
      method: 'POST',
      data: {
        mode: 'subscription',
        customer: customerId,
        payment_method_collection: 'always',
        client_reference_id: decodedToken.uid,
        success_url: `${appUrl}/app.html?page=account&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/app.html?page=account&checkout=cancelled`,
        line_items: [{ price: selectedOffer.priceId, quantity: 1 }],
        metadata: {
          goroutex_uid: decodedToken.uid,
          goroutex_plan: plan,
          goroutex_interval: interval,
          goroutex_currency: currency,
          goroutex_price_version: catalog.version,
          goroutex_trial_eligible: String(trialEligible)
        },
        subscription_data: {
          ...(trialEligible ? { trial_period_days: 3 } : {}),
          metadata: {
            goroutex_uid: decodedToken.uid,
            goroutex_plan: plan,
            goroutex_interval: interval,
            goroutex_currency: currency,
            goroutex_price_version: catalog.version,
            goroutex_trial_eligible: String(trialEligible)
          }
        }
      },
      idempotencyKey: `goroutex-checkout-${decodedToken.uid}-${requestRef.id}`
    });

    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp();
    await requestRef.set({
      requestedPlan: plan,
      interval,
      currency,
      priceVersion: catalog.version,
      stripePriceId: selectedOffer.priceId,
      stripeCheckoutSessionId: checkout.id,
      status: 'checkout_created',
      source: 'stripe_checkout',
      createdAt: now,
      updatedAt: now
    });
    await userRef.set({
      stripeCheckoutPendingAt: now,
      stripeCheckoutPendingSessionId: checkout.id,
      updatedAt: now
    }, { merge: true });

    return jsonResponse({ success: true, checkoutUrl: checkout.url });
  } catch (error) {
    if (checkoutLock?.lockId && checkoutUserRef) {
      const latest = await checkoutUserRef.get().catch(() => null);
      if (latest?.data?.()?.stripeCheckoutPendingSessionId === checkoutLock.lockId) {
        await checkoutUserRef.set({
          stripeCheckoutPendingAt: null,
          stripeCheckoutPendingSessionId: '',
          updatedAt: new Date()
        }, { merge: true }).catch(() => {});
      }
    }
    console.error('Stripe checkout creation failed:', error.code || error.message);
    return jsonResponse({ success: false, error: checkoutError(error) }, 503);
  }
};
