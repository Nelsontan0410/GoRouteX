import { getFirebaseAdmin } from './_shared/firebase-admin.js';
import { createCatalogVersion } from './_shared/billing-store.js';

export default async () => {
  const firebaseAdmin = getFirebaseAdmin();
  try {
    const catalog = await createCatalogVersion({ db: firebaseAdmin.firestore() });
    await firebaseAdmin.firestore().collection('billingOperations').doc('priceRefresh').set({
      status: 'success',
      version: catalog.version,
      completedAt: new Date(),
      source: 'scheduled'
    }, { merge: true });
    return new Response(JSON.stringify({ success: true, version: catalog.version }), { status: 200 });
  } catch (error) {
    console.error('Scheduled billing price refresh failed:', error.message);
    return new Response(JSON.stringify({ success: false }), { status: 503 });
  }
};

export const config = { schedule: '@daily' };
