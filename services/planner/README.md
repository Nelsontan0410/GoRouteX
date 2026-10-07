# GoRouteX planning service (Plan Engine)

This service decides which customer goes on which route, the stop order, and how many routes to use. It solves all three at once as a vehicle routing problem with time windows (VRPTW), using [VROOM](https://github.com/VROOM-Project/vroom).

Travel times come from an [OSRM](https://github.com/Project-OSRM/osrm-backend) road network of Singapore that runs inside the service, built from OpenStreetMap data via BBBike. There are no per-request map fees.

The service runs on Google Cloud Run in Singapore (`asia-southeast1`). It scales to zero, so it costs nothing while idle.

The browser builds the problem (`planner-problem.js`). Netlify then:
- checks the user is logged in,
- checks the user's daily automatic-planning allowance,
- validates the problem (`netlify/functions/plan-routes.js`),
- forwards it to this service with the `X-Planner-Key` header.

## Measured (whole of Singapore, local Mac)

| | |
|---|---|
| Road network preprocessing | ~10 s, peak 565 MB, 95 MB of data |
| Engine memory while serving | ~90 MB |
| 101 × 101 travel-time matrix | 0.1 s |
| 18 stops, 3 routes, delivery windows and breaks | 0.57 s total |
| Sanity check | Jurong East → Changi Airport: 33.3 km, 34 min |

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Wake the instance |
| POST | `/solve` | `X-Planner-Key` | VROOM problem with `[lng, lat]` locations → VROOM solution |
| POST | `/route` | `X-Planner-Key` | `{ coordinates }` → road route: distance, duration, legs, GeoJSON line. Used for Basic and manual mode instead of Google Directions |
| POST | `/shadow` | `X-Planner-Key` | Plans in the background and compares with the plan GoRouteX used (metrics only) |
| POST | `/legs` | `X-Planner-Key` | Network travel times for driven legs, for calibration against Google |

**Environment variables:**

| Variable | Meaning |
|---|---|
| `PLANNER_KEY` | Required |
| `OSRM_DATA` | Path to the road network data |
| `VROOM_BIN` | Path to the VROOM binary |
| `SOLVE_SECONDS` | Solver time limit, default 5 |
| `DURATION_FACTOR` | Travel-time calibration multiplier, default 1 |

## One-time setup (Google Cloud Console, about 10 minutes)

1. Choose the Google Cloud project, for example `delivery-app-cd18e`. Billing must be enabled.
2. **APIs & Services → Enable APIs:** Cloud Run Admin API, Cloud Build API, Artifact Registry API, Secret Manager API.
3. **Artifact Registry → Create repository:**
   - Name: `goroutex`
   - Format: Docker
   - Region: `asia-southeast1`
4. **Secret Manager → Create secret:**
   - Name: `planner-key`
   - Value: a long random string. One way to make one is `openssl rand -hex 32`.
   - Then grant the role *Secret Manager Secret Accessor* to the Compute Engine default service account (`<project-number>-compute@developer.gserviceaccount.com`).
5. **IAM:** grant the Cloud Build service account the roles *Cloud Run Admin* and *Service Account User*.

## Deploy (and monthly map refresh)

```bash
cd services/planner
gcloud builds submit --project <project-id> --config cloudbuild.yaml .
```

When the build finishes, the command prints the service URL.

## Connect GoRouteX

In **Netlify → Site configuration → Environment variables**, add:

| Variable | Value |
|---|---|
| `PLANNER_URL` | The Cloud Run URL |
| `PLANNER_KEY` | The same value as the `planner-key` secret |

Then redeploy the site.

**Try it in one browser first.** Run this in the browser console on goroutex.netlify.app:

```js
localStorage.setItem('goroutexPlanner', 'on')
```

Then plan a route as usual.

**Roll out to everyone:** set `PLAN_ENGINE_ENABLED = true` in `planning/plan-engine-client.js`.

**Roll back:** set it back to `false`, or remove `PLANNER_URL`. GoRouteX then uses the existing planner again.

## Shadow data and rollout gate

While `PLAN_ENGINE_ENABLED` is false and `PLANNER_URL` is set, each plan is also solved in the background and only the comparison is stored (`planEngineShadow`). Paid plans also store Google vs network leg times (`planEngineCalibration`). To read them:

```bash
gcloud auth application-default login   # once
node scripts/plan-engine-report.mjs --days 30
```

The report says whether the rollout gate is met (at least 50 comparisons, no worse in at least 95%, total time not longer) and suggests a `DURATION_FACTOR`.

## Smoke test

`scripts/smoke.mjs` plans 18 real Singapore locations, including morning-only, afternoon-only and closed customers. It checks that every service starts and finishes inside its customer window, and that no route has more than 8 stops.

```bash
PLANNER_URL=https://<service-url> PLANNER_KEY=<key> node scripts/smoke.mjs
```

To run the service locally:
1. Build VROOM with `make USE_ROUTING=false` in `vroom/src`.
2. Preprocess a Singapore `.osm.pbf` with the `osrm-extract`, `osrm-partition` and `osrm-customize` tools from `node_modules/@project-osrm/osrm`.
3. Start the service:

```bash
OSRM_DATA=… VROOM_BIN=… PLANNER_KEY=test-key PORT=8088 node server.mjs
```

## Known limits

- **Singapore only.** Plans with a stop outside Singapore use the existing planner.
- **Driver rules come from company defaults.** Drivers are assigned later, at Dispatch, so per-driver overrides are not used. The driver break can be taken any time between 11:30 and 14:30.
- **Waiting time:** VROOM (up to v1.15) optimises travel time only. `improve.mjs` therefore re-optimises its solution with GoRouteX's objective (no violations, then least total route time including waiting, break and service, then travel), takes the driver break during long waits, and keeps VROOM's answer unless the result is strictly better. On the 18-stop smoke test, waiting dropped from 157 to 5 minutes for 30 more minutes of driving. Set `PLANNER_IMPROVE=0` to turn the second pass off.
- **Car profile.** Lorry restrictions are still checked at confirmation by the existing LTA check.
- **Order time windows and service minutes** from Order Hub narrow the customer's delivery hours for that plan (overlap of all orders at a stop; longest service time).
- **Vehicle capacity** is used only when capacity planning is on in Settings. There is then one route per active vehicle that has a capacity, and the orders' weight (weight mode) or quantity (pallet/carton mode) at each stop must fit. Stops without a load count as 0.
