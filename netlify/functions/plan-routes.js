import { getFirebaseAdmin, jsonResponse, readJson, verifyFirebaseUser } from './_shared/firebase-admin.js';
import { isActiveSession, isValidSessionId } from './_shared/route-plan-usage.js';
import { sanitizeBaselineRoutes, sanitizeCalibrationLegs, sanitizePlannerProblem, sanitizeRouteRequest } from './_shared/planner-validation.js';

// Plan Engine: forwards a validated VROOM problem to the planning service (VROOM + OSRM Singapore on
// Cloud Run). Configure PLANNER_URL and PLANNER_KEY; without them it reports 'planner-unavailable' and
// the browser keeps the existing planner. Actions: warm (wake the scaled-to-zero service), solve.
const SOLVE_TIMEOUT_MS = 15000;
const WARM_TIMEOUT_MS = 4000;
const ROUTE_TIMEOUT_MS = 10000;

function plannerConfig() {
  const env = (name) => (typeof Netlify !== 'undefined' ? Netlify.env.get(name) : process.env[name]) || '';
  const url = env('PLANNER_URL').replace(/\/+$/, '');
  const key = env('PLANNER_KEY');
  return url && key ? { url, key } : null;
}

async function callPlanner(config, path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.url}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Planner-Key': config.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  const user = await verifyFirebaseUser(req);
  if (!user?.uid) return jsonResponse({ success: false, error: 'Login required' }, 401);
  if (user.role === 'driver' || user.uid.startsWith('drv_')) return jsonResponse({ success: false, error: 'Drivers cannot plan routes.' }, 403);
  const config = plannerConfig();
  if (!config) return jsonResponse({ success: false, code: 'planner-unavailable', error: 'The route planner is not configured.' }, 503);
  try {
    const body = await readJson(req);
    if (body.action === 'warm') {
      const result = await callPlanner(config, '/health', null, WARM_TIMEOUT_MS).catch(() => ({ ok: false }));
      return jsonResponse({ success: true, ready: !!result.ok });
    }
    if (body.action === 'route') {
      // Road route between ordered points (manual mode and Basic): free self-hosted OSRM instead of Google.
      const checked = sanitizeRouteRequest(body.coordinates);
      if (!checked.ok) return jsonResponse({ success: false, code: 'invalid-route', error: checked.error }, 400);
      const result = await callPlanner(config, '/route', { coordinates: checked.coordinates }, ROUTE_TIMEOUT_MS);
      if (!result.ok) return jsonResponse({ success: false, code: 'planner-failed', error: 'The road route is unavailable.' }, 502);
      return jsonResponse({ success: true, route: result.payload });
    }
    if (body.action === 'calibrate') {
      // Google-confirmed leg durations vs the road network, for the travel-time correction factor.
      // Only durations and the hour are stored, never locations.
      const checked = sanitizeCalibrationLegs(body.legs);
      const hour = Number(body.hour);
      if (!checked.ok || !Number.isInteger(hour) || hour < 0 || hour > 23) return jsonResponse({ success: false, code: 'invalid-calibration' }, 400);
      const result = await callPlanner(config, '/legs', { pairs: checked.legs.map((leg) => [leg.from, leg.to]) }, ROUTE_TIMEOUT_MS);
      if (!result.ok) return jsonResponse({ success: false, code: 'planner-failed' }, 502);
      const legs = checked.legs.map((leg, i) => ({ google: leg.google, network: Math.round(Number(result.payload.durations?.[i]) || 0) })).filter((leg) => leg.network > 0);
      const admin = getFirebaseAdmin();
      const e = body.edits && typeof body.edits === 'object' ? body.edits : null;
      const edits = e ? {
        source: ['plan-engine', 'google', 'manual'].includes(e.source) ? e.source : 'unknown',
        moved: Math.max(0, Math.min(1000, Number(e.moved) || 0)),
        reordered: Math.max(0, Math.min(1000, Number(e.reordered) || 0)),
        removed: Math.max(0, Math.min(1000, Number(e.removed) || 0)),
        added: Math.max(0, Math.min(1000, Number(e.added) || 0)),
        unchanged: e.unchanged === true
      } : null;
      await admin.firestore().collection('planEngineCalibration').add({ uid: user.uid, hour, legs, edits, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      return jsonResponse({ success: true, stored: legs.length });
    }
    const sessionId = String(body.sessionId || '');
    if (!isValidSessionId(sessionId)) return jsonResponse({ success: false, error: 'Invalid planning session.' }, 400);
    const db = getFirebaseAdmin().firestore();
    if (!(await isActiveSession(db, user.uid, sessionId))) {
      return jsonResponse({ success: false, code: 'no-allowance', error: 'Start automatic planning from Review & Assign first.' }, 403);
    }
    const checked = sanitizePlannerProblem(body.problem);
    if (!checked.ok) return jsonResponse({ success: false, code: 'invalid-problem', error: checked.error }, 400);
    if (body.action === 'shadow') {
      // Shadow mode: score the Plan Engine against the plan actually used, without showing it.
      const baselineRoutes = sanitizeBaselineRoutes(body.baselineRoutes, checked.problem);
      if (!baselineRoutes) return jsonResponse({ success: false, code: 'invalid-problem', error: 'Invalid baseline.' }, 400);
      const result = await callPlanner(config, '/shadow', { problem: checked.problem, baselineRoutes, baselineUnassigned: Number(body.baselineUnassigned) || 0 }, SOLVE_TIMEOUT_MS);
      if (!result.ok) return jsonResponse({ success: false, code: 'planner-failed' }, 502);
      const admin = getFirebaseAdmin();
      await admin.firestore().collection('planEngineShadow').add({
        uid: user.uid,
        sessionId,
        source: String(body.baselineSource || 'google').slice(0, 20),
        stops: checked.problem.jobs.length,
        engine: result.payload.engine,
        baseline: result.payload.baseline,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return jsonResponse({ success: true });
    }
    const result = await callPlanner(config, '/solve', checked.problem, SOLVE_TIMEOUT_MS);
    if (!result.ok || result.payload?.code !== 0) {
      console.error('Planner solve failed:', result.status, result.payload?.error || result.payload?.code);
      return jsonResponse({ success: false, code: 'planner-failed', error: 'The route planner could not solve this plan.' }, 502);
    }
    return jsonResponse({ success: true, solution: { routes: result.payload.routes || [], unassigned: result.payload.unassigned || [], summary: result.payload.summary || null } });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    console.error('Plan routes failed:', timedOut ? 'timeout' : (error.code || error.message));
    return jsonResponse({ success: false, code: timedOut ? 'planner-timeout' : 'planner-failed', error: 'The route planner is unavailable right now.' }, timedOut ? 504 : 503);
  }
};
