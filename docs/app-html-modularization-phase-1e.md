# APP.HTML MODULARIZATION V1 — PHASE 1E

## Scope / extraction

Local only, NOT DEPLOYED. Owner-supplied production baseline 6abfb97a2650ffe07aa9e0dd was not accessed or changed.

- app.html: 663,521 -> 641,989 bytes; removed 21,532 bytes.
- planning/manual-map-preview.js: 22,510 bytes.
- No other production module extracted.
- Eleven existing function bodies copied byte-for-byte, plus the original guarded Manual map creation block moved into initializeManualMapPreview(element, needsInit).
- Classic declaration-only script. Existing bootstrap computes the same guards at the same position and calls the initializer. Shared optimized-map creation, services/autocomplete/renderers remain in the existing shared initializer.

### Explicit existing API

initializeManualMapPreview(element, needsInit); updateRouteLines(options); addSimpleMarkersForMasterList(stops); clearRouteLines(); ensureManualRouteCheckCurrent() for finalization's existing review boundary. Manual Assignment already calls these named global functions: no new facade/state store or binding timing change. Active DnD calls refreshManualAssignmentUi in the controller, which calls preview update; DnD owns no routing algorithm. Retained shadowed DnD declarations still reference the same old helper, not activated.

### Exact moved functions

- `clearMasterListPreviewMarkers`
- `clearRouteLines`
- `renderManualRestrictionStatus`
- `clearManualRouteDrawing`
- `drawManualPreviewRoutes`
- `getManualRouteInputKey`
- `calculateManualRouteLines`
- `updateRouteLines`
- `ensureManualRouteCheckCurrent`
- `createManualStopMarker`
- `addSimpleMarkersForMasterList`

Generic coordinate parsing/jitter, MapHandler adapters, route-leg rendering, route caches, detour editing/persistence, optimized/final rendering and page lifecycle remain where they were. No finalization/ETA/History/persistence/Dispatch implementation moved. No optimization added.

## Routing inventory (before edits)

| Trigger | Path | Classification | Calls / reuse / overlap |
|---|---|---|---|
| Open Manual | handleGoToManualAssignPageLegacy -> generateOptimizedActiveRoutesFromSelection | A: initial ordering; shared implementation retained | Fixture total Open=1. Direction-return can make more calls; not generalized to all data. |
| Open/page return | showPage and page controller -> updateRouteLines -> calculateManualRouteLines -> MapHandler.route | A/B/C | Per uncached active group. Completed-key/in-flight-key gates already exist; parallel triggers for identical key share promise. |
| Drag/reorder/remove/Add | DnD/control -> refreshManualAssignmentUi -> updateRouteLines | A/C | Drag=2, reorder=2, unassign=1 in two-group fixture. Existing 400ms delay; unchanged routes may reuse Directions result. |
| Same input again | updateRouteLines | B, already avoided | 0 in before/after browser fixture; completed preview is redrawn. |
| Manual detour/restriction change | existing detour/restriction handlers -> updateRouteLines | A/C | Changed input may route affected groups; enabled safety may perform additional work. Not counted by disabled-safety fixture. |
| Explicit confirm | ensureManualRouteCheckCurrent -> preview when not current; RouteEngine.buildPlannedRoutes | D | Finalize fixture has one mocked build/routing and one ETA. Finalization retains existing cache/review behavior. |
| Suggestion/debug | showOptimizedRouteSuggestion / forceShowOptimizationSuggestion | E/legacy | Can call Directions for suggestion; retained outside this extraction. Not newly invoked on module load. |
| Route-engine / MapHandler.route | shared order-preserving request builder and provider adapter | E | Generic infrastructure retained. |

A single calculation iterates route groups sequentially. Different generations can overlap if a newer edit starts while a previous Directions request is in flight. Existing run IDs suppress stale results but do not cancel paid provider work. Repeated same-input update is already deduplicated; do not claim it is currently an unconditional duplicate.

Markers can geocode missing coordinates via existing MapHandler.geocode. The marker fixture uses coordinates; geocoding counts are not claimed measured. No Firestore save from preview.

## Request identity

Outer getManualRouteInputKey JSON includes origin location; configured end ID/location; ordered routes' stop-ID cache keys and resolved stop locations; manual waypoints; arrangement mode; direction order/origin snapshot; returnToOrigin; RouteSafety.settings() and rulesVersion. Driver/vehicle labels are not independently included; restriction settings influence this key. Do not invent a new vehicle key in this phase.

Directions identity comes from RouteEngine.buildRouteRequest: originIdentifier + ordered stop IDs + configuredEndId + serialized resolved origin, destination, interleaved delivery/manual waypoints. optimizeWaypoints=false and travelMode=DRIVING. Slot order and route-group boundaries influence the sequence and downstream route origins. Stay durations are not independently in this Directions key.

Both existing completed/in-flight preview keys and per-route Directions result keys are preserved. No new cache created.

## Stale-response audit

Protection exists: YES, with limits.

manualRouteRun increments on changed preview; calculateManualRouteLines checks the run before each group, after awaited Directions, before publishing and after safety validation. Late Directions results cannot replace the newer preview; regression test confirms this. updateRouteLines catch/finally also check run. Marker rendering has masterListMarkerRenderRequestId checks after geocoding and before publishing; late cluster results are cleared.

Already-started network requests are not aborted. Safety validation and shared-object mutations need separate Phase-2 analysis: run guards are not a blanket transactional isolation guarantee. Account/page-exit invalidation and missing-map re-entry deserve lifecycle coverage rather than assuming cancellation exists. No redesign here.

## Map lifecycle

Shared initializeActiveAppMapsAndServices waits for Maps, checks readiness, resolves DOM and computes manualMapNeedsInit = element && (!mapPage2 || missing .gm-style). The extracted initializer preserves the original guarded creation, center/zoom/map ID, renderer resets, safety pins and detour click binding. Existing map and intact DOM are reused; missing map DOM permits intentional recreation.

bindManualDetourMap remains with the detour controller: removes prior map click listener before attaching replacement. Unit test initializes once and repeats false needsInit twice: maps=1, bindings=1. No new map/document/window listener is introduced.

Markers: clear old cluster/markers before rendering, create pins, fit bounds, keep only latest asynchronous cluster. Polylines: clearManualRouteDrawing clears legacy/dynamic renderers before drawing route legs; no map destruction on each redraw. Shared resetActiveMapArtifacts clears markers/clusters/renderers; account UI unmount resets map/service references. Existing shared cleanup behavior is preserved, not expanded.

Browser checks use mocked Maps adapters (not live Google tiles); actual route order and stale-response behavior additionally have VM tests. No physical-device or production-map claim.

## Listener audit

- Base ID-element registration metric: 87 -> 87; repeated base initialization remains 87.
- Manual connected-handler metric: 105 -> 105; repeated render remains 105.
- Unassigned fixture: 93 -> 93, stable across rerenders.
- Re-entered page: 107 -> 107, matching previous baseline.
- Duplicate map listeners introduced: NO; original remove/rebind detour behavior preserved.
- Metrics describe different populations and are not additive totals.

## API / Firebase cost (local logical boundaries)

| Scenario | Reads before/after | Saves before/after | Netlify before/after | Routing before/after | ETA before/after |
|---|---|---|---|---|---|
| Open | 0/0 | 0/0 | 1/1 | 1/1 | 0/0 |
| Drag | 0/0 | 0/0 | 0/0 | 2/2 | 0/0 |
| Reorder | 0/0 | 0/0 | 0/0 | 2/2 | 0/0 |
| Repeat same preview input | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| Unassign | 0/0 | 0/0 | 0/0 | 1/1 | 0/0 |
| Finalize | 2/2 | 1/1 | 1/1 | 1/1 | 1/1 |

Any increase: NO. Reads = one order query + one History refresh at finalize; save = one logical saveHistory. Not billed Firestore document counts. Netlify entries are existing billing-catalog fetches answered locally; no live Netlify/Stripe request. Preview module has no direct Netlify or Firestore write. Full navigation fixture intercepts nine billing-catalog calls in each version. Only finalization saves; no new passive persistence.

## Phase-2 cost opportunities (not implemented)

| Evidence | Current | Potential target | Risk |
|---|---|---|---|
| Same completed/in-flight input | 0 new calls / shared promise | Keep 0; avoid redundant drawing only | Must redraw after map recreation or safety change. No network saving to claim here. |
| Two groups on changed drag/reorder | 2 calls in fixture | Reuse any provably unchanged request; 0 for revisiting an exact retained signature | Moving a boundary changes next group's origin; both calls may be necessary. No promise of reducing every drag. |
| Rapid edits while work is in flight | Multiple generations can overlap; 400ms already batches pending edits | Only newest required generation where feasible | Directions may not be cancellable after submission; explicit confirm must not wait forever. Burst savings not measured. |
| Cached signature retention | Current per-route result reused only when identity retained | Reuse matching prior signatures after reversals | Bounded storage, coordinate/road/settings/version freshness and tenant isolation needed. |
| Finalization | Fixture build=1, ETA=1; real engine already supports preview-result cache reuse | 0 new Directions when exact final request is proven identical; ETA remains required | Cannot reuse stale safety or wrong route boundaries. Mock build is not proof of a real redundant Directions call. |
| Map redraw without route change | Redraw can occur despite 0 network calls | Render only when map/route/safety presentation changes | Avoid missing pins after remount or changed conflicts. |

## Legacy dependencies

Preview reads _activeRoutes from planning-state synchronization and writes it when calculation completes. manualPreviewRoutes and run/promise/cache variables remain in existing bootstrap storage. It consumes existing shared slot sync, mapPage2, previewDirectionsService, marker/cluster/render arrays, detour state and restriction settings. It does not add direct window.plannedRoutes, _testRoutes or AppState ownership; existing slot sync updates Route 1/2 aliases transitively. Finalization retains all existing aliases and stable planId ownership.

## Tests / build / browser

- Exact suite command: `node --test tests/*.test.mjs`.
- Actual runtime: `/Users/nelsontan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.
- Result: 207/207 PASS (199 baseline + 8 preview tests).
- Existing source-location assertions follow moved functions without changing asserted behavior.
- `node scripts/build-site.mjs`: PASS, 100 public files.
- Acorn: declaration-only module, 11 byte-identical bodies, initializer block substitution, unchanged remaining-main AST. Built source parity PASS.
- Mock Chromium: Owner login -> Planning -> Manual preview -> Drag -> Reorder -> identical-input repeat -> finalize -> History -> real stable-ID Dispatch URL (destination intercepted): PASS. Before/after complete outputs equal, no uncaught errors.
- Finalize once, save once, stable_fixture handoff unchanged.
- Evidence: /private/tmp/grx-phase1e-browser-results.json; /private/tmp/grx-phase1e-browser.mjs; /private/tmp/grx-phase1e-tests.log; /private/tmp/grx-phase1e-verify.mjs.

## Files changed

app.html; planning/manual-map-preview.js; tests/manual-preview-wiring.test.mjs (source locations only); tests/manual-map-preview.test.mjs; this report. Generated dist/app.html and dist/planning/manual-map-preview.js. Existing assignment, DnD, planning-state, finalization and persistence modules unchanged in this phase.

## Deployment

NOT DEPLOYED. No environment, cloud data, billing or IAM modifications.

## Next phase: APP.HTML MODULARIZATION V1 — PHASE 2

Stop Phase-1 physical extraction here. Top three evidence-based targets:

1. Consolidate route identity/state ownership across slots, _activeRoutes, _testRoutes and plannedRoutes; prerequisite for safe reuse.
2. Profile request overlap and reuse exact Directions signatures across edits/finalization while retaining run guards and safety freshness.
3. Unify map/listener lifetime with lazy page mounting, including account exit/remount, avoiding needless redraw or reinitialization.
