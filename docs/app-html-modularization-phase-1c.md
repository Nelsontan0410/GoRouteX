# App.html modularization V1 — Phase 1C

Production baseline: `6abfb97a2650ffe07aa9e0dd`. NOT DEPLOYED.

## Scope and compatibility

Three classic scripts now own the existing Planning state, finalization orchestration and persistence glue. Their function declarations are installed before the main inline script. No listener, request or finalization runs merely because these scripts load.

Planning-state declares the existing mutable lexical bindings. Six bootstrap functions assign their original values and bridge AppState at exactly their former execution positions in app.html. This preserves dependencies on existing constants, cached settings, localStorage, getPreferredPlanningTime and createEmptyRouteSlots. They are startup-only calls, never page-entry or reinitialization hooks. The shared AppState object and its setter event remain unchanged; window.plannedRoutes retains the same array identity.

Existing functions and global names remain the compatibility API used by Planning UI. No Store, EventBus, duplicate route-storage implementation or new schema is introduced.

## Preserved finalization sequence

1. Existing input validation and slot synchronization (including the existing skipPreflight behavior).
2. Await the current manual route/safety check.
3. Prepare UI and reset the generated-route reference as before.
4. Call existing RouteEngine.buildPlannedRoutes().
5. Await RouteSafety.validateRoutes with final context, reuse true and forceRefresh false.
6. Render the existing result and return on render failure.
7. Call the existing ETA generator with print false.
8. savePlannedRoutes calls saveCurrentRouteToHistory only when saveAfterPlan is true.
9. Validate existing save prerequisites and usage; resolve the current user without a new profile read; read selected orders or the same date query; run the existing route enrichment.
10. Prepare the same finalized snapshot; call RoutePlannerStorage.saveHistory once.
11. Preserve returned ID, in-memory history update, local usage increment, confirmation state, selected-order clearing and UI refresh. Keep the existing scheduled background history refresh.
12. Require the saved ID, then open dispatch.html?planId=<id>.

The relative import of route-enrichment changes from ./driver/route-enrichment.js to ../driver/route-enrichment.js because the caller now lives in planning/. The destination module is unchanged. Local browser verification confirms orderLinkStatus LINKED and linkedOrderCount 1.

Preview and failure branches are preserved, including skipping persistence for a preview and blocking handoff when no saved ID is returned. This phase does not add stricter safety policy or alter the existing behavior when validation returns a result.

## Dependencies

- planning-state consumes existing planning defaults, DOM/UI callbacks, slot metadata helpers, AppState, localStorage and the current settings/date preference readers. Slot synchronization still invokes the existing detour/safety helpers.
- route-finalization consumes Planning bindings and slot API; existing permissions/usage checks; RouteEngine, RouteSafety, ETA helper; UI/MapHandler/DOM references; and planning-persistence functions.
- planning-persistence consumes RoutePlannerStorage, current-user lookup, existing Firebase order reads, GoRouteXOrderPlan, driver route-enrichment, history cache/refresh helpers, selected-stop state, location/route snapshots and existing date/usage helpers.

All relevant shared callers continue to use the same function names. Generic storage, Auth, account context, optimizer, ETA and safety implementations were not edited.

## Globals inventory

Categories can overlap; Phase 2 candidates are cleanup targets, not changes made here.

### A — Planning-only state now owned by planning-state

- `selectedAddresses` — existing lexical binding, still consumed by app.html/page helpers.
- `selectedCustomers` — existing lexical binding, still consumed by app.html/page helpers.
- `unassignedStops` — existing lexical binding, still consumed by app.html/page helpers.
- `manualRoute1Waypoints` — existing lexical binding, still consumed by app.html/page helpers.
- `manualRoute2Waypoints` — existing lexical binding, still consumed by app.html/page helpers.
- `manualRouteSlots` — existing lexical binding, still consumed by app.html/page helpers.
- `routeOriginMode` — existing lexical binding, still consumed by app.html/page helpers.
- `routeStartTime` — existing lexical binding, still consumed by app.html/page helpers.
- `planningDate` — existing lexical binding, still consumed by app.html/page helpers.
- `selectedVehicleDriver` — existing lexical binding, still consumed by app.html/page helpers.
- `vehicleDriverItems` — existing lexical binding, still consumed by app.html/page helpers.
- `vehicleDriverCloudLoadPromise` — existing lexical binding, still consumed by app.html/page helpers.
- `customOriginAddress` — existing lexical binding, still consumed by app.html/page helpers.
- `customOriginLatLng` — existing lexical binding, still consumed by app.html/page helpers.
- `customOriginLabel` — existing lexical binding, still consumed by app.html/page helpers.
- `customOriginAutocomplete` — existing lexical binding, still consumed by app.html/page helpers.
- `routeEndRequired` — existing lexical binding, still consumed by app.html/page helpers.
- `routeEndMode` — existing lexical binding, still consumed by app.html/page helpers.
- `customEndAddress` — existing lexical binding, still consumed by app.html/page helpers.
- `customEndLatLng` — existing lexical binding, still consumed by app.html/page helpers.
- `customEndLabel` — existing lexical binding, still consumed by app.html/page helpers.
- `customEndAutocomplete` — existing lexical binding, still consumed by app.html/page helpers.
- `routeArrangementMode` — existing lexical binding, still consumed by app.html/page helpers.
- `directionOrder` — existing lexical binding, still consumed by app.html/page helpers.
- `directionOriginSnapshot` — existing lexical binding, still consumed by app.html/page helpers.
- `directionPlanRun` — existing lexical binding, still consumed by app.html/page helpers.
- `directionPlanStale` — existing lexical binding, still consumed by app.html/page helpers.
- `currentLocationRequestToken` — existing lexical binding, still consumed by app.html/page helpers.
- `currentRouteConfirmationState` — existing lexical binding, still consumed by app.html/page helpers.
- `suggestedWaypointOrder` — existing lexical binding, still consumed by app.html/page helpers.
- `currentViewingRouteIndexPage3` — existing lexical binding, still consumed by app.html/page helpers.
- `activeRouteId` — existing lexical binding, still consumed by app.html/page helpers.

Planning-only state still in app.html includes directionOptimisationCache; manualPreviewRoutes; manualRouteUpdateTimer/manualRouteRun/manualRoutePromise/manualRoutePendingResolve/manualRouteInFlightKey/manualRouteCompletedKey; manualDetoursByRouteKey and detour interaction flags; route renderers/markers; selected-route DOM references; DEFAULT_ROUTE_START_TIME, MAX_WAYPOINTS_PER_ROUTE and other existing constants. Algorithms and map lifecycle stay where they are.

### B — Shared application state/services

AppState / window.AppState; allCustomerEntries; addressNameMap; addressToInitialIndexMap; routeHistory and selectedHistoryIndex; sessionRestorePromise, lastLocalSessionUpdateMs and lastAppliedCloudSessionUpdateMs; currentUserProfile; RoutePlannerStorage; FirebaseApp; GoRouteXOrderPlan; GoRouteXSettings. Existing read/write ownership and cache semantics remain in place.

### C — Legacy compatibility

window.plannedRoutes (GPS compatibility alias); window._activeRoutes (manual planning representation); window._testRoutes (existing planning alias); manualRoute1Waypoints/manualRoute2Waypoints; currentViewingRouteIndexPage3/activeRouteId; global openDispatchPage and confirmation callbacks used by inline/UI callers.

### D — Phase 2 cleanup candidates

Duplicate representations across AppState.plannedRoutes/window.plannedRoutes/window._activeRoutes/window._testRoutes; fixed Route 1/2 aliases alongside dynamic slots; repeated legacy wrapper declarations in the manual assignment code; direct cross-page DOM/global dependencies; session timestamp/cache ownership. These remain unchanged.

## Embedded Dispatch audit

Removed: NONE.

There is no active dispatchBoard container or embedded Dispatch polling/driver selector here. The old page-optimized-routes path already forwards to standalone Dispatch. Legacy optimized-route rendering and print helpers still have Planning/ETA callers and are retained. saveActivePlannedRoutesToCloud has no current repository caller; it is retained as an existing GPS/active-route compatibility helper because this phase has not established that standalone Dispatch replaces every former consumer. No speculative deletion was made.

## Verification and cost

The original 35 function bodies match exactly, except the necessary relative import relocation. Expanding the six state initializers reproduces the original assignments and AppState bridge in the same sequence. The remaining main-script AST is unchanged.

Local Chromium uses a synthetic Owner with all requests intercepted. It verifies the login form, Dashboard, Planning entry, one assigned stop, real snapshot/order-enrichment/persistence orchestration, History and navigation to Settings, Order Hub and standalone Dispatch. Rendering, routing, safety service and ETA work use controlled substitutes for this comparison. No production credentials or production API calls are used.

Before/after browser results are identical, with no page errors. Observed element listener registrations remain 87 after repeated initialization. New module evaluation makes no calls.

| Logical call | Planning entry, before / after | One finalization, before / after |
| --- | --- | --- |
| Profile reads | 0 / 0 | 0 / 0 |
| Stop reads | 1 / 1 | 0 / 0 |
| Order reads | 0 / 0 | 1 / 1 |
| RouteEngine build | 0 / 0 | 1 / 1 |
| ETA generator | 0 / 0 | 1 / 1 |
| Finalized-history save | 0 / 0 | 1 / 1 |
| Scheduled history reload | 0 / 0 | 1 / 1 |
| Mock persistence writes | 0 / 0 | 1 / 1 |

The save and mock-write rows represent the same operation, not two writes. These are logical fixture counts, not measured production Firestore document billing or internal Directions counts. Functions/Maps/Stripe production calls: zero. No increased calls or passive finalization.

## Tests and build

Run the full suite with node --test tests/*.test.mjs. Original 180 tests are retained; new focused tests exercise default values, AppState reference identity, slot API, UI callback wiring, finalization order, safety failure, ETA/save counts, preview behavior, missing ID and repeat initialization. Two pre-existing source-location assertions now read the extracted finalization file without changing their assertions.

The existing build already copies planning/*.js; no build-script change is needed.

## Sizes

app.html: 758,190 → 708,258 bytes (49,932 removed).

- planning-state.js: 12,904 bytes
- route-finalization.js: 19,485 bytes
- planning-persistence.js: 20,578 bytes

## Next boundary

Extract the manual-assignment page controller and its drag/drop interaction lifecycle, preserving the current slot API and keeping routing algorithms separate.
