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

// ---- Road routes from the self-hosted network (decision 2: Basic and manual mode use OSRM, no Google) ----
// MapHandler.route/setDirections call this. A result is shaped like google.maps.DirectionsResult for the
// fields GoRouteX reads (legs, durations, distances, step paths, overview path) and marked _source: 'osrm';
// MapHandler draws it as a polyline because a DirectionsRenderer cannot draw a non-Google result.

function osrmRoutingWanted() {
        if (!isPlanEngineEnabled()) return false;
        return getCurrentProductPlan() === 'basic' || window._autoPlanManualMode === true;
    }

function requestPoints(request) {
        if (!request || request.optimizeWaypoints) return null;
        const list = [request.origin, ...(request.waypoints || []).map((w) => w?.location), request.destination];
        const points = list.map(toLatLngPoint);
        if (points.some((p) => !p) || points.length > 27) return null;
        return window.GoRouteXPlannerProblem?.inSingapore && points.every((p) => window.GoRouteXPlannerProblem.inSingapore(p)) ? points : null;
    }

function makeLatLng(lng, lat) {
        return window.google?.maps?.LatLng ? new google.maps.LatLng(lat, lng) : { lat, lng };
    }

function formatDistance(meters) {
        return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
    }

function formatDuration(seconds) {
        const minutes = Math.max(1, Math.round(seconds / 60));
        return minutes >= 60 ? `${Math.floor(minutes / 60)} hour ${minutes % 60} mins` : `${minutes} mins`;
    }

/** Converts the planning service's route into a DirectionsResult-like object. */
function toDirectionsResult(route, points, request) {
        const legs = route.legs.map((leg, index) => {
            const path = (leg.geometry || []).map(([lng, lat]) => makeLatLng(lng, lat));
            const start = makeLatLng(points[index].lng, points[index].lat);
            const end = makeLatLng(points[index + 1].lng, points[index + 1].lat);
            return {
                distance: { value: Math.round(leg.distance), text: formatDistance(leg.distance) },
                duration: { value: Math.round(leg.duration), text: formatDuration(leg.duration) },
                start_location: start,
                end_location: end,
                start_address: '',
                end_address: '',
                steps: [{ path, start_location: start, end_location: end, distance: { value: Math.round(leg.distance) }, duration: { value: Math.round(leg.duration) } }],
                via_waypoints: []
            };
        });
        return {
            _source: 'osrm',
            status: 'OK',
            request,
            geocoded_waypoints: [],
            routes: [{
                legs,
                overview_path: (route.geometry || []).map(([lng, lat]) => makeLatLng(lng, lat)),
                waypoint_order: (request.waypoints || []).map((_, index) => index),
                summary: 'GoRouteX road network',
                warnings: [],
                copyrights: '© OpenStreetMap contributors'
            }]
        };
    }

window.GoRouteXOsrmRouting = {
        /** Points to route with OSRM, or null to use Google for this request. */
        pointsFor(request) {
            return osrmRoutingWanted() ? requestPoints(request) : null;
        },
        async route(request, points) {
            const result = await callPlanRoutes({ action: 'route', coordinates: points.map((p) => [p.lng, p.lat]) }, 12000);
            if (!result.ok || !result.payload.route) throw Object.assign(new Error('Road route unavailable'), { code: result.code || 'planner-failed' });
            return toDirectionsResult(result.payload.route, points, request);
        }
    };
