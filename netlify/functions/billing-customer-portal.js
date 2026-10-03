import { getFirebaseAdmin, jsonResponse, verifyFirebaseUser } from './_shared/firebase-admin.js';
import { requireBillingOwner } from './_shared/driver-domain.js';
import { isDeveloperBillingExempt } from './_shared/billing-domain.js';
import { getStripePortalConfigurationId, stripeRequest } from './_shared/stripe-api.js';

function getAppUrl() {
  try {
    return new URL(Netlify.env.get('APP_PUBLIC_URL') || Netlify.env.get('URL')).origin;
  } catch (error) {
    return '';
  }
}

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  const user = await verifyFirebaseUser(req);
  if (!user?.uid) return jsonResponse({ success: false, error: 'Login required' }, 401);
  try {
    const db = getFirebaseAdmin().firestore();
    const profile = (await db.collection('users').doc(user.uid).get()).data() || {};
    try { requireBillingOwner(user, profile); } catch (error) { return jsonResponse({ success: false, error: 'Workspace account required.', code: error?.code || 'FORBIDDEN' }, 403); }
    if (isDeveloperBillingExempt(profile)) return jsonResponse({ success: false, error: 'Developer access does not have a Stripe subscription.' }, 409);
    if (!profile.stripeCustomerId) return jsonResponse({ success: false, error: 'No Stripe subscription was found for this account.' }, 404);
    const returnUrl = `${getAppUrl()}/app.html?page=account`;
    if (!returnUrl.startsWith('http')) return jsonResponse({ success: false, error: 'Billing portal is not configured with the app URL.' }, 503);
    const configuration = getStripePortalConfigurationId();
    if (!configuration) return jsonResponse({ success: false, error: 'Billing portal is not configured yet.' }, 503);
    const portalConfiguration = await stripeRequest(`/billing_portal/configurations/${encodeURIComponent(configuration)}`);
    if (portalConfiguration?.features?.subscription_update?.enabled) {
      return jsonResponse({ success: false, error: 'Plan switching in the billing portal is not configured for this version.' }, 503);
    }
    const session = await stripeRequest('/billing_portal/sessions', {
      method: 'POST',
      data: { customer: profile.stripeCustomerId, return_url: returnUrl, configuration }
    });
    return jsonResponse({ success: true, portalUrl: session.url });
  } catch (error) {
    console.error('Billing portal creation failed:', error.code || error.message);
    return jsonResponse({ success: false, error: 'Billing portal is unavailable right now.' }, 503);
  }
};
