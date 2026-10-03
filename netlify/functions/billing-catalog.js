import { getFirebaseAdmin, jsonResponse } from './_shared/firebase-admin.js';
import { getBillingCatalog, publicCatalog } from './_shared/billing-store.js';

export default async (req) => {
  if (req.method !== 'GET') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }
  try {
    const db = getFirebaseAdmin().firestore();
    return jsonResponse({ success: true, catalog: publicCatalog(await getBillingCatalog(db)) });
  } catch (error) {
    console.error('Billing catalog read failed:', error.message);
    return jsonResponse({ success: false, error: 'Billing prices are unavailable right now.' }, 503);
  }
};
