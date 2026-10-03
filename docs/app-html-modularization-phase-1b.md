# App.html modularization V1 — Phase 1B

Production baseline: `6abfb97a2650ffe07aa9e0dd`. This phase is local only.

## Compatibility boundary

The three page files are classic scripts, loaded synchronously immediately before the existing main inline script. They contain only function declarations. They do not read state, attach listeners, or start work when loaded. Function names remain available to existing inline handlers and shared callers.

Each file declares its consumed global bindings in its `/* global */` contract. This is a temporary compatibility boundary: the app retains the same live global lexical variables, DOM references, caches, and AppState. No state snapshots or new store are introduced.

- Dashboard owns presentation, its existing summary request, cached refresh orchestration, and dashboard action bindings. It consumes the existing history presentation helpers, `dashboardDataPromise`, tracking summary state, AppState and access/navigation helpers.
- History owns route metadata presentation, filters, lists, selected-row actions and the persisted-plan-ID handoff. It consumes `routeHistory`, `selectedHistoryIndex`, filter/load flags and the existing loading/navigation helpers. Storage, pagination, writes, deletion, authorization and query implementations stay in app.html.
- Planning owns date/control presentation and the existing selection, assignment and confirmation event bindings. It consumes current form state, DOM references, shared permission helpers and existing planning callbacks. Optimizer, ETA, safety, Maps and route finalization implementations remain in place.

Shared History/Dashboard presentation dependencies remain explicit global function calls. This phase does not replace them with a new state architecture.

## Initialization and listener audit

`initializeUIEventListeners()` retains its original once-only guard. Five binder calls occupy exactly the original registration positions:

1. `bindHistoryPrimaryControls()`
2. `bindDashboardControls()`
3. `bindPlanningConfirmationControls()`
4. `bindHistoryFilterControls()`
5. `bindPlanningPageControls()`

These are internal registration helpers; the guarded initializer is their sole caller. They are not navigation or mount hooks. There are 52 moved startup registration sites and two existing per-render History item registration sites. History still creates fresh item nodes after clearing its list; their handlers stay attached only to those nodes.

No DOMContentLoaded handler, Auth callback, polling loop or data-loading entry point is added. Existing window exports remain at their original execution positions.

## Verification

- All 33 extracted function bodies are byte-identical to the pre-phase source.
- Replacing binder calls with their original bodies and excluding the extracted declarations produces an identical main-script AST.
- Original 177 tests pass; three new focused regression checks bring the total to 180/180.
- The new checks cover inert script evaluation, shared pending Dashboard reads, and stable History ID handoff without fetch/save calls.
- Local Chromium comparison uses synthetic Owner/profile/history/stop data with all external requests intercepted. This is a local behavior check, not a fresh production credential test.
- Dashboard, History and Planning outputs, logical service counters and listener registrations match before/after. Repeating the initializer twice retains 87 observed registrations on elements with IDs, with no increase.

Logical service reads in the local fixture:

| Entry | Before | After |
| --- | --- | --- |
| Dashboard startup | Profile 1, history 1, GPS summary 1, stops 1, settings 2 | Same |
| Open History after Dashboard | 0 additional | 0 additional |
| Enter Planning | 1 additional stops load | 1 additional stops load |

These are mocked service-call counts, not measured Firestore document billing. No real Firebase/Netlify/Maps/Stripe calls are made by the fixture.

## Build and release

The existing build now copies the dashboard, history and planning directories. Generated assets are verified against source. No deployment is performed.

Next safest boundary: the pure date, number and presentation formatting helpers still shared by app.html and the page scripts, without moving account resolution or storage ownership.
