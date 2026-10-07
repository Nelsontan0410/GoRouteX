import { getFirebaseAdmin, jsonResponse, readJson, verifyFirebaseUser } from './_shared/firebase-admin.js';
import { isActiveSession, isValidSessionId } from './_shared/route-plan-usage.js';
import { sanitizePlannerProblem } from './_shared/planner-validation.js';

// Plan Engine: forwards a validated VROOM problem to the planning service (VROOM + OSRM Singapore on
// Cloud Run). Configure PLANNER_URL and PLANNER_KEY; without them it reports 'planner-unavailable' and
// the browser keeps the existing planner. Actions: warm (wake the scaled-to-zero service), solve.
const SOLVE_TIMEOUT_MS = 15000;
const WARM_TIMEOUT_MS = 4000;

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
    const sessionId = String(body.sessionId || '');
    if (!isValidSessionId(sessionId)) return jsonResponse({ success: false, error: 'Invalid planning session.' }, 400);
    const db = getFirebaseAdmin().firestore();
    if (!(await isActiveSession(db, user.uid, sessionId))) {
      return jsonResponse({ success: false, code: 'no-allowance', error: 'Start automatic planning from Review & Assign first.' }, 403);
    }
    const checked = sanitizePlannerProblem(body.problem);
    if (!checked.ok) return jsonResponse({ success: false, code: 'invalid-problem', error: checked.error }, 400);
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
