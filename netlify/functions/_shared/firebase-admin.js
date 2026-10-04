import admin from 'firebase-admin';

const INVALID_TOKEN_CODES = new Set(['auth/argument-error', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token', 'auth/user-disabled', 'auth/user-not-found']);

function getEnv(name) {
  return Netlify.env.get(name) || '';
}

function parseServiceAccount() {
  const rawJson = getEnv('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (rawJson) {
    return JSON.parse(rawJson);
  }

  const projectId = getEnv('FIREBASE_PROJECT_ID');
  const clientEmail = getEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = getEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin credentials are not configured.');
  }

  return {
    projectId,
    clientEmail,
    privateKey
  };
}

export function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = parseServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  return admin;
}

export async function verifyFirebaseUser(req, adminOverride = null) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return null;
  }

  const firebaseAdmin = adminOverride || getFirebaseAdmin();
  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(token);
    return decoded.role === 'driver' || decoded.uid.startsWith('drv_') ? firebaseAdmin.auth().verifyIdToken(token, true) : decoded;
  } catch (error) {
    // Invalid/revoked credentials are unauthenticated, not a server outage.
    if (INVALID_TOKEN_CODES.has(error?.code)) return null;
    throw error;
  }
}

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Responses carry checkout/portal URLs and account data; never let a proxy or browser cache them.
      'Cache-Control': 'no-store'
    }
  });
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch (error) {
    return {};
  }
}

export function getAdminEmailSet() {
  return new Set(
    getEnv('ADMIN_APPROVAL_EMAILS')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAllowedAdmin(decodedToken) {
  const email = String(decodedToken?.email || '').trim().toLowerCase();
  const allowedEmails = getAdminEmailSet();
  return decodedToken?.admin === true || (email && allowedEmails.has(email));
}

export function sanitizeText(value, maxLength = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function parsePlanExpiry({ planExpiresAt, days } = {}) {
  const explicitDate = planExpiresAt ? new Date(planExpiresAt) : null;
  if (explicitDate && !Number.isNaN(explicitDate.getTime())) {
    return explicitDate;
  }

  const durationDays = Number.isFinite(Number(days)) && Number(days) > 0
    ? Math.min(Number(days), 3660)
    : 30;
  return new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
}
