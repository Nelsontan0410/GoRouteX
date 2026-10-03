import { getFirebaseAdmin, verifyFirebaseUser, jsonResponse, readJson } from './_shared/firebase-admin.js';
import { requireOwner } from './_shared/driver-domain.js';

const clean = (value, limit = 160) => String(value ?? '').trim().slice(0, limit);
const safeId = value => /^[a-zA-Z0-9_-]+$/.test(value);
const key = (ownerUid, planId, routeId) => `${ownerUid}_${planId}_${routeId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240);

async function account(db, uid) {
  const snapshot = await db.collection('users').doc(uid).get();
  return snapshot.exists ? snapshot.data() || {} : null;
}

async function driverIdentity(admin, db, uid, ownerUid = null, loadedProfile = undefined) {
  if (uid.startsWith('drv_')) {
    const profile = loadedProfile === undefined ? await account(db, uid) : loadedProfile;
    const tenantId = profile?.tenantId;
    if (!tenantId || (ownerUid && tenantId !== ownerUid)) throw Error('Driver is not active in this workspace.');
    const [auth, credentialDoc, tenantDriverDoc] = await Promise.all([
      admin.auth().getUser(uid),
      db.collection('driverCredentials').doc(uid).get(),
      db.collection('users').doc(tenantId).collection('drivers').doc(uid).get()
    ]);
    const credential = credentialDoc.exists ? credentialDoc.data() : null;
    const driver = tenantDriverDoc.exists ? tenantDriverDoc.data() : null;
    if (auth.disabled || auth.customClaims?.role !== 'driver' || auth.customClaims?.tenantId !== tenantId || profile.role !== 'driver' || profile.active === false || credential?.status !== 'ACTIVE' || credential?.tenantId !== tenantId || driver?.status !== 'ACTIVE' || driver?.tenantId !== tenantId) throw Error('Driver is not active in this workspace.');
    return { uid, tenantId, name: clean(driver.displayName || profile.name), username: clean(driver.username), email: '' };
  }
  throw Error('Driver account must be a managed Driver created in Settings.');
}

function hasEtaForEveryStop(route) {
  const timings = Array.isArray(route.detailedStopTimes) ? route.detailedStopTimes : [];
  return route.customerStops.every(stop => {
    const stopId = clean(stop.savedStopId || stop.id || stop.uniqueId);
    const address = clean(stop.deliveryAddress || stop.address || stop.Address).toLowerCase();
    return timings.some(item => item.arrivalTimeStr && ((stopId && clean(item.stopId) === stopId) || (address && clean(item.address).toLowerCase() === address)));
  });
}

function publicError(error) {
  if (error.code === 7 || error.code === 'permission-denied' || error.code === 'PERMISSION_DENIED') {
    console.error('Dispatch database permission denied:', error);
    return 'Dispatch cannot access route data. The site administrator must restore its Firebase database permission.';
  }
  if (error.message?.startsWith('The selected account') || error.message?.startsWith('Route ') || error.message?.startsWith('Driver ') || error.message?.startsWith('Invitation ') || error.message?.startsWith('No ')) return error.message;
  console.error('Dispatch service failed:', error);
  return 'Dispatch is unavailable right now. Please retry.';
}

export default async (req) => {
  const startedAt = performance.now();
  const timings = {};
  const counts = { firestoreReads: 0, authCalls: 0, routes: 0, drivers: 0 };
  const measure = (name, since) => { timings[name] = Math.round((performance.now() - since) * 10) / 10; };
  const respond = (payload, status = 200) => {
    const beforeSerialize = performance.now();
    const response = jsonResponse(payload, status);
    measure('serialize', beforeSerialize);
    measure('responseTotal', startedAt);
    response.headers.set('Server-Timing', Object.entries(timings).map(([name, value]) => `${name};dur=${value}`).join(', '));
    response.headers.set('X-Dispatch-Counts', `reads=${counts.firestoreReads};auth=${counts.authCalls};routes=${counts.routes};drivers=${counts.drivers}`);
    response.headers.set('X-Dispatch-Response-Bytes', String(Buffer.byteLength(JSON.stringify(payload))));
    return response;
  };
  try {
    let stage = performance.now();
    const decoded = await verifyFirebaseUser(req);
    measure('auth', stage);
    if (!decoded) return respond({ success: false, error: 'Sign in required.' }, 401);
    stage = performance.now();
    const admin = getFirebaseAdmin();
    measure('adminInit', stage);
    const db = admin.firestore();
    const uid = decoded.uid;
    stage = performance.now();
    const profile = await account(db, uid);
    counts.firestoreReads += 1;
    measure('tenant', stage);
    if (!profile) return respond({ success: false, error: 'Account profile unavailable.' }, 403);
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await readJson(req) : {};
    const action = req.method === 'GET' ? url.searchParams.get('action') : body.action;

    if (action === 'invitations' && req.method === 'GET') {
      await driverIdentity(admin, db, uid, null, profile);
      const snapshot = await db.collection('dispatchInvites').where('driverUid', '==', uid).get();
      return respond({ success: true, invitations: snapshot.docs.filter(doc => doc.data().status === 'PENDING').map(doc => ({ ownerUid: doc.data().ownerUid, ownerName: doc.data().ownerName || 'GoRouteX workspace' })) });
    }

    if (action === 'accept' && req.method === 'POST') {
      await driverIdentity(admin, db, uid, null, profile);
      const ownerUid = clean(body.ownerUid, 128);
      const inviteRef = db.collection('dispatchInvites').doc(`${uid}_${ownerUid}`);
      const linkRef = db.collection('dispatchLinks').doc(uid);
      await db.runTransaction(async tx => {
        const [invite, link] = await Promise.all([tx.get(inviteRef), tx.get(linkRef)]);
        if (!invite.exists || invite.data().status !== 'PENDING' || invite.data().driverUid !== uid || invite.data().ownerUid !== ownerUid) throw Error('Invitation is no longer available.');
        if (link.exists && link.data().ownerUid !== ownerUid) throw Error('Driver account is already linked to another workspace.');
        tx.set(linkRef, { ownerUid, driverUid: uid, active: true, acceptedAt: new Date().toISOString() });
        tx.update(inviteRef, { status: 'ACCEPTED', acceptedAt: new Date().toISOString() });
      });
      return respond({ success: true });
    }

    if (action === 'sync-order' && req.method === 'POST') {
      const authenticatedDriver = await driverIdentity(admin, db, uid, null, profile);
      const dispatchId = clean(body.dispatchId, 240);
      const stopId = clean(body.stopId, 240);
      const outcome = clean(body.outcome, 20);
      if (!dispatchId || !stopId || !['DELIVERED', 'FAILED'].includes(outcome)) return respond({ success: false, error: 'Route outcome is invalid.' }, 400);
      const dispatchDoc = await db.collection('dispatchRoutes').doc(dispatchId).get();
      if (!dispatchDoc.exists || dispatchDoc.data().assignedDriverUid !== uid) return respond({ success: false, error: 'Route is not assigned to this driver.' }, 403);
      const executionDoc = await db.collection('users').doc(uid).collection('driverExecutions').doc(dispatchId).get();
      const stop = executionDoc.exists ? (executionDoc.data().stops || []).find(item => item.id === stopId) : null;
      if (!stop || stop.executionStatus !== outcome) return respond({ success: false, error: 'Route outcome has not been saved by the driver.' }, 409);
      const ownerUid = dispatchDoc.data().dispatchOwnerUid;
      if (authenticatedDriver.tenantId && authenticatedDriver.tenantId !== ownerUid) return respond({ success: false, error: 'Route is not assigned to this workspace.' }, 403);
      if (!authenticatedDriver.tenantId) {
        const link = await db.collection('dispatchLinks').doc(uid).get();
        if (!link.exists || link.data().ownerUid !== ownerUid || !link.data().active) return respond({ success: false, error: 'Route is not assigned to this workspace.' }, 403);
      }
      const orderIds = [...new Set(Array.isArray(stop.orderIds) ? stop.orderIds.map(id => clean(id, 128)).filter(Boolean) : [])].slice(0, 100);
      const orderRefs = orderIds.map(id => db.collection('users').doc(ownerUid).collection('orders').doc(id));
      const orderDocs = await Promise.all(orderRefs.map(ref => ref.get()));
      const batch = db.batch();
      let updated = 0;
      orderDocs.forEach((doc, index) => { if (doc.exists) { batch.set(orderRefs[index], { executionStatus: outcome, driverRouteId: dispatchId, executionUpdatedAt: new Date().toISOString() }, { merge: true }); updated++; } });
      if (updated) await batch.commit();
      return respond({ success: true, updated });
    }

    try { requireOwner(decoded, profile); } catch (error) { return respond({ success: false, error: 'Dispatch management requires a workspace account.', code: error?.code || 'FORBIDDEN' }, 403); }

    if (action === 'invite' && req.method === 'POST') {
      const email = clean(body.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ success: false, error: 'Driver email is invalid.' }, 400);
      let record;
      try { record = await admin.auth().getUserByEmail(email); } catch { return respond({ success: false, error: 'Driver must sign in with Google before being invited.' }, 400); }
      const driver = await driverIdentity(admin, db, record.uid);
      const existing = await db.collection('dispatchLinks').doc(driver.uid).get();
      if (existing.exists && existing.data().ownerUid !== uid) return respond({ success: false, error: 'Driver account belongs to another workspace.' }, 409);
      if (existing.exists) return respond({ success: true, alreadyLinked: true });
      await db.collection('dispatchInvites').doc(`${driver.uid}_${uid}`).set({ ownerUid: uid, ownerName: clean(profile.name || decoded.email || 'GoRouteX workspace'), driverUid: driver.uid, driverEmail: driver.email, status: 'PENDING', invitedAt: new Date().toISOString() });
      return respond({ success: true, pending: true });
    }

    if (action === 'drivers' && req.method === 'GET') {
      stage = performance.now();
      const accounts = await db.collection('users').doc(uid).collection('drivers').where('status', '==', 'ACTIVE').get();
      counts.firestoreReads += accounts.size;
      measure('driversQuery', stage);
      stage = performance.now();
      // Tenant-scoped records are sufficient for choosing a Driver. Submission
      // still verifies Auth, credentials, tenant ownership, and active status.
      const drivers = accounts.docs.filter(doc => doc.data().tenantId === uid)
        .map(doc => ({ uid: doc.id, id: doc.id, name: clean(doc.data().displayName), username: clean(doc.data().username), status: 'ACTIVE' }));
      counts.drivers = drivers.length;
      measure('driversIdentity', stage);
      return respond({ success: true, drivers });
    }

    if (action === 'dispatch' && req.method === 'POST') {
      const planId = clean(body.planId, 128);
      const assignments = Array.isArray(body.assignments) ? body.assignments : [];
      if (!planId || !safeId(planId) || !assignments.length || assignments.length > 50) return respond({ success: false, error: 'No valid route assignments were supplied.' }, 400);
      const planRef = db.collection('users').doc(uid).collection('history').doc(planId);
      stage = performance.now();
      const planSnap = await planRef.get();
      counts.firestoreReads += 1;
      measure('plan', stage);
      const plan = planSnap.exists ? planSnap.data() : body.planSnapshot;
      if (!plan || !Array.isArray(plan.plannedRoutes) || !plan.plannedRoutes.length) return respond({ success: false, error: 'Route plan was not found. Save the plan before dispatching.' }, 404);
      const candidates = [];
      const seen = new Set();
      for (const row of assignments) {
        const routeId = clean(row.routeId, 60);
        const driverUid = clean(row.driverUid, 128);
        if (!routeId || !safeId(routeId) || !driverUid || !safeId(driverUid) || seen.has(routeId)) return respond({ success: false, error: 'Route assignments contain an empty or duplicate route.' }, 400);
        seen.add(routeId);
        const route = (plan.plannedRoutes || []).find(item => String(item?.id) === routeId);
        if (!route || !Array.isArray(route.customerStops) || !route.customerStops.length) return respond({ success: false, error: `Route ${routeId} has no finalized stops.` }, 400);
        if (!hasEtaForEveryStop(route)) return respond({ success: false, error: `Route ${routeId} is missing a finalized stop ETA. Replan and save it first.` }, 400);
        candidates.push({ routeId, route, driverUid, dispatchId: key(uid, planId, routeId) });
      }
      // Verify each distinct Driver once, concurrently, immediately before the transaction.
      const uniqueDriverUids = [...new Set(candidates.map(item => item.driverUid))];
      const verifiedDrivers = [];
      for (let offset = 0; offset < uniqueDriverUids.length; offset += 10) {
        const batch = await Promise.all(uniqueDriverUids.slice(offset, offset + 10).map(async driverUid => {
          if (driverUid.startsWith('drv_')) {
            const accountDoc = await db.collection('users').doc(uid).collection('drivers').doc(driverUid).get();
            if (!accountDoc.exists || accountDoc.data().status !== 'ACTIVE' || accountDoc.data().tenantId !== uid) throw Error('Driver is not active in this workspace.');
          } else {
            const link = await db.collection('dispatchLinks').doc(driverUid).get();
            if (!link.exists || !link.data().active || link.data().ownerUid !== uid) throw Error('Driver is not active in this workspace.');
          }
          counts.firestoreReads += 1;
          counts.authCalls += 1;
          return [driverUid, await driverIdentity(admin, db, driverUid, uid)];
        }));
        verifiedDrivers.push(...batch);
      }
      const driverMap = new Map(verifiedDrivers);
      const selected = candidates.map(item => ({ ...item, driver: driverMap.get(item.driverUid) }));
      const now = new Date().toISOString();
      await db.runTransaction(async tx => {
        const refs = selected.map(item => db.collection('dispatchRoutes').doc(item.dispatchId));
        const existing = await Promise.all(refs.map(ref => tx.get(ref)));
        if (existing.some(doc => doc.exists)) throw Error('Route already dispatched. Refresh Dispatch before retrying.');
        for (let i = 0; i < selected.length; i++) {
          const { route, routeId, driver, dispatchId } = selected[i];
          const legs = route.directionsResult?.routes?.[0]?.legs || [];
          const estimatedDistanceMeters = Number(route.estimatedDistanceMeters) || legs.reduce((sum, leg) => sum + Number(leg.distance?.value || 0), 0);
          const estimatedDurationSeconds = Number(route.estimatedDurationSeconds) || legs.reduce((sum, leg) => sum + Number(leg.duration?.value || 0), 0);
          const snapshot = JSON.parse(JSON.stringify({ id: route.id, label: route.label, estimatedDistanceMeters, estimatedDurationSeconds, originalWaypoints: route.originalWaypoints || [], optimizedStops: route.optimizedStops || [], customerStops: route.customerStops, detailedStopTimes: route.detailedStopTimes, routeStopConfigs: route.routeStopConfigs || [], endLocationId: route.endLocationId || null }));
          const delivery = { id: dispatchId, routeName: `Route ${routeId}`, date: plan.date || plan.planningDate || null, planningDate: plan.planningDate || plan.date || null, routeStartTime: plan.routeStartTime || plan.startTime || null, startTime: plan.startTime || plan.routeStartTime || null, originName: plan.originName || '', endLocationLabel: plan.endLocationLabel || '', assignedDriverUid: driver.uid, dispatchOwnerUid: uid, dispatchPlanId: planId, dispatchedAt: now, status: 'DISPATCHED', driverName: driver.name, vehicleDriver: '', estimatedDistanceMeters, estimatedDurationSeconds, plannedRoutes: [snapshot], orderLinkStatus: plan.orderLinkStatus || 'NONE' };
          tx.create(refs[i], { ...delivery, routeId, driverEmail: driver.email, dispatchedBy: uid });
          tx.set(db.collection('users').doc(driver.uid).collection('history').doc(dispatchId), delivery);
        }
      });
      return respond({ success: true, routes: selected.map(item => ({ routeId: item.routeId, dispatchId: item.dispatchId, driverUid: item.driver.uid, driverName: item.driver.name })) });
    }

    if (action === 'routes' && req.method === 'GET' && url.searchParams.get('planId')) {
      const planId = clean(url.searchParams.get('planId'), 128);
      const routeIds = [...new Set((url.searchParams.get('routeIds') || '').split(',').map(id => clean(id, 60)).filter(Boolean))];
      if (!safeId(planId) || routeIds.length > 50 || routeIds.some(id => !safeId(id))) return respond({ success: false, error: 'Invalid plan or route IDs.' }, 400);
      stage = performance.now();
      const refs = routeIds.map(routeId => db.collection('dispatchRoutes').doc(key(uid, planId, routeId)));
      const docs = await Promise.all(refs.map(ref => ref.get()));
      counts.firestoreReads += docs.length;
      counts.routes = docs.filter(doc => doc.exists).length;
      measure('statusQuery', stage);
      stage = performance.now();
      const routes = await Promise.all(docs.filter(doc => doc.exists).map(async doc => {
        const data = doc.data() || {};
        if (data.dispatchOwnerUid !== uid || String(data.dispatchPlanId) !== planId || !routeIds.includes(String(data.routeId))) return null;
        const executionDoc = await db.collection('users').doc(data.assignedDriverUid).collection('driverExecutions').doc(doc.id).get();
        const execution = executionDoc.exists ? executionDoc.data() || {} : {};
        const completedStops = (execution.stops || []).filter(stop => ['DELIVERED', 'FAILED'].includes(stop.executionStatus)).length;
        const totalStops = data.plannedRoutes?.[0]?.customerStops?.length || 0;
        return { id: doc.id, routeId: String(data.routeId), dispatchPlanId: planId,
          assignedDriverUid: data.assignedDriverUid, driverName: data.driverName || '',
          status: data.status || 'DISPATCHED', execution: { status: execution.status || 'DISPATCHED', completedStops, totalStops },
          dispatchedAt: data.dispatchedAt || null, updatedAt: execution.updatedAt || data.updatedAt || null };
      }));
      counts.firestoreReads += counts.routes;
      measure('execution', stage);
      timings.gps = 0; // GPS is absent from the primary status path.
      return respond({ success: true, routes: routes.filter(Boolean) });
    }

    if ((action === 'routes' || action === 'monitor') && req.method === 'GET') {
      const routeId = clean(url.searchParams.get('dispatchId'), 240);
      const snapshot = routeId ? await db.collection('dispatchRoutes').doc(routeId).get() : null;
      if (routeId && (!snapshot.exists || snapshot.data().dispatchOwnerUid !== uid)) return respond({ success: false, error: 'Route not found in this workspace.' }, 404);
      stage = performance.now();
      const docs = routeId ? [snapshot] : (await db.collection('dispatchRoutes').where('dispatchOwnerUid', '==', uid).limit(100).get()).docs;
      counts.firestoreReads += docs.length;
      counts.routes = docs.length;
      measure('statusQuery', stage);
      stage = performance.now();
      const routes = await Promise.all(docs.map(async doc => {
        const data = doc.data();
        const driverRoot = db.collection('users').doc(data.assignedDriverUid);
        const [execution, live, podDocs] = await Promise.all([driverRoot.collection('driverExecutions').doc(doc.id).get(), driverRoot.collection('drivers_live').doc(data.assignedDriverUid).get(), action === 'monitor' ? driverRoot.collection('driverPods').where('routeId', '==', doc.id).limit(100).get() : Promise.resolve(null)]);
        const gps = live.exists && live.data().routeId === doc.id ? live.data() : null;
        const pods = podDocs ? podDocs.docs.map(pod => ({ stopId: pod.data().stopId, recipientName: pod.data().recipientName || '', notes: pod.data().notes || '', completedAt: pod.data().completedAt || null })) : [];
        return { ...data, execution: execution.exists ? execution.data() : null, gps, pods };
      }));
      counts.firestoreReads += docs.length * (action === 'monitor' ? 3 : 2);
      measure('execution', stage);
      return respond({ success: true, routes });
    }

    return respond({ success: false, error: 'Unknown dispatch action.' }, 404);
  } catch (error) {
    const message = publicError(error);
    return respond({ success: false, error: message }, message.startsWith('Route already dispatched') ? 409 : message.startsWith('Dispatch cannot access route data') ? 503 : 500);
  }
};
