import { getFirebaseAdmin, jsonResponse } from './_shared/firebase-admin.js';
import { createCatalogVersion } from './_shared/billing-store.js';

function isAuthorized(req) {
  const token = Netlify.env.get('BILLING_PRICE_REFRESH_TOKEN') || '';
  return Boolean(token) && req.headers.get('x-billing-refresh-token') === token;
}

export async function refreshBillingPrices() {
  const firebaseAdmin = getFirebaseAdmin();
  const catalog = await createCatalogVersion({ db: firebaseAdmin.firestore() });
  await firebaseAdmin.firestore().collection('billingOperations').doc('priceRefresh').set({
    status: 'success',
    version: catalog.version,
    completedAt: new Date()
  }, { merge: true });
  return catalog;
}

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  if (!isAuthorized(req)) return jsonResponse({ success: false, error: 'Not authorized' }, 403);
  try {
    const catalog = await refreshBillingPrices();
    return jsonResponse({ success: true, version: catalog.version });
  } catch (error) {
    console.error('Billing price refresh failed:', error.message);
    return jsonResponse({ success: false, error: 'Billing prices were not refreshed.' }, 503);
  }
};
