// Firebase Configuration for BJS Delivery Route Planner
// Replace these values with your Firebase project configuration

const firebaseConfig = {
  apiKey: "AIzaSyAx5bVPAq2SItHhixAF7cUszvDBpRTVavo",
  authDomain: "delivery-app-cd18e.firebaseapp.com",
  projectId: "delivery-app-cd18e",
  storageBucket: "delivery-app-cd18e.firebasestorage.app",
  messagingSenderId: "639538125442",
  appId: "1:639538125442:web:3474ca6a49d80da45ab29b",
  measurementId: "G-ZM4B4HQLHS"
};

// Startup timing for diagnosing slow dashboard loads: first occurrence of each step, in ms since
// navigation start. Printed once when route history first renders (see app.html loadRouteHistory).
window.GoRouteXTiming = window.GoRouteXTiming || (() => {
    const marks = {};
    let reported = false;
    return {
        marks,
        notes: {},
        // Free-form diagnostic values (counts, sizes), printed with the marks.
        note(name, value) { try { this.notes[name] = value; } catch (_) {} },
        // Diagnostics only: must never break the step being measured.
        mark(name) {
            try {
                if (marks[name] === undefined) marks[name] = Math.round(typeof performance !== 'undefined' ? performance.now() : Date.now());
            } catch (_) {}
        },
        report() {
            if (reported) return;
            reported = true;
            console.info('[GoRouteX timing] ms since page start:', { ...marks, ...this.notes });
        }
    };
})();

// Initialize Firebase
let app, auth, db;
let _firebaseInitDone = false;
let _persistenceEnabled = false;
const TRIAL_DAYS = 7;
const STOPS_CACHE_VERSION = 1;
const STOPS_DOC_SAFE_BYTES = 900000;
const STOPS_CHUNK_TARGET_BYTES = 220000;
const STOPS_WRITE_DEBOUNCE_MS = 800;
const HISTORY_LOAD_LIMIT = 20;
const APP_ENTRY_ALLOWLIST = new Set(['app.html', 'driver-tracking.html', 'order-hub.html', 'settings.html', 'dispatch.html']);
const APP_PAGE_HASH_ALLOWLIST = new Set([
    'page-history-dashboard',
    'page-history-browser',
    'page-select-stops',
    'page-manual-assign',
    'page-optimized-routes',
    'page-maps-preview',
    'page-fullscreen-map',
    'page-gps-tracking',
    'page-add-stop',
    'page-account-access'
]);
const DRIVER_TRACKING_QUERY_ALLOWLIST = new Set([
    'routeId',
    'routeName',
    'driverId',
    'driverName',
    'sessionId'
]);
const TRACKING_STATUS_ALLOWLIST = new Set(['active', 'paused', 'stopped', 'error']);
const TRACKING_NETWORK_STATUS_ALLOWLIST = new Set(['online', 'offline']);
const DRIVER_TRACKING_SOURCE = 'web';
let _stopsMem = [];
let _stopsLoaded = false;
let _stopsStorageMode = 'single';
let _stopsCacheUid = null;
let _stopsWriteTimer = null;
let _stopsFlushPromise = null;
let _stopsPendingWrite = false;
let _stopsDirtyGen = 0;
let _historyBackfillUid = null;
const _historyPageCursors = new Map();

function initializeFirebase() {
    if (_firebaseInitDone && app && auth && db) {
        return true;
    }

    try {
        if (!firebase.apps.length) {
            app = firebase.initializeApp(firebaseConfig);
        } else {
            app = firebase.apps[0];
        }

        auth = auth || firebase.auth();
        db = db || firebase.firestore();

        // Safari (desktop + iOS) can hang Firestore reads when IndexedDB persistence
        // is enabled (esp. with multi-tab sync), so skip persistence there and use
        // auto-detected long polling to survive Safari's WebChannel/streaming quirks.
        const _ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
        const _isSafariEngine = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(_ua)
            || /iPad|iPhone|iPod/.test(_ua);
        try {
            if (_isSafariEngine) {
                db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
            }
        } catch (e) {
            console.warn("Firestore settings skipped:", e?.message || e);
        }
        try {
            if (!_persistenceEnabled) {
                _persistenceEnabled = true;
                if (_isSafariEngine) {
                    console.info("Firestore persistence skipped on Safari");
                } else {
                    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
                        console.warn("Firestore persistence disabled:", err?.message || err);
                    });
                }
            }
        } catch (e) {
            console.warn("Persistence setup skipped");
        }

        _firebaseInitDone = true;
        console.log('Firebase initialized successfully');
        return true;
    } catch (error) {
        console.error('Firebase initialization error:', error);
        return false;
    }
}

// ============================================
// FIREBASE AUTH FUNCTIONS
// ============================================

// Sign up with email and password
async function firebaseSignUp(email, password, displayName) {
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);

        // Update display name
        await userCredential.user.updateProfile({
            displayName: displayName || email.split('@')[0]
        });

        const provisioned = await ensureInitialProfileForNewAccount(userCredential.user, displayName || email.split('@')[0]);
        if (!provisioned.success) throw Error(provisioned.error || 'Could not create account profile.');

        return { success: true, user: userCredential.user };
    } catch (error) {
        console.error('Sign up error:', error);
        return { success: false, error: error.message };
    }
}

// Sign in with email and password
async function firebaseSignIn(email, password) {
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        return { success: true, user: userCredential.user };
    } catch (error) {
        console.error('Sign in error:', error);
        return { success: false, error: error.message };
    }
}

// Sign in with Google
async function firebaseSignInWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const userCredential = await auth.signInWithPopup(provider);
        if (userCredential.additionalUserInfo?.isNewUser) {
            const provisioned = await ensureInitialProfileForNewAccount(userCredential.user, userCredential.user.displayName);
            if (!provisioned.success) throw Error(provisioned.error || 'Could not create account profile.');
        }
        return { success: true, user: userCredential.user };
    } catch (error) {
        console.error('Google sign in error:', error);
        return { success: false, error: error.message };
    }
}

// Sign out
async function firebaseSignOut() {
    try {
        await auth.signOut();
        return { success: true };
    } catch (error) {
        console.error('Sign out error:', error);
        return { success: false, error: error.message };
    }
}

// Get current user
function getCurrentUser() {
    return auth ? auth.currentUser : null;
}

let workspacePersistencePromise = null;
function ensureWorkspacePersistence(user = getCurrentUser()) {
    const safari = /Safari/.test(navigator.userAgent)
        && !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|Android)/.test(navigator.userAgent);
    if (!safari || !auth || !user || isDriverAccount(user)) return Promise.resolve({ success: true, changed: false });
    if (!workspacePersistencePromise) {
        workspacePersistencePromise = auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
            .then(() => ({ success: true, changed: true }))
            .catch((error) => {
                console.warn('WORKSPACE_AUTH_PERSISTENCE_FAILED', { code: String(error?.code || 'unknown').slice(0, 60) });
                workspacePersistencePromise = null;
                return { success: false, code: error?.code || 'unknown' };
            });
    }
    return workspacePersistencePromise;
}

function getUserDocRef(uid) {
    return db.collection('users').doc(uid);
}

function getStopsCacheRef(uid) {
    return getUserDocRef(uid).collection('stopsCache').doc('main');
}

function getStopsChunksCollectionRef(uid) {
    return getUserDocRef(uid).collection('stopsChunks');
}

function getHistoryCollectionRef(uid) {
    return getUserDocRef(uid).collection('history');
}

function getLegacyRoutesCollectionRef(uid) {
    return getUserDocRef(uid).collection('routes');
}

function getPlannedRoutesCollectionRef(uid) {
    return getUserDocRef(uid).collection('plannedRoutes');
}

function getOperationSnapshotsCollectionRef(uid) {
    return getUserDocRef(uid).collection('operationSnapshots');
}

function getDriverLiveCollectionRef(uid) {
    return getUserDocRef(uid).collection('drivers_live');
}

function getTrackingSessionsCollectionRef(uid) {
    return getUserDocRef(uid).collection('tracking_sessions');
}

function getTrackingPointsCollectionRef(uid, sessionId) {
    return getTrackingSessionsCollectionRef(uid).doc(sessionId).collection('points');
}

function getSettingsDocRef(uid, settingsDocId) {
    return getUserDocRef(uid).collection('settings').doc(settingsDocId);
}

function buildStableStopId(stop) {
    if (stop.id && String(stop.id).trim()) return String(stop.id).trim();
    const name = (stop.name || stop.Name || '').toString().trim().toLowerCase();
    const address = (stop.address || stop.Address || '').toString().trim().toLowerCase();
    const phone = (stop.phone || stop['Hp No'] || '').toString().trim().toLowerCase();
    const base = `${name}|${phone}|${address}`.replace(/[^a-z0-9|]+/g, '-');
    return `stop_${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizePhoneValue(phone) {
    if (phone === undefined || phone === null) return '';
    return String(phone).trim();
}

function normalizeStop(stop) {
    const latFromCoord = (() => {
        const coord = (stop.coordinate || '').toString().trim();
        if (!coord) return { lat: null, lng: null };
        const parts = coord.split(',').map(p => Number(p.trim()));
        if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return { lat: null, lng: null };
        return { lat: parts[0], lng: parts[1] };
    })();

    const lat = typeof stop.lat === 'number' ? stop.lat : latFromCoord.lat;
    const lng = typeof stop.lng === 'number' ? stop.lng : latFromCoord.lng;
    const existingUpdatedAt = stop.updatedAt && typeof stop.updatedAt === 'object'
        ? stop.updatedAt
        : null;

    return {
        id: buildStableStopId(stop),
        name: (stop.name || stop.Name || '').toString().trim(),
        customerId: String(stop.customerId || '').trim(),
        customerName: String(stop.customerName || '').trim(),
        label: String(stop.label || stop.name || stop.Name || '').trim(),
        siteCode: String(stop.siteCode || '').trim(),
        phone: normalizePhoneValue(stop.phone || stop['Hp No']),
        address: (stop.address || stop.Address || '').toString().trim(),
        unit: (stop.unit || stop.Unit || '').toString().trim(),
        postalCode: (stop.postalCode || stop['Postal Code'] || stop.postal || '').toString().trim(),
        note: (stop.note || stop.notes || stop.Notes || '').toString().trim(),
        lat: typeof lat === 'number' && !Number.isNaN(lat) ? lat : null,
        lng: typeof lng === 'number' && !Number.isNaN(lng) ? lng : null,
        updatedAt: existingUpdatedAt || firebase.firestore.Timestamp.now()
    };
}

function toLegacyCustomer(stop) {
    const coordinate = (typeof stop.lat === 'number' && typeof stop.lng === 'number') ? `${stop.lat},${stop.lng}` : '';
    return {
        id: stop.id,
        Name: stop.name || '',
        customerId: stop.customerId || '',
        customerName: stop.customerName || '',
        label: stop.label || stop.name || '',
        siteCode: stop.siteCode || '',
        Address: stop.address || '',
        'Hp No': stop.phone || '',
        unit: stop.unit || '',
        postalCode: stop.postalCode || '',
        note: stop.note || '',
        lat: typeof stop.lat === 'number' ? stop.lat : null,
        lng: typeof stop.lng === 'number' ? stop.lng : null,
        coordinate,
        createdAt: stop.createdAt || null,
        updatedAt: stop.updatedAt || null
    };
}

function estimateStopsBytes(stopsArray) {
    try {
        return JSON.stringify(stopsArray || []).length;
    } catch (error) {
        return STOPS_DOC_SAFE_BYTES + 1;
    }
}

function compareStopsForImportDedupe(stopA, stopB) {
    const key = (s) => `${(s.name || '').trim().toLowerCase()}|${(s.phone || '').trim().toLowerCase()}|${(s.address || '').trim().toLowerCase()}`;
    return key(stopA) === key(stopB);
}

function normalizeFirestoreError(error, fallbackMessage = 'Firestore operation failed') {
    const rawCode = error && error.code ? String(error.code) : '';
    const code = rawCode.replace(/^firestore\//, '');
    const message = error && error.message ? String(error.message) : fallbackMessage;
    const displayMessage = code ? `${message} (${code})` : message;
    return { code, message, displayMessage };
}

function createFirestoreError(error, fallbackMessage) {
    const normalized = normalizeFirestoreError(error, fallbackMessage);
    const wrappedError = new Error(normalized.displayMessage);
    if (normalized.code) wrappedError.code = normalized.code;
    return wrappedError;
}

function toAccessExpiryDate(dateLike) {
    if (!dateLike) return null;
    const dateValue = dateLike && typeof dateLike.toDate === 'function'
        ? dateLike.toDate()
        : new Date(dateLike);
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return null;
    return dateValue;
}

function normalizeProductPlanKeyValue(rawPlanKey, fallback = '') {
    const candidate = String(rawPlanKey || '').trim().toLowerCase();
    if (!candidate) return fallback;
    if (['basic', 'free', 'starter', 'trial', 'free-trial', 'free trial'].includes(candidate)) return 'basic';
    if (['goplan', 'go', 'go-plan', 'go plan', 'go_plan'].includes(candidate)) return 'goplan';
    if (['proplan', 'pro', 'pro-plan', 'pro plan', 'pro_plan', 'professional', 'professional plan', 'team', 'business', 'enterprise'].includes(candidate)) return 'proplan';
    return fallback;
}

function resolveProductPlanKeyForProfile(profile = {}) {
    const productPlan = normalizeProductPlanKeyValue(profile.productPlanKey || profile.productPlan || profile.permanentPlanLabel, '');
    const legacyPlan = normalizeProductPlanKeyValue(profile.planKey || profile.planName, '');
    const legacyRaw = String(profile.planKey || profile.planName || '').trim().toLowerCase();
    const planStatus = String(profile.planStatus || '').trim().toLowerCase();

    if (legacyPlan === 'proplan' || productPlan === 'proplan') return 'proplan';
    if (legacyPlan === 'goplan' || productPlan === 'goplan') return 'goplan';
    if (productPlan === 'basic') return 'basic';
    if (legacyRaw === 'basic' && planStatus === 'active') return 'goplan';
    if (legacyPlan === 'basic') return 'basic';
    if (planStatus === 'active') return 'goplan';
    return 'basic';
}

function resolveAccessState({ user, profile, now } = {}) {
    if (typeof user === 'undefined') return 'loading';
    if (!user) return 'unauthenticated';
    if (typeof profile === 'undefined') return 'loading';

    // Billing expiry should downgrade feature limits, not block login or app entry.
    return 'active';
}

function sanitizeTrackingText(value, { maxLength = 120, fallback = '' } = {}) {
    if (value === undefined || value === null) return fallback;
    const cleanValue = String(value)
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .trim()
        .slice(0, maxLength);
    return cleanValue || fallback;
}

function sanitizeTrackingId(value, { maxLength = 80, fallback = '' } = {}) {
    if (value === undefined || value === null) return fallback;
    const cleanValue = String(value)
        .trim()
        .replace(/[^a-zA-Z0-9:_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, maxLength);
    return cleanValue || fallback;
}

function sanitizeTrackingStatus(value, fallback = 'active') {
    const normalized = sanitizeTrackingText(value, { maxLength: 24, fallback: '' }).toLowerCase();
    return TRACKING_STATUS_ALLOWLIST.has(normalized) ? normalized : fallback;
}

function sanitizeTrackingNetworkStatus(value, fallback = 'online') {
    const normalized = sanitizeTrackingText(value, { maxLength: 24, fallback: '' }).toLowerCase();
    return TRACKING_NETWORK_STATUS_ALLOWLIST.has(normalized) ? normalized : fallback;
}

function toIsoDateTime(value) {
    if (!value) return null;
    try {
        if (value && typeof value.toDate === 'function') {
            return value.toDate().toISOString();
        }
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    } catch (error) {
        return null;
    }
}

function buildSanitizedDriverTrackingSearch(searchParams) {
    const sanitizedParams = new URLSearchParams();
    if (!searchParams) return sanitizedParams.toString();

    for (const [key, rawValue] of searchParams.entries()) {
        if (!DRIVER_TRACKING_QUERY_ALLOWLIST.has(key)) continue;
        const sanitizedValue = (key === 'routeName' || key === 'driverName')
            ? sanitizeTrackingText(rawValue, { maxLength: 120, fallback: '' })
            : sanitizeTrackingId(rawValue, { maxLength: 80, fallback: '' });
        if (sanitizedValue) {
            sanitizedParams.set(key, sanitizedValue);
        }
    }

    return sanitizedParams.toString();
}

function sanitizeNextTarget(nextTarget) {
    const fallbackTarget = 'app.html';
    if (!nextTarget || typeof nextTarget !== 'string') return fallbackTarget;

    const trimmedTarget = nextTarget.trim();
    if (!trimmedTarget) return fallbackTarget;
    if (/^javascript:/i.test(trimmedTarget)) return fallbackTarget;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmedTarget)) return fallbackTarget;
    if (trimmedTarget.startsWith('//')) return fallbackTarget;

    let parsedTarget;
    try {
        parsedTarget = new URL(trimmedTarget, window.location.origin);
    } catch (error) {
        return fallbackTarget;
    }

    if (parsedTarget.origin !== window.location.origin) return fallbackTarget;

    const normalizedPath = parsedTarget.pathname.replace(/^\/+/, '');
    if (!APP_ENTRY_ALLOWLIST.has(normalizedPath)) {
        return fallbackTarget;
    }

    if (parsedTarget.search) {
        if (normalizedPath === 'dispatch.html') {
            const planId = parsedTarget.searchParams.get('planId');
            return planId && /^[A-Za-z0-9_-]{1,128}$/.test(planId)
                ? `dispatch.html?planId=${encodeURIComponent(planId)}`
                : 'dispatch.html';
        }
        if (normalizedPath !== 'driver-tracking.html') {
            return fallbackTarget;
        }
        const sanitizedSearch = buildSanitizedDriverTrackingSearch(parsedTarget.searchParams);
        return sanitizedSearch ? `${normalizedPath}?${sanitizedSearch}` : normalizedPath;
    }

    const rawHash = parsedTarget.hash.replace(/^#/, '');
    if (rawHash && !APP_PAGE_HASH_ALLOWLIST.has(rawHash)) {
        return normalizedPath;
    }

    return rawHash ? `${normalizedPath}#${rawHash}` : normalizedPath;
}

// Listen for auth state changes
function onAuthStateChange(callback) {
    if (auth) {
        return auth.onAuthStateChanged((user) => {
            if (user) window.GoRouteXTiming.mark('auth-ready');
            return callback(user);
        });
    }
    return null;
}

// Only server-issued managed Driver accounts use the Driver page.
function isDriverAccount(user) {
    return Boolean(user?.uid?.startsWith('drv_'));
}

// Returning accounts do one logical read. Snapshot metadata identifies cache fallback.
async function loadUserProfile(user, options = {}) {
    if (!db || !user?.uid) return { success: false, error: 'Auth not initialized' };
    try {
        const ref = db.collection('users').doc(user.uid);
        const read = options.source === 'server' ? ref.get({ source: 'server' }) : ref.get();
        let _t;
        const snapshot = await Promise.race([
            read,
            new Promise((_, reject) => { _t = setTimeout(() => reject(Object.assign(new Error('Account profile request timed out. Please retry.'), { code: 'profile-timeout' })), 15000); })
        ]).finally(() => clearTimeout(_t));
        if (!snapshot.exists) return { success: false, error: 'Account profile not found.', fromCache: !!snapshot.metadata?.fromCache };
        window.GoRouteXTiming.mark('profile-ready');
        return {
            success: true,
            profile: snapshot.data() || {},
            fromCache: !!snapshot.metadata?.fromCache,
            serverConfirmed: snapshot.metadata?.fromCache !== true
        };
    } catch (error) {
        return { success: false, error: error.message || 'Account profile unavailable.', code: error.code || 'unknown' };
    }
}

// Initial provisioning is deliberately separate from returning-user bootstrap.
async function ensureInitialProfileForNewAccount(user, preferredName = '') {
    if (!db || !user?.uid || isDriverAccount(user)) return { success: false, error: 'Workspace account unavailable.' };
    try {
        const ref = db.collection('users').doc(user.uid);
        const existing = await ref.get({ source: 'server' });
        if (existing.exists) return { success: true, profile: existing.data(), created: false };
        const profile = {
            name: preferredName || user.displayName || user.email?.split('@')[0] || '',
            email: user.email || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            trialEndsAt: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)),
            planStatus: 'trial',
            planName: 'trial',
            planKey: 'trial',
            productPlan: 'basic',
            productPlanKey: 'basic',
            role: 'admin',
            tenantId: user.uid,
            teamMembersCount: 1,
            billingStatus: 'basic'
        };
        if (!profile.name) return { success: false, error: 'Display name is required.' };
        await ref.set(profile, { merge: false });
        return { success: true, profile, created: true };
    } catch (error) {
        return { success: false, error: error.message || 'Could not create account profile.', code: error.code || 'unknown' };
    }
}

// Compatibility API for Driver pages; it never creates or rewrites a returning profile.
async function ensureUserProfile(user) {
    return loadUserProfile(user);
}

async function refreshLastLogin(user = getCurrentUser()) {
    if (!db || !user) {
        return { success: false, error: 'Not logged in' };
    }

    try {
        await db.collection('users').doc(user.uid).set({
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { success: true };
    } catch (error) {
        console.warn('Last login refresh failed:', error);
        return { success: false, error: error.message };
    }
}

async function getCurrentUserProfile() {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in', profile: null };
    }

    try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (!doc.exists) {
            return { success: false, error: 'Profile not found', profile: null };
        }
        return { success: true, profile: doc.data() };
    } catch (error) {
        console.error('Error loading user profile:', error);
        return { success: false, error: error.message, profile: null };
    }
}

async function activateProfessionalPlan(days = 30) {
    console.warn('Client-side Pro activation is disabled. Use verified backend/admin payment approval instead.');
    return {
        success: false,
        error: 'Client-side Pro activation is disabled. Use verified backend/admin payment approval instead.'
    };
}

// ============================================
// FIRESTORE DATA FUNCTIONS
// ============================================

function clearStopsWriteTimer() {
    if (_stopsWriteTimer) {
        clearTimeout(_stopsWriteTimer);
        _stopsWriteTimer = null;
    }
}

async function writeStopsToFirestore(uid) {
    if (!_stopsLoaded) return { success: false, error: 'Stops not loaded' };

    const stops = (_stopsMem || []).map(stop => normalizeStop(stop));
    const payloadBytes = estimateStopsBytes(stops);
    const cacheRef = getStopsCacheRef(uid);
    const chunksCollectionRef = getStopsChunksCollectionRef(uid);
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const updatedAt = new Date().toISOString();

    if (payloadBytes <= STOPS_DOC_SAFE_BYTES) {
        _stopsStorageMode = 'single';
        await cacheRef.set({
            version: STOPS_CACHE_VERSION,
            storageMode: 'single',
            updatedAt: now,
            totalStops: stops.length,
            stops
        }, { merge: true });

        // Best effort cleanup of chunks when returning to single mode.
        const chunkSnapshot = await chunksCollectionRef.get();
        if (!chunkSnapshot.empty) {
            const batch = db.batch();
            chunkSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
        }
        _stopsCacheUid = uid;
        console.log('stops saved', { count: stops.length, updatedAt, storageMode: 'single' });
        return { success: true, storageMode: 'single', totalStops: stops.length, updatedAt };
    }

    _stopsStorageMode = 'chunked';
    const chunks = [];
    let currentChunk = [];
    let currentBytes = 0;

    for (const stop of stops) {
        const stopBytes = JSON.stringify(stop).length;
        if (currentChunk.length > 0 && (currentBytes + stopBytes) > STOPS_CHUNK_TARGET_BYTES) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentBytes = 0;
        }
        currentChunk.push(stop);
        currentBytes += stopBytes;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    await cacheRef.set({
        version: STOPS_CACHE_VERSION,
        storageMode: 'chunked',
        updatedAt: now,
        chunkCount: chunks.length,
        totalStops: stops.length
    }, { merge: true });

    const batch = db.batch();
    const existingSnapshot = await chunksCollectionRef.get();
    existingSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    chunks.forEach((chunkStops, index) => {
        const docRef = chunksCollectionRef.doc(`chunk_${String(index).padStart(6, '0')}`);
        batch.set(docRef, {
            index,
            version: STOPS_CACHE_VERSION,
            updatedAt: now,
            stops: chunkStops
        }, { merge: true });
    });
    await batch.commit();

    _stopsCacheUid = uid;
    console.log('stops saved', { count: stops.length, updatedAt, storageMode: 'chunked' });
    return { success: true, storageMode: 'chunked', totalStops: stops.length, chunkCount: chunks.length, updatedAt };
}

function markStopsDirty() {
    _stopsPendingWrite = true;
    _stopsDirtyGen += 1;
}

function startStopsWrite(uid) {
    if (_stopsFlushPromise) {
        // Serialize writes: once the in-flight write settles, write again only if newer changes arrived.
        return _stopsFlushPromise.then((result) => (_stopsPendingWrite ? startStopsWrite(uid) : result));
    }
    _stopsPendingWrite = true;
    const writeGen = _stopsDirtyGen;
    const writePromise = writeStopsToFirestore(uid)
        .catch((error) => {
            const normalized = normalizeFirestoreError(error, 'Failed to save stops');
            return { success: false, error: normalized.displayMessage, code: normalized.code || null };
        })
        .finally(() => {
            if (_stopsDirtyGen === writeGen) {
                _stopsPendingWrite = false;
            }
            if (_stopsFlushPromise === writePromise) {
                _stopsFlushPromise = null;
            }
        });
    _stopsFlushPromise = writePromise;
    return writePromise;
}

function scheduleStopsWrite(uid) {
    markStopsDirty();
    clearStopsWriteTimer();
    _stopsWriteTimer = setTimeout(async () => {
        clearStopsWriteTimer();
        await startStopsWrite(uid);
    }, STOPS_WRITE_DEBOUNCE_MS);
}

async function flushStopsCacheWrites() {
    const user = getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };

    if (_stopsWriteTimer) {
        clearStopsWriteTimer();
        return startStopsWrite(user.uid);
    }

    if (_stopsFlushPromise || _stopsPendingWrite) {
        return startStopsWrite(user.uid);
    }

    return { success: true, storageMode: _stopsStorageMode, totalStops: _stopsMem.length };
}

async function loadStopsCache(options = {}) {
    const user = getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in', stops: [] };
    if (_stopsCacheUid && _stopsCacheUid !== user.uid) {
        _stopsMem = [];
        _stopsLoaded = false;
        _stopsStorageMode = 'single';
        _stopsCacheUid = null;
        clearStopsWriteTimer();
        _stopsPendingWrite = false;
        _stopsFlushPromise = null;
    }
    const forceReload = !!options.forceReload;
    const serverFirst = options.serverFirst !== false;
    const allowCacheFallback = options.allowCacheFallback !== false;
    const limitCount = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
        ? Math.floor(Number(options.limit))
        : null;
    const buildStopsLoadResult = (stops, extra = {}) => ({
        success: true,
        stops: limitCount ? stops.slice(0, limitCount) : [...stops],
        storageMode: _stopsStorageMode,
        limit: limitCount,
        hasMore: Boolean(limitCount && stops.length > limitCount),
        ...extra
    });
    if (_stopsLoaded && !forceReload) {
        return buildStopsLoadResult(_stopsMem);
    }

    const previousStops = [..._stopsMem];
    const previousLoaded = _stopsLoaded;
    const previousStorageMode = _stopsStorageMode;
    const previousCacheUid = _stopsCacheUid;

    const hasUsableSnapshotData = (snapshot) => {
        if (!snapshot) return false;
        if (typeof snapshot.exists === 'boolean') {
            return snapshot.exists;
        }
        if (typeof snapshot.empty === 'boolean') {
            return !snapshot.empty;
        }
        return false;
    };

    const readSnapshot = async (ref, label) => {
        if (!serverFirst) {
            try {
                const cachedSnapshot = await ref.get({ source: 'cache' });
                if (hasUsableSnapshotData(cachedSnapshot)) {
                    return { snapshot: cachedSnapshot, source: 'cache', warning: null };
                }
            } catch (_cacheWarmupError) {
                // Fall back to a server read when cache is not ready yet.
            }

            try {
                const snapshot = await ref.get({ source: 'server' });
                return { snapshot, source: 'server', warning: null };
            } catch (serverError) {
                if (!allowCacheFallback) {
                    throw createFirestoreError(serverError, `Failed to load ${label} from Firestore`);
                }
                const normalized = normalizeFirestoreError(serverError, `Failed to load ${label} from Firestore`);
                try {
                    const cachedSnapshot = await ref.get({ source: 'cache' });
                    return {
                        snapshot: cachedSnapshot,
                        source: 'cache',
                        warning: `Cloud read failed (${normalized.code || 'unknown'}). Loaded cached ${label}.`
                    };
                } catch (_cacheError) {
                    throw createFirestoreError(serverError, `Failed to load ${label} from Firestore`);
                }
            }
        }

        try {
            const snapshot = await ref.get({ source: 'server' });
            return { snapshot, source: 'server', warning: null };
        } catch (serverError) {
            if (!allowCacheFallback) {
                throw createFirestoreError(serverError, `Failed to load ${label} from Firestore`);
            }
            const normalized = normalizeFirestoreError(serverError, `Failed to load ${label} from Firestore`);
            try {
                const cachedSnapshot = await ref.get({ source: 'cache' });
                return {
                    snapshot: cachedSnapshot,
                    source: 'cache',
                    warning: `Cloud read failed (${normalized.code || 'unknown'}). Loaded cached ${label}.`
                };
            } catch (_cacheError) {
                throw createFirestoreError(serverError, `Failed to load ${label} from Firestore`);
            }
        }
    };

    try {
        const warnings = [];
        const cacheRead = await readSnapshot(getStopsCacheRef(user.uid), 'stops');
        if (cacheRead.warning) warnings.push(cacheRead.warning);
        const cacheDoc = cacheRead.snapshot;
        let sourceTag = cacheRead.source;

        if (!cacheDoc.exists) {
            if (cacheRead.source === 'cache') {
                throw createFirestoreError(
                    { code: 'unavailable', message: 'Cloud read failed and no cached stops are available yet.' },
                    'Failed to load stops from Firestore'
                );
            }
            _stopsMem = [];
            _stopsLoaded = true;
            _stopsStorageMode = 'single';
            _stopsCacheUid = user.uid;
            console.log('stops loaded', { count: 0, storageMode: 'single' });
            return buildStopsLoadResult([], { storageMode: 'single', source: sourceTag });
        }

        const data = cacheDoc.data() || {};
        const storageMode = data.storageMode || 'single';
        _stopsStorageMode = storageMode;
        let stops = [];

        if (storageMode === 'chunked') {
            const chunkQuery = limitCount
                ? getStopsChunksCollectionRef(user.uid)
                    .orderBy('index', 'asc')
                    .limit(Math.max(1, Math.ceil(limitCount / 50)))
                : getStopsChunksCollectionRef(user.uid).orderBy('index', 'asc');
            const chunksRead = await readSnapshot(
                chunkQuery,
                'stops chunks'
            );
            if (chunksRead.warning) warnings.push(chunksRead.warning);
            const chunkSnapshot = chunksRead.snapshot;
            sourceTag = (sourceTag === chunksRead.source) ? sourceTag : `${sourceTag}+${chunksRead.source}`;
            const orderedChunks = chunkSnapshot.docs
                .map((doc) => doc.data() || {})
                .filter((chunk) => Array.isArray(chunk.stops) && typeof chunk.index === 'number')
                .sort((a, b) => a.index - b.index);
            orderedChunks.forEach((chunk) => {
                chunk.stops.forEach((s) => {
                    if (!limitCount || stops.length < limitCount) {
                        stops.push(normalizeStop(s));
                    }
                });
            });
        } else {
            const sourceStops = Array.isArray(data.stops) ? data.stops : [];
            stops = sourceStops.map((s) => normalizeStop(s));
        }

        if (
            sourceTag.includes('cache') &&
            previousLoaded &&
            previousStops.length > 0 &&
            stops.length === 0
        ) {
            throw createFirestoreError(
                { code: 'unavailable', message: 'Cached stops are empty while cloud read is unavailable. Preserving local stops.' },
                'Failed to load stops from Firestore'
            );
        }

        _stopsMem = stops;
        _stopsLoaded = true;
        _stopsCacheUid = user.uid;
        const result = buildStopsLoadResult(_stopsMem, { storageMode, source: sourceTag });
        if (warnings.length > 0) result.warning = warnings.join(' ');
        console.log('stops loaded', { count: _stopsMem.length, storageMode });
        return result;
    } catch (error) {
        _stopsMem = previousStops;
        _stopsLoaded = previousLoaded;
        _stopsStorageMode = previousStorageMode;
        _stopsCacheUid = previousCacheUid;
        const normalized = normalizeFirestoreError(error, 'Failed to load stops cache');
        console.error('Error loading stops cache:', error);
        return {
            success: false,
            error: normalized.displayMessage,
            code: normalized.code || null,
            stops: previousLoaded
                ? (limitCount ? previousStops.slice(0, limitCount) : [...previousStops])
                : [],
            limit: limitCount,
            hasMore: Boolean(previousLoaded && limitCount && previousStops.length > limitCount),
            preservedLocalState: previousLoaded
        };
    }
}

async function saveStopsCache(stopsArray, options = {}) {
    const user = getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in', stops: [] };
    const immediate = !!options.immediate;

    _stopsMem = (Array.isArray(stopsArray) ? stopsArray : []).map((stop) => normalizeStop(stop));
    _stopsLoaded = true;
    _stopsCacheUid = user.uid;

    if (immediate) {
        markStopsDirty();
        return flushStopsCacheWrites();
    }

    scheduleStopsWrite(user.uid);
    return { success: true, queued: true, totalStops: _stopsMem.length };
}

async function addStop(stopObject, options = {}) {
    const current = await loadStopsCache();
    if (!current.success) return current;
    const incoming = normalizeStop(stopObject || {});
    if (!incoming.name || !incoming.address) {
        return { success: false, error: 'Stop must include name and address' };
    }

    const existing = _stopsMem.find((s) => compareStopsForImportDedupe(s, incoming));
    if (existing) {
        return { success: true, id: existing.id, duplicate: true };
    }

    _stopsMem.push(incoming);
    return saveStopsCache(_stopsMem, options).then((result) => ({ ...result, id: incoming.id }));
}

async function updateStop(stopId, changes, options = {}) {
    const current = await loadStopsCache();
    if (!current.success) return current;
    const index = _stopsMem.findIndex((s) => s.id === stopId);
    if (index < 0) return { success: false, error: 'Stop not found' };

    const merged = normalizeStop({ ..._stopsMem[index], ...(changes || {}), id: stopId });
    _stopsMem[index] = merged;
    return saveStopsCache(_stopsMem, options).then((result) => ({ ...result, id: stopId }));
}

async function deleteStop(stopId, options = {}) {
    const current = await loadStopsCache();
    if (!current.success) return current;
    const before = _stopsMem.length;
    _stopsMem = _stopsMem.filter((s) => s.id !== stopId);
    if (_stopsMem.length === before) return { success: false, error: 'Stop not found' };
    return saveStopsCache(_stopsMem, options);
}

async function clearStopsCache() {
    const user = getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    _stopsMem = [];
    _stopsLoaded = true;
    _stopsStorageMode = 'single';
    markStopsDirty();
    return flushStopsCacheWrites();
}

async function backfillLegacyRoutes(uid) {
    if (_historyBackfillUid === uid) return { success: true, migrated: 0 };
    _historyBackfillUid = uid;

    try {
        const historySnapshot = await getHistoryCollectionRef(uid).get();
        const existingIds = new Set(historySnapshot.docs.map((doc) => doc.id));
        const legacySnapshot = await getLegacyRoutesCollectionRef(uid).get();

        if (legacySnapshot.empty) {
            return { success: true, migrated: 0 };
        }

        const batch = db.batch();
        let migrated = 0;
        legacySnapshot.forEach((legacyDoc) => {
            if (existingIds.has(legacyDoc.id)) return;
            const data = legacyDoc.data() || {};
            batch.set(getHistoryCollectionRef(uid).doc(legacyDoc.id), {
                ...data,
                id: legacyDoc.id,
                createdAt: data.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: data.updatedAt || firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            migrated++;
        });

        if (migrated > 0) await batch.commit();
        return { success: true, migrated };
    } catch (error) {
        console.warn('Legacy routes backfill skipped:', error.message);
        return { success: false, error: error.message, migrated: 0 };
    }
}

// Diagnostics: how long the history query took, how many documents it returned and roughly how big they
// are. Large documents (full route/directions data) are the suspected cause of slow history loads.
function diagnosticClock() {
    try { return performance.now(); } catch (_) { return 0; }
}

function noteHistoryQuery(snapshot, queryMs) {
    try {
        if (!globalThis.GoRouteXTiming || globalThis.GoRouteXTiming.notes['history-query-ms'] !== undefined) return;
        let bytes = 0;
        snapshot.docs.forEach((doc) => { bytes += JSON.stringify(doc.data()).length; });
        globalThis.GoRouteXTiming.note('history-query-ms', queryMs);
        globalThis.GoRouteXTiming.note('history-docs', snapshot.docs.length);
        globalThis.GoRouteXTiming.note('history-approx-KB', Math.round(bytes / 1024));
    } catch (_) {}
}

async function loadHistoryWithFallback(uid, limit = HISTORY_LOAD_LIMIT, options = {}) {
    const collectionRef = getHistoryCollectionRef(uid);
    const pageSize = Math.max(1, Math.min(Number(limit) || HISTORY_LOAD_LIMIT, 50));
    const cursorKey = uid;
    const useCursor = options.loadMore === true;
    const previousCursor = useCursor ? _historyPageCursors.get(cursorKey) : null;
    const applyCursor = (query) => previousCursor ? query.startAfter(previousCursor) : query;
    let createdAtFailure = null;
    let updatedAtFailure = null;
    // On the first page, probe for any history document in parallel with the main query. If both are
    // empty the collection is empty, so we can stop after one round trip instead of three sequential
    // fallback queries (the slow "Loading saved route history" case for new accounts). Costs at most
    // one extra document read.
    const emptyProbe = useCursor ? null : collectionRef.limit(1).get().catch(() => null);
    try {
        const queryStartedAt = diagnosticClock();
        const snapshot = await applyCursor(collectionRef.orderBy('createdAt', 'desc')).limit(pageSize).get();
        noteHistoryQuery(snapshot, Math.round(diagnosticClock() - queryStartedAt));
        if (!snapshot.empty) {
            _historyPageCursors.set(cursorKey, snapshot.docs[snapshot.docs.length - 1]);
            return { success: true, snapshot, hasMore: snapshot.docs.length === pageSize };
        }
        if (useCursor) {
            return { success: true, snapshot, hasMore: false };
        }
        if (!useCursor) _historyPageCursors.delete(cursorKey);
        const probe = await emptyProbe;
        if (probe && probe.empty) {
            return { success: true, snapshot, hasMore: false };
        }
    } catch (createdAtError) {
        createdAtFailure = createdAtError;
        console.warn('History createdAt order failed, trying updatedAt:', createdAtError.message);
    }

    try {
        const snapshot = await applyCursor(collectionRef.orderBy('updatedAt', 'desc')).limit(pageSize).get();
        if (!snapshot.empty) {
            _historyPageCursors.set(cursorKey, snapshot.docs[snapshot.docs.length - 1]);
            return { success: true, snapshot, hasMore: snapshot.docs.length === pageSize };
        }
        if (useCursor) {
            return { success: true, snapshot, hasMore: false };
        }
        if (!useCursor) _historyPageCursors.delete(cursorKey);
    } catch (updatedAtError) {
        updatedAtFailure = updatedAtError;
        console.warn('History updatedAt order failed, falling back unordered:', updatedAtError.message);
    }

    try {
        const snapshot = await collectionRef.limit(pageSize).get();
        return { success: true, snapshot, unorderedFallback: true, hasMore: snapshot.docs.length === pageSize };
    } catch (unorderedError) {
        return {
            success: false,
            error: unorderedError.message || 'History query failed',
            createdAtError: createdAtFailure ? createdAtFailure.message : null,
            updatedAtError: updatedAtFailure ? updatedAtFailure.message : null
        };
    }
}

function serializeAddressNameMap(addressNameMap) {
    if (!addressNameMap || typeof addressNameMap !== 'object' || Array.isArray(addressNameMap)) {
        return [];
    }

    return Object.entries(addressNameMap)
        .filter(([key]) => key !== undefined && key !== null)
        .map(([key, value]) => ({
            key: String(key),
            value: value === undefined || value === null ? '' : String(value)
        }));
}

function hydrateAddressNameMap(addressNameMap, addressNameEntries) {
    const hydratedMap = {};

    if (addressNameMap && typeof addressNameMap === 'object' && !Array.isArray(addressNameMap)) {
        Object.entries(addressNameMap).forEach(([key, value]) => {
            hydratedMap[String(key)] = value === undefined || value === null ? '' : String(value);
        });
    }

    if (Array.isArray(addressNameEntries)) {
        addressNameEntries.forEach((entry) => {
            if (!entry || entry.key === undefined || entry.key === null) return;
            hydratedMap[String(entry.key)] = entry.value === undefined || entry.value === null
                ? ''
                : String(entry.value);
        });
    }

    return hydratedMap;
}

function mapHistorySnapshot(snapshot) {
    const routes = [];
    snapshot.forEach((doc) => {
        const data = doc.data() || {};
        const restoredAddressNameMap = hydrateAddressNameMap(data.addressNameMap, data.addressNameEntries);
        const createdAtDate = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
        const updatedAtDate = data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate() : null;
        routes.push({
            id: doc.id,
            ...data,
            addressNameMap: restoredAddressNameMap,
            timestamp: data.timestamp || (createdAtDate ? createdAtDate.toISOString() : (updatedAtDate ? updatedAtDate.toISOString() : ''))
        });
    });

    routes.sort((a, b) => {
        const parseValue = (value) => {
            if (!value) return 0;
            if (typeof value === 'string') {
                const ms = Date.parse(value);
                return Number.isNaN(ms) ? 0 : ms;
            }
            if (value.toDate) {
                const date = value.toDate();
                return date instanceof Date ? date.getTime() : 0;
            }
            if (value instanceof Date) return value.getTime();
            return 0;
        };
        const aMs = parseValue(a.timestamp) || parseValue(a.updatedAt) || parseValue(a.createdAt);
        const bMs = parseValue(b.timestamp) || parseValue(b.updatedAt) || parseValue(b.createdAt);
        return bMs - aMs;
    });

    return routes;
}

async function saveHistoryBundle(routeData) {
    const user = getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };

    try {
        const routeId = routeData.id ? String(routeData.id) : Date.now().toString();
        const addressNameEntries = serializeAddressNameMap(routeData.addressNameMap);
        const historyRef = getHistoryCollectionRef(user.uid).doc(routeId);
        const plannedRouteRef = getPlannedRoutesCollectionRef(user.uid).doc(routeId);
        const snapshotRef = getOperationSnapshotsCollectionRef(user.uid).doc(routeId);

        const historyPayload = {
            ...routeData,
            id: routeId,
            addressNameEntries,
            createdAt: routeData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        delete historyPayload.addressNameMap;

        const plannedPayload = {
            id: routeId,
            plannedRoutes: routeData.plannedRoutes || [],
            addressNameEntries,
            origin: routeData.origin || '',
            date: routeData.date || routeData.planningDate || '',
            startTime: routeData.startTime || routeData.routeStartTime || '',
            driverId: routeData.driverId || routeData.vehicleDriver || routeData.driverName || '',
            timestamp: routeData.timestamp || new Date().toISOString(),
            createdAt: routeData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const snapshotPayload = {
            id: routeId,
            routeName: routeData.routeName || '',
            totalStops: routeData.totalStops || 0,
            successfulRoutesCount: routeData.successfulRoutesCount || 0,
            originName: routeData.originName || '',
            timestamp: routeData.timestamp || new Date().toISOString(),
            createdAt: routeData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await Promise.all([
            historyRef.set(historyPayload, { merge: true }),
            plannedRouteRef.set(plannedPayload, { merge: true }),
            snapshotRef.set(snapshotPayload, { merge: true })
        ]);

        return { success: true, id: routeId };
    } catch (error) {
        console.error('Error saving route bundle:', error);
        return { success: false, error: error.message };
    }
}

// Save route history to Firestore
async function saveRouteToCloud(routeData) {
    return saveHistoryBundle(routeData);
}

// Load one page of route history from Firestore
async function loadRoutesFromCloud(options = {}) {
    const user = getCurrentUser();
    if (!user) {
        console.warn('No user logged in');
        return { success: false, routes: [] };
    }

    try {
        const pageSize = Math.max(1, Math.min(Number(options.limit || options.pageSize) || HISTORY_LOAD_LIMIT, 50));
        const queryResult = await loadHistoryWithFallback(user.uid, pageSize, {
            loadMore: options.loadMore === true
        });
        if (!queryResult.success) {
            return { success: false, routes: [], error: queryResult.error || 'History load failed' };
        }
        const routes = mapHistorySnapshot(queryResult.snapshot);
        return {
            success: true,
            routes,
            hasMore: !!queryResult.hasMore,
            pageSize,
            source: 'cloud'
        };
    } catch (error) {
        console.error('Error loading routes from cloud:', error);
        return { success: false, routes: [], error: error.message };
    }
}

// Read exactly one finalized plan instead of hydrating a history page.
async function loadPlanFromCloud(planId) {
    const user = getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(planId || ''))) return { success: false, error: 'Invalid route plan ID' };
    try {
        const doc = await getHistoryCollectionRef(user.uid).doc(String(planId)).get();
        if (!doc.exists) return { success: true, plan: null, source: 'cloud' };
        return { success: true, plan: mapHistorySnapshot({ forEach: callback => callback(doc) })[0] || null, source: 'cloud' };
    } catch (error) { return { success: false, error: error.message }; }
}

async function loadLatestFinalizedPlanFromCloud() {
    const user = getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const history = getHistoryCollectionRef(user.uid);
    try {
        // New finalized plans are explicitly versioned; legacy fallback is bounded.
        const current = await history.orderBy('finalizedAt', 'desc').limit(1).get();
        if (!current.empty) return { success: true, plan: mapHistorySnapshot(current)[0], source: 'cloud' };
        const legacy = await history.orderBy('createdAt', 'desc').limit(5).get();
        const plan = mapHistorySnapshot(legacy).find(item => (item.plannedRoutes || []).some(route => Array.isArray(route?.customerStops))) || null;
        return { success: true, plan, source: 'cloud-legacy' };
    } catch (error) { return { success: false, error: error.message }; }
}

// Delete route from Firestore
async function deleteRouteFromCloud(routeId) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    try {
        await getHistoryCollectionRef(user.uid).doc(routeId).delete();
        await getPlannedRoutesCollectionRef(user.uid).doc(routeId).delete().catch(() => {});
        await getOperationSnapshotsCollectionRef(user.uid).doc(routeId).delete().catch(() => {});
        return { success: true };
    } catch (error) {
        console.error('Error deleting route from cloud:', error);
        return { success: false, error: error.message };
    }
}

// Save current session (selected stops, etc.) to Firestore
async function saveSessionToCloud(sessionData) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    try {
        await getUserDocRef(user.uid).collection('sessions').doc('current').set({
            ...sessionData,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        console.error('Error saving session to cloud:', error);
        return { success: false, error: error.message };
    }
}

// Load current session from Firestore
async function loadSelectionSessionFromCloud() {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, session: null };
    }

    try {
        const doc = await getUserDocRef(user.uid).collection('sessions').doc('current').get();
        if (doc.exists) {
            return { success: true, session: doc.data() };
        }
        return { success: true, session: null };
    } catch (error) {
        console.error('Error loading session from cloud:', error);
        return { success: false, session: null, error: error.message };
    }
}

function normalizeVehicleDriverItems(items) {
    const normalized = (Array.isArray(items) ? items : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
        .slice(0, 50);
    return normalized.length > 0 ? normalized : ['YQ3896B'];
}

async function loadVehicleDrivers() {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, settings: null, error: 'Not logged in' };
    }

    try {
        const doc = await getSettingsDocRef(user.uid, 'vehicleDrivers').get();
        if (!doc.exists) {
            return { success: true, settings: null };
        }
        const data = doc.data() || {};
        const items = normalizeVehicleDriverItems(data.items);
        const selected = items.includes(data.selected) ? data.selected : items[0];
        return {
            success: true,
            settings: {
                items,
                selected,
                updatedAt: data.updatedAt || null,
                localUpdatedAt: data.localUpdatedAt || null
            }
        };
    } catch (error) {
        console.error('Error loading vehicle / driver settings:', error);
        return { success: false, settings: null, error: error.message };
    }
}

async function saveVehicleDrivers(settingsData = {}) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    try {
        const items = normalizeVehicleDriverItems(settingsData.items);
        const selected = items.includes(settingsData.selected) ? settingsData.selected : items[0];
        await getSettingsDocRef(user.uid, 'vehicleDrivers').set({
            items,
            selected,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            localUpdatedAt: new Date().toISOString()
        }, { merge: true });
        return { success: true, settings: { items, selected } };
    } catch (error) {
        console.error('Error saving vehicle / driver settings:', error);
        return { success: false, error: error.message };
    }
}

// One-shot route subscription wrapper (no realtime listeners)
function subscribeToRoutes(callback) {
    let isCancelled = false;
    loadRoutesFromCloud()
        .then((result) => {
            if (!isCancelled && result.success && typeof callback === 'function') callback(result.routes || []);
        })
        .catch((error) => console.warn('subscribeToRoutes one-shot load failed:', error));
    return () => { isCancelled = true; };
}

// ============================================
// GPS TRACKING FUNCTIONS
// ============================================

// Get today's date key for GPS tracking
function getTodayKey() {
    const today = new Date();
    return today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
}

// Save GPS location point
async function saveGPSPoint(locationData) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    try {
        const todayKey = getTodayKey();
        const trackingRef = db.collection('users').doc(user.uid)
            .collection('gpsTracking').doc(todayKey)
            .collection('points').doc();

        const pointData = {
            lat: locationData.lat,
            lng: locationData.lng,
            accuracy: locationData.accuracy || null,
            speed: locationData.speed || null,
            heading: locationData.heading || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            localTime: new Date().toISOString()
        };

        await trackingRef.set(pointData);
        return { success: true, id: trackingRef.id };
    } catch (error) {
        console.error('Error saving GPS point:', error);
        return { success: false, error: error.message };
    }
}

// Update today's tracking summary
async function updateTrackingSummary(summaryData) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    try {
        const todayKey = getTodayKey();
        const summaryRef = db.collection('users').doc(user.uid)
            .collection('gpsTracking').doc(todayKey);

        await summaryRef.set({
            date: todayKey,
            ...summaryData,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return { success: true };
    } catch (error) {
        console.error('Error updating tracking summary:', error);
        return { success: false, error: error.message };
    }
}

// Load today's GPS tracking points
async function loadTodayGPSPoints() {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, points: [] };
    }

    try {
        const todayKey = getTodayKey();
        const snapshot = await db.collection('users').doc(user.uid)
            .collection('gpsTracking').doc(todayKey)
            .collection('points')
            .orderBy('timestamp', 'asc')
            .get();

        const points = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            points.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : data.localTime
            });
        });

        return { success: true, points: points };
    } catch (error) {
        console.error('Error loading GPS points:', error);
        return { success: false, points: [], error: error.message };
    }
}

// Load tracking summary for a date
async function loadTrackingSummary(dateKey = null) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, summary: null };
    }

    try {
        const key = dateKey || getTodayKey();
        const doc = await db.collection('users').doc(user.uid)
            .collection('gpsTracking').doc(key).get();

        if (doc.exists) {
            return { success: true, summary: doc.data() };
        }
        return { success: true, summary: null };
    } catch (error) {
        console.error('Error loading tracking summary:', error);
        return { success: false, summary: null, error: error.message };
    }
}

// One-shot GPS update loader (no realtime listeners)
function subscribeToGPSUpdates(callback) {
    let isCancelled = false;
    loadTodayGPSPoints()
        .then((result) => {
            if (!isCancelled && result.success && typeof callback === 'function') callback(result.points || []);
        })
        .catch((error) => console.warn('subscribeToGPSUpdates one-shot load failed:', error));
    return () => { isCancelled = true; };
}

// ============================================
// DEDICATED DRIVER TRACKING FUNCTIONS
// ============================================
// These collections intentionally live under the signed-in user's namespace so
// the dedicated driver tracking module can ship without changing the current
// single-account Firestore security model. Future dispatcher views can read the
// same collections inside the account and layer team-level access later.

function createDriverTrackingSessionId() {
    return `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDriverTrackingContext(user, rawContext = {}) {
    const fallbackName = sanitizeTrackingText(
        rawContext.driverName
        || rawContext.name
        || user?.displayName
        || user?.email?.split('@')[0]
        || 'Driver',
        { maxLength: 120, fallback: 'Driver' }
    );
    const driverId = sanitizeTrackingId(
        rawContext.driverId || rawContext.driverUid || user?.uid,
        { maxLength: 80, fallback: user?.uid || 'driver' }
    );

    return {
        driverId,
        driverName: fallbackName,
        routeId: sanitizeTrackingId(rawContext.routeId, { maxLength: 80, fallback: '' }) || null,
        routeName: sanitizeTrackingText(rawContext.routeName, { maxLength: 120, fallback: '' }) || null,
        sessionId: sanitizeTrackingId(rawContext.sessionId, { maxLength: 80, fallback: '' }) || null
    };
}

function mapTrackingSessionDoc(doc) {
    if (!doc || !doc.exists) return null;
    const data = doc.data() || {};
    return {
        id: doc.id,
        ...data,
        createdAt: toIsoDateTime(data.createdAt),
        updatedAt: toIsoDateTime(data.updatedAt),
        startedAt: toIsoDateTime(data.startedAt),
        endedAt: toIsoDateTime(data.endedAt),
        pausedAt: toIsoDateTime(data.pausedAt),
        resumedAt: toIsoDateTime(data.resumedAt),
        lastHeartbeatAt: toIsoDateTime(data.lastHeartbeatAt),
        lastUploadedClientAt: toIsoDateTime(data.lastUploadedClientAt) || data.lastUploadedClientAt || null
    };
}

function mapTrackingPointDoc(doc) {
    if (!doc || !doc.exists) return null;
    const data = doc.data() || {};
    return {
        id: doc.id,
        ...data,
        uploadedAt: toIsoDateTime(data.uploadedAt),
        recordedAt: toIsoDateTime(data.recordedAt) || data.recordedAt || null
    };
}

function mapDriverLiveDoc(doc) {
    if (!doc || !doc.exists) return null;
    const data = doc.data() || {};
    return {
        id: doc.id,
        ...data,
        startedAt: toIsoDateTime(data.startedAt),
        endedAt: toIsoDateTime(data.endedAt),
        lastUpdatedAt: toIsoDateTime(data.lastUpdatedAt),
        lastUploadedClientAt: toIsoDateTime(data.lastUploadedClientAt) || data.lastUploadedClientAt || null
    };
}

async function startDriverTrackingSession(sessionData = {}) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    try {
        const context = buildDriverTrackingContext(user, sessionData);
        const sessionId = context.sessionId || createDriverTrackingSessionId();
        const sessionRef = getTrackingSessionsCollectionRef(user.uid).doc(sessionId);
        const liveRef = getDriverLiveCollectionRef(user.uid).doc(context.driverId);
        const existingSnap = await sessionRef.get();
        const existingData = existingSnap.exists ? (existingSnap.data() || {}) : {};
        const now = firebase.firestore.FieldValue.serverTimestamp();
        const clientNow = new Date().toISOString();
        const status = sanitizeTrackingStatus(sessionData.status, 'active');
        const networkStatus = sanitizeTrackingNetworkStatus(sessionData.networkStatus, 'online');
        const lat = typeof sessionData.lat === 'number' ? sessionData.lat : (typeof existingData.lastKnownLat === 'number' ? existingData.lastKnownLat : null);
        const lng = typeof sessionData.lng === 'number' ? sessionData.lng : (typeof existingData.lastKnownLng === 'number' ? existingData.lastKnownLng : null);

        const sessionPayload = {
            sessionId,
            driverId: context.driverId,
            driverName: context.driverName,
            routeId: context.routeId,
            routeName: context.routeName,
            status,
            source: DRIVER_TRACKING_SOURCE,
            ownerUid: user.uid,
            createdAt: existingData.createdAt || now,
            startedAt: existingData.startedAt || now,
            updatedAt: now,
            lastHeartbeatAt: now,
            lastUploadedClientAt: clientNow,
            pointCount: Number.isFinite(Number(existingData.pointCount)) ? Number(existingData.pointCount) : 0,
            lastKnownLat: lat,
            lastKnownLng: lng,
            lastAccuracy: typeof sessionData.accuracy === 'number' ? sessionData.accuracy : (existingData.lastAccuracy ?? null),
            lastSpeed: typeof sessionData.speed === 'number' ? sessionData.speed : (existingData.lastSpeed ?? null),
            lastHeading: typeof sessionData.heading === 'number' ? sessionData.heading : (existingData.lastHeading ?? null),
            networkStatus,
            sessionVersion: 1,
            staleAfterMs: 90000,
            uploadStrategy: {
                distanceThresholdMeters: 35,
                timeThresholdSeconds: 25
            }
        };

        const livePayload = {
            driverId: context.driverId,
            driverName: context.driverName,
            routeId: context.routeId,
            routeName: context.routeName,
            trackingSessionId: sessionId,
            status,
            source: DRIVER_TRACKING_SOURCE,
            ownerUid: user.uid,
            lastUpdatedAt: now,
            lastUploadedClientAt: clientNow,
            startedAt: existingData.startedAt || now,
            endedAt: status === 'stopped' ? now : null,
            networkStatus,
            staleAfterMs: 90000,
            lat,
            lng,
            accuracy: typeof sessionData.accuracy === 'number' ? sessionData.accuracy : null,
            speed: typeof sessionData.speed === 'number' ? sessionData.speed : null,
            heading: typeof sessionData.heading === 'number' ? sessionData.heading : null
        };

        await Promise.all([
            sessionRef.set(sessionPayload, { merge: true }),
            liveRef.set(livePayload, { merge: true })
        ]);

        return {
            success: true,
            sessionId,
            session: {
                ...context,
                sessionId,
                status,
                lastUploadedClientAt: clientNow
            }
        };
    } catch (error) {
        console.error('Error starting driver tracking session:', error);
        return { success: false, error: error.message };
    }
}

async function updateDriverTrackingSession(sessionId, updateData = {}) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    const cleanSessionId = sanitizeTrackingId(sessionId, { maxLength: 80, fallback: '' });
    if (!cleanSessionId) {
        return { success: false, error: 'Session ID is required' };
    }

    try {
        const context = buildDriverTrackingContext(user, { ...updateData, sessionId: cleanSessionId });
        const sessionRef = getTrackingSessionsCollectionRef(user.uid).doc(cleanSessionId);
        const liveRef = getDriverLiveCollectionRef(user.uid).doc(context.driverId);
        const now = firebase.firestore.FieldValue.serverTimestamp();
        const clientNow = new Date().toISOString();
        const status = sanitizeTrackingStatus(updateData.status, 'active');
        const networkStatus = sanitizeTrackingNetworkStatus(updateData.networkStatus, 'online');

        const sessionPayload = {
            sessionId: cleanSessionId,
            driverId: context.driverId,
            driverName: context.driverName,
            routeId: context.routeId,
            routeName: context.routeName,
            status,
            source: DRIVER_TRACKING_SOURCE,
            ownerUid: user.uid,
            updatedAt: now,
            lastHeartbeatAt: now,
            lastUploadedClientAt: clientNow,
            networkStatus
        };

        const livePayload = {
            driverId: context.driverId,
            driverName: context.driverName,
            routeId: context.routeId,
            routeName: context.routeName,
            trackingSessionId: cleanSessionId,
            status,
            source: DRIVER_TRACKING_SOURCE,
            ownerUid: user.uid,
            lastUpdatedAt: now,
            lastUploadedClientAt: clientNow,
            networkStatus
        };

        if (typeof updateData.lat === 'number') {
            sessionPayload.lastKnownLat = updateData.lat;
            livePayload.lat = updateData.lat;
        }
        if (typeof updateData.lng === 'number') {
            sessionPayload.lastKnownLng = updateData.lng;
            livePayload.lng = updateData.lng;
        }
        if (typeof updateData.accuracy === 'number') {
            sessionPayload.lastAccuracy = updateData.accuracy;
            livePayload.accuracy = updateData.accuracy;
        }
        if (typeof updateData.speed === 'number') {
            sessionPayload.lastSpeed = updateData.speed;
            livePayload.speed = updateData.speed;
        }
        if (typeof updateData.heading === 'number') {
            sessionPayload.lastHeading = updateData.heading;
            livePayload.heading = updateData.heading;
        }
        if (updateData.errorCode) {
            sessionPayload.lastErrorCode = sanitizeTrackingText(updateData.errorCode, { maxLength: 64, fallback: '' });
            livePayload.lastErrorCode = sessionPayload.lastErrorCode;
        }
        if (updateData.errorMessage) {
            sessionPayload.lastErrorMessage = sanitizeTrackingText(updateData.errorMessage, { maxLength: 240, fallback: '' });
            livePayload.lastErrorMessage = sessionPayload.lastErrorMessage;
        }
        if (status === 'paused') {
            sessionPayload.pausedAt = now;
        } else if (status === 'active') {
            sessionPayload.resumedAt = now;
        } else if (status === 'stopped') {
            sessionPayload.endedAt = now;
            livePayload.endedAt = now;
        }

        await Promise.all([
            sessionRef.set(sessionPayload, { merge: true }),
            liveRef.set(livePayload, { merge: true })
        ]);

        return { success: true };
    } catch (error) {
        console.error('Error updating driver tracking session:', error);
        return { success: false, error: error.message };
    }
}

async function recordDriverTrackingPoint(pointData = {}) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    const cleanSessionId = sanitizeTrackingId(pointData.sessionId, { maxLength: 80, fallback: '' });
    if (!cleanSessionId) {
        return { success: false, error: 'Session ID is required' };
    }

    if (typeof pointData.lat !== 'number' || typeof pointData.lng !== 'number') {
        return { success: false, error: 'Latitude and longitude are required' };
    }

    try {
        const context = buildDriverTrackingContext(user, pointData);
        const sessionRef = getTrackingSessionsCollectionRef(user.uid).doc(cleanSessionId);
        const pointRef = getTrackingPointsCollectionRef(user.uid, cleanSessionId).doc();
        const liveRef = getDriverLiveCollectionRef(user.uid).doc(context.driverId);
        const batch = db.batch();
        const now = firebase.firestore.FieldValue.serverTimestamp();
        const recordedAt = toIsoDateTime(pointData.recordedAt) || new Date().toISOString();
        const networkStatus = sanitizeTrackingNetworkStatus(pointData.networkStatus, 'online');
        const status = sanitizeTrackingStatus(pointData.status, 'active');

        const pointPayload = {
            sessionId: cleanSessionId,
            driverId: context.driverId,
            driverName: context.driverName,
            routeId: context.routeId,
            routeName: context.routeName,
            source: DRIVER_TRACKING_SOURCE,
            status,
            lat: pointData.lat,
            lng: pointData.lng,
            accuracy: typeof pointData.accuracy === 'number' ? pointData.accuracy : null,
            speed: typeof pointData.speed === 'number' ? pointData.speed : null,
            heading: typeof pointData.heading === 'number' ? pointData.heading : null,
            distanceSinceLastUploadMeters: typeof pointData.distanceSinceLastUploadMeters === 'number'
                ? pointData.distanceSinceLastUploadMeters
                : null,
            recordedAt,
            uploadedAt: now
        };

        const sessionPayload = {
            sessionId: cleanSessionId,
            driverId: context.driverId,
            driverName: context.driverName,
            routeId: context.routeId,
            routeName: context.routeName,
            status,
            source: DRIVER_TRACKING_SOURCE,
            ownerUid: user.uid,
            updatedAt: now,
            lastHeartbeatAt: now,
            lastUploadedClientAt: recordedAt,
            lastKnownLat: pointData.lat,
            lastKnownLng: pointData.lng,
            lastAccuracy: typeof pointData.accuracy === 'number' ? pointData.accuracy : null,
            lastSpeed: typeof pointData.speed === 'number' ? pointData.speed : null,
            lastHeading: typeof pointData.heading === 'number' ? pointData.heading : null,
            networkStatus,
            pointCount: firebase.firestore.FieldValue.increment(1)
        };

        const livePayload = {
            driverId: context.driverId,
            driverName: context.driverName,
            routeId: context.routeId,
            routeName: context.routeName,
            trackingSessionId: cleanSessionId,
            source: DRIVER_TRACKING_SOURCE,
            status,
            ownerUid: user.uid,
            lat: pointData.lat,
            lng: pointData.lng,
            accuracy: typeof pointData.accuracy === 'number' ? pointData.accuracy : null,
            speed: typeof pointData.speed === 'number' ? pointData.speed : null,
            heading: typeof pointData.heading === 'number' ? pointData.heading : null,
            networkStatus,
            lastUpdatedAt: now,
            lastUploadedClientAt: recordedAt,
            staleAfterMs: 90000
        };

        batch.set(pointRef, pointPayload);
        batch.set(sessionRef, sessionPayload, { merge: true });
        batch.set(liveRef, livePayload, { merge: true });
        await batch.commit();

        return { success: true, pointId: pointRef.id };
    } catch (error) {
        console.error('Error recording driver tracking point:', error);
        return { success: false, error: error.message };
    }
}

async function loadDriverTrackingSession(sessionId) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, session: null, error: 'Not logged in' };
    }

    const cleanSessionId = sanitizeTrackingId(sessionId, { maxLength: 80, fallback: '' });
    if (!cleanSessionId) {
        return { success: false, session: null, error: 'Session ID is required' };
    }

    try {
        const doc = await getTrackingSessionsCollectionRef(user.uid).doc(cleanSessionId).get();
        return { success: true, session: mapTrackingSessionDoc(doc) };
    } catch (error) {
        console.error('Error loading driver tracking session:', error);
        return { success: false, session: null, error: error.message };
    }
}

async function loadDriverTrackingPoints(sessionId, { limitCount = 150 } = {}) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, points: [], error: 'Not logged in' };
    }

    const cleanSessionId = sanitizeTrackingId(sessionId, { maxLength: 80, fallback: '' });
    if (!cleanSessionId) {
        return { success: false, points: [], error: 'Session ID is required' };
    }

    try {
        const snapshot = await getTrackingPointsCollectionRef(user.uid, cleanSessionId)
            .orderBy('uploadedAt', 'asc')
            .limit(Math.max(1, Math.min(Number(limitCount) || 150, 500)))
            .get();
        const points = snapshot.docs.map((doc) => mapTrackingPointDoc(doc)).filter(Boolean);
        return { success: true, points };
    } catch (error) {
        console.error('Error loading driver tracking points:', error);
        return { success: false, points: [], error: error.message };
    }
}

async function loadLiveDriverLocations({ limitCount = 25 } = {}) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, drivers: [], error: 'Not logged in' };
    }

    try {
        const snapshot = await getDriverLiveCollectionRef(user.uid)
            .orderBy('lastUpdatedAt', 'desc')
            .limit(Math.max(1, Math.min(Number(limitCount) || 25, 100)))
            .get();
        const drivers = snapshot.docs.map((doc) => mapDriverLiveDoc(doc)).filter(Boolean);
        return { success: true, drivers };
    } catch (error) {
        console.error('Error loading live driver locations:', error);
        return { success: false, drivers: [], error: error.message };
    }
}

function subscribeToLiveDriverLocations(callback, { limitCount = 25 } = {}) {
    const user = getCurrentUser();
    if (!user) {
        if (typeof callback === 'function') callback([]);
        return () => {};
    }

    return getDriverLiveCollectionRef(user.uid)
        .orderBy('lastUpdatedAt', 'desc')
        .limit(Math.max(1, Math.min(Number(limitCount) || 25, 100)))
        .onSnapshot(
            (snapshot) => {
                if (typeof callback !== 'function') return;
                const drivers = snapshot.docs.map((doc) => mapDriverLiveDoc(doc)).filter(Boolean);
                callback(drivers);
            },
            (error) => {
                console.warn('Live driver subscription failed:', error);
                if (typeof callback === 'function') callback([]);
            }
        );
}

// ACTIVE PLANNED ROUTES FUNCTIONS
// Save current active planned routes to cloud (for GPS tracking page persistence)
async function saveActivePlannedRoutes(routesData) {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    try {
        const todayKey = getTodayKey();
        const addressNameEntries = serializeAddressNameMap(routesData.addressNameMap);
        const docRef = db.collection('users').doc(user.uid)
            .collection('activePlannedRoutes').doc(todayKey);

        const dataToSave = {
            plannedRoutes: routesData.plannedRoutes || [],
            addressNameEntries,
            origin: routesData.origin || '',
            savedAt: firebase.firestore.FieldValue.serverTimestamp(),
            localSavedAt: new Date().toISOString()
        };

        await docRef.set(dataToSave);
        console.log('Active planned routes saved to cloud');
        return { success: true };
    } catch (error) {
        console.error('Error saving active planned routes:', error);
        return { success: false, error: error.message };
    }
}

// Load active planned routes from cloud
async function loadActivePlannedRoutes() {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, data: null, error: 'Not logged in' };
    }

    try {
        const todayKey = getTodayKey();
        const doc = await db.collection('users').doc(user.uid)
            .collection('activePlannedRoutes').doc(todayKey).get();

        if (doc.exists) {
            const data = doc.data();
            const hydratedData = {
                ...data,
                addressNameMap: hydrateAddressNameMap(data.addressNameMap, data.addressNameEntries)
            };
            console.log('Loaded active planned routes from cloud:', hydratedData);
            return { success: true, data: hydratedData };
        }

        // If no routes for today, try to get the most recent one
        const recentSnapshot = await db.collection('users').doc(user.uid)
            .collection('activePlannedRoutes')
            .orderBy('savedAt', 'desc')
            .limit(1)
            .get();

        if (!recentSnapshot.empty) {
            const data = recentSnapshot.docs[0].data();
            const hydratedData = {
                ...data,
                addressNameMap: hydrateAddressNameMap(data.addressNameMap, data.addressNameEntries)
            };
            console.log('Loaded most recent planned routes from cloud:', hydratedData);
            return { success: true, data: hydratedData };
        }

        return { success: true, data: null };
    } catch (error) {
        console.error('Error loading active planned routes:', error);
        return { success: false, data: null, error: error.message };
    }
}

// ============================================
// CUSTOMER MANAGEMENT FUNCTIONS
// ============================================

// Save a new customer/stop to Firebase (compat wrapper)
async function saveNewCustomer(customerData) {
    const result = await addStop(customerData, { immediate: true });
    return {
        success: !!result.success,
        id: result.id || null,
        error: result.error || null
    };
}

// Load all custom customers from Firebase (compat wrapper)
async function loadCustomCustomers() {
    const result = await loadStopsCache();
    if (!result.success) {
        return { success: false, customers: [], error: result.error || 'Failed to load stops' };
    }
    const customers = (result.stops || []).map((stop) => toLegacyCustomer(stop));
    return { success: true, customers };
}

// Delete a custom customer from Firebase (compat wrapper)
async function deleteCustomCustomer(customerId) {
    const result = await deleteStop(customerId, { immediate: false });
    return { success: !!result.success, error: result.error || null };
}

// ============================================
// CLEAR ALL USER DATA (NUCLEAR DELETE)
// ============================================

// Helper: delete all documents in a collection
async function deleteCollection(collectionRef, batchSize = 50) {
    let totalDeleted = 0;

    // Process in batches to avoid memory issues
    while (true) {
        const snapshot = await collectionRef.limit(batchSize).get();

        if (snapshot.empty) break;

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        totalDeleted += snapshot.size;
        console.log(`  Deleted ${totalDeleted} documents so far...`);

        if (snapshot.size < batchSize) break;
    }

    return totalDeleted;
}

// Delete ALL user data from Firestore (history/routes, sessions, GPS, plans, snapshots, stops)
async function clearAllUserData() {
    const user = getCurrentUser();
    if (!user) {
        return { success: false, error: 'Not logged in' };
    }

    const uid = user.uid;
    const results = {};

    try {
        console.log('🗑️ Starting FULL data deletion for user:', user.email);

        // 1. Delete history + legacy routes
        console.log('  Deleting history...');
        const historyRef = getHistoryCollectionRef(uid);
        results.history = await deleteCollection(historyRef);
        console.log(`  ✅ Deleted ${results.history} history entries`);

        console.log('  Deleting legacy routes...');
        const routesRef = getLegacyRoutesCollectionRef(uid);
        results.legacyRoutes = await deleteCollection(routesRef);
        console.log(`  ✅ Deleted ${results.legacyRoutes} legacy routes`);

        // 2. Delete session data
        console.log('  Deleting sessions...');
        const sessionsRef = db.collection('users').doc(uid).collection('sessions');
        results.sessions = await deleteCollection(sessionsRef);
        console.log(`  ✅ Deleted ${results.sessions} sessions`);

        // 3. Delete GPS tracking data (has nested subcollections)
        console.log('  Deleting GPS tracking data...');
        results.gpsPoints = 0;
        results.gpsDays = 0;
        const gpsTrackingRef = getUserDocRef(uid).collection('gpsTracking');
        const gpsDocs = await gpsTrackingRef.get();

        for (const gpsDoc of gpsDocs.docs) {
            // Delete the nested 'points' subcollection for each day
            const pointsRef = gpsDoc.ref.collection('points');
            const deletedPoints = await deleteCollection(pointsRef);
            results.gpsPoints += deletedPoints;

            // Delete the day document itself
            await gpsDoc.ref.delete();
            results.gpsDays++;
        }
        console.log(`  ✅ Deleted ${results.gpsDays} GPS days, ${results.gpsPoints} GPS points`);

        // 4. Delete dedicated driver tracking collections
        console.log('  Deleting dedicated driver tracking live docs...');
        const driversLiveRef = getDriverLiveCollectionRef(uid);
        results.driversLive = await deleteCollection(driversLiveRef);
        console.log(`  OK Deleted ${results.driversLive} driver live docs`);

        console.log('  Deleting dedicated driver tracking sessions...');
        results.trackingSessions = 0;
        results.trackingSessionPoints = 0;
        const trackingSessionsRef = getTrackingSessionsCollectionRef(uid);
        const trackingSessionDocs = await trackingSessionsRef.get();

        for (const trackingSessionDoc of trackingSessionDocs.docs) {
            const sessionPointsRef = trackingSessionDoc.ref.collection('points');
            const deletedSessionPoints = await deleteCollection(sessionPointsRef);
            results.trackingSessionPoints += deletedSessionPoints;
            await trackingSessionDoc.ref.delete();
            results.trackingSessions++;
        }
        console.log(`  OK Deleted ${results.trackingSessions} tracking sessions, ${results.trackingSessionPoints} tracking points`);

        // 5. Delete active planned routes
        console.log('  Deleting active planned routes...');
        const activePlannedRef = getUserDocRef(uid).collection('activePlannedRoutes');
        results.activePlannedRoutes = await deleteCollection(activePlannedRef);
        console.log(`  ✅ Deleted ${results.activePlannedRoutes} active planned routes`);

        // 6. Delete plannedRoutes + operationSnapshots
        console.log('  Deleting planned routes...');
        const plannedRef = getPlannedRoutesCollectionRef(uid);
        results.plannedRoutes = await deleteCollection(plannedRef);
        console.log(`  ✅ Deleted ${results.plannedRoutes} planned route docs`);

        console.log('  Deleting operation snapshots...');
        const snapshotsRef = getOperationSnapshotsCollectionRef(uid);
        results.operationSnapshots = await deleteCollection(snapshotsRef);
        console.log(`  ✅ Deleted ${results.operationSnapshots} operation snapshot docs`);

        // 7. Delete stops cache + chunks
        console.log('  Deleting stops cache...');
        await getStopsCacheRef(uid).delete().catch(() => {});
        const chunksRef = getStopsChunksCollectionRef(uid);
        results.stopsChunks = await deleteCollection(chunksRef);
        console.log(`  ✅ Deleted stops cache and ${results.stopsChunks} chunk docs`);

        // 8. Delete legacy customers collection (if any old data exists)
        console.log('  Deleting legacy customers...');
        const customersRef = getUserDocRef(uid).collection('customers');
        results.customers = await deleteCollection(customersRef);
        console.log(`  ✅ Deleted ${results.customers} legacy customer docs`);

        // 9. Delete user settings such as Vehicle / Driver lists
        console.log('  Deleting settings...');
        const settingsRef = getUserDocRef(uid).collection('settings');
        results.settings = await deleteCollection(settingsRef);
        console.log(`  ✅ Deleted ${results.settings} settings docs`);

        // Include Order Hub records in full-account data deletion.
        results.orders = await deleteCollection(getUserDocRef(uid).collection('orders'));
        results.importProfiles = await deleteCollection(getUserDocRef(uid).collection('importProfiles'));
        results.importBatches = await deleteCollection(getUserDocRef(uid).collection('importBatches'));

        results.orderCustomers = await deleteCollection(getUserDocRef(uid).collection('orderCustomers'));
        results.orderContacts = await deleteCollection(getUserDocRef(uid).collection('orderContacts'));
        results.driverExecutions = await deleteCollection(getUserDocRef(uid).collection('driverExecutions'));
        results.driverPods = await deleteCollection(getUserDocRef(uid).collection('driverPods'));
        results.driverPodPhotos = await deleteCollection(getUserDocRef(uid).collection('driverPodPhotos'));

        // Reset in-memory cache/state so subsequent reads reflect cloud deletion.
        _stopsMem = [];
        _stopsLoaded = false;
        _stopsStorageMode = 'single';
        _stopsCacheUid = null;
        _historyBackfillUid = null;
        clearStopsWriteTimer();
        _stopsPendingWrite = false;
        _stopsFlushPromise = null;

        console.log('🗑️ ALL user data deleted successfully:', results);
        return { success: true, results: results };
    } catch (error) {
        console.error('Error clearing all user data:', error);
        return { success: false, error: error.message, partialResults: results };
    }
}

// Initialize once at load so persistence setup happens before any reads/writes.
initializeFirebase();

// Export for use in other files
window.FirebaseApp = {
    init: initializeFirebase,
    isInitialized: () => _firebaseInitDone,
    auth: {
        signUp: firebaseSignUp,
        signIn: firebaseSignIn,
        signInWithGoogle: firebaseSignInWithGoogle,
        signOut: firebaseSignOut,
        getCurrentUser: getCurrentUser,
        ensureWorkspacePersistence: ensureWorkspacePersistence,
        onAuthStateChange: onAuthStateChange,
        ensureProfile: ensureUserProfile,
        loadProfile: loadUserProfile,
        ensureInitialProfileForNewAccount,
        getProfile: getCurrentUserProfile,
        refreshLastLogin: refreshLastLogin,
        resolveAccessState: resolveAccessState,
        sanitizeNextTarget: sanitizeNextTarget,
        isDriverAccount: isDriverAccount
    },
    data: {
        saveRoute: saveRouteToCloud,
        loadRoutes: loadRoutesFromCloud,
        loadPlan: loadPlanFromCloud,
        loadLatestFinalizedPlan: loadLatestFinalizedPlanFromCloud,
        deleteRoute: deleteRouteFromCloud,
        saveSession: saveSessionToCloud,
        loadSession: loadSelectionSessionFromCloud,
        subscribeToRoutes: subscribeToRoutes
    },
    history: {
        saveBundle: saveHistoryBundle,
        loadList: loadRoutesFromCloud,
        delete: deleteRouteFromCloud,
        backfillLegacyRoutes: async () => {
            const user = getCurrentUser();
            if (!user) return { success: false, error: 'Not logged in' };
            return backfillLegacyRoutes(user.uid);
        }
    },
    stops: {
        loadStopsCache: loadStopsCache,
        saveStopsCache: saveStopsCache,
        addStop: addStop,
        updateStop: updateStop,
        deleteStop: deleteStop,
        flushStopsCacheWrites: flushStopsCacheWrites
    },
    gps: {
        savePoint: saveGPSPoint,
        loadTodayPoints: loadTodayGPSPoints,
        updateSummary: updateTrackingSummary,
        loadSummary: loadTrackingSummary,
        subscribeToUpdates: subscribeToGPSUpdates,
        getTodayKey: getTodayKey
    },
    tracking: {
        startSession: startDriverTrackingSession,
        updateSession: updateDriverTrackingSession,
        recordLocation: recordDriverTrackingPoint,
        loadSession: loadDriverTrackingSession,
        loadSessionPoints: loadDriverTrackingPoints,
        loadLiveDrivers: loadLiveDriverLocations,
        subscribeLiveDrivers: subscribeToLiveDriverLocations
    },
    routes: {
        saveActive: saveActivePlannedRoutes,
        loadActive: loadActivePlannedRoutes
    },
    settings: {
        loadVehicleDrivers,
        saveVehicleDrivers
    },
    customers: {
        save: saveNewCustomer,
        loadAll: loadCustomCustomers,
        delete: deleteCustomCustomer
    },
    clearAllData: clearAllUserData
};
