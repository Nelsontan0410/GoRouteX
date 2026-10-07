/**
 * Plan Engine (browser side): asks the VRPTW planner (netlify/functions/plan-routes.js) to decide which
 * customer goes on which route, the order and the number of routes, all at once.
 *
 * Staged behind a switch. It is off until the planning service is deployed and PLANNER_URL/PLANNER_KEY
 * are set on Netlify. To try it in one browser: localStorage.setItem('goroutexPlanner', 'on').
 * Rollout: set PLAN_ENGINE_ENABLED = true. Rollback: set it back to false.
 *
 * Classic script; uses app.html globals (getRouteStartDateTime, getLocationInput, getCustomerDeliveryConstraints,
 * getCurrentUserIdToken, getPackedRouteStopId, getCurrentProductPlan) and planner-problem.js.
 */
const PLAN_ENGINE_ENABLED = false;

function isPlanEngineEnabled() {
        if (PLAN_ENGINE_ENABLED) return true;
        try { return window.localStorage?.getItem('goroutexPlanner') === 'on'; } catch (_) { return false; }
    }

function toLatLngPoint(value) {
        if (!value || typeof value === 'string') return null;
        const lat = typeof value.lat === 'function' ? value.lat() : Number(value.lat);
        const lng = typeof value.lng === 'function' ? value.lng() : Number(value.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    }

async function callPlanRoutes(body, timeoutMs = 20000) {
        const idToken = await getCurrentUserIdToken();
        if (!idToken) return { ok: false, code: 'no-auth' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch('/.netlify/functions/plan-routes', {
                method: 'POST',
                headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            const payload = await response.json().catch(() => ({}));
            return { ok: response.ok && payload.success === true, code: payload.code || null, payload };
        } catch (error) {
            return { ok: false, code: error?.name === 'AbortError' ? 'timeout' : 'network' };
        } finally {
            clearTimeout(timer);
        }
    }

// Wakes the scaled-to-zero planning service while the planner is still choosing stops.
let planEngineWarmed = false;
function warmPlanEngine() {
        if (!isPlanEngineEnabled() || planEngineWarmed) return;
        planEngineWarmed = true;
        callPlanRoutes({ action: 'warm' }, 6000).catch(() => {});
    }

/** The planner input from the current selection, or { unsupported } when it cannot be used. */
function buildPlanEngineInput(selectedStops, destinationId) {
        const origin = toLatLngPoint(getLocationInput(currentLocationOrigin));
        const end = destinationId ? toLatLngPoint(getLocationInput(destinationId)) : null;
        const settings = window.GoRouteXSettings?.getCachedSettings?.() || {};
        const input = {
            startDate: getRouteStartDateTime(),
            origin,
            end: end || origin,
            availableDrivers: 0,
            driverRules: settings.drivers || {},
            maxDurationMinutes: settings.routePlanning?.maxDurationMinutes,
            stops: selectedStops.map((stop) => {
                const id = getPackedRouteStopId(stop);
                const constraints = getCustomerDeliveryConstraints(id);
                const lat = Number(stop.lat), lng = Number(stop.lng);
                return {
                    id,
                    lat: Number.isFinite(lat) ? lat : null,
                    lng: Number.isFinite(lng) ? lng : null,
                    serviceMinutes: constraints.serviceMinutes,
                    schedule: constraints.schedule
                };
            })
        };
        const reason = window.GoRouteXPlannerProblem?.unsupportedReason(input) || (window.GoRouteXPlannerProblem ? null : 'Planner not loaded.');
        return reason ? { unsupported: reason } : { input };
    }

/**
 * Plans with the VRPTW planner. Returns { routes: [{ stops }], unassigned: [{ id, reason, message }] }, or
 * { fallback: reason } when the existing planner should be used instead.
 */
async function planWithPlanEngine(selectedStops, destinationId, sessionId) {
        if (!isPlanEngineEnabled()) return { fallback: 'disabled' };
        if (!sessionId) return { fallback: 'no-session' };
        const prepared = buildPlanEngineInput(selectedStops, destinationId);
        if (prepared.unsupported) return { fallback: prepared.unsupported };
        const built = window.GoRouteXPlannerProblem.buildProblem(prepared.input);
        if (!built.problem.jobs.length) {
            return { routes: [], unassigned: built.preUnassigned };
        }
        const result = await callPlanRoutes({ action: 'solve', sessionId, problem: built.problem });
        if (!result.ok) return { fallback: result.code || 'planner-failed' };
        const mapped = window.GoRouteXPlannerProblem.mapSolution(result.payload.solution, built);
        const byId = new Map(selectedStops.map((stop) => [getPackedRouteStopId(stop), stop]));
        return {
            routes: mapped.routes.map((route) => ({ stops: route.stopIds.map((id) => byId.get(id)).filter(Boolean), plannedStops: route.stops })),
            unassigned: mapped.unassigned
        };
    }
