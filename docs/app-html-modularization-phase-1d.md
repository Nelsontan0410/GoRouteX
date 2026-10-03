# APP.HTML MODULARIZATION V1 — PHASE 1D

## Extraction

Local only; production baseline supplied by Owner: `6abfb97a2650ffe07aa9e0dd`. Not contacted or changed.

| File | Bytes |
|---|---:|
| app.html before | 708,258 |
| app.html after | 663,521 |
| Removed | 44,737 |
| manual-assignment-page.js | 29,900 |
| manual-assignment-dnd.js | 16,484 |

57 declarations / 47 unique names moved verbatim. Ten duplicate declarations retain original ordering so trailing compatibility wrappers still win. New classic scripts contain declarations only. Remaining main-script AST is unchanged; generated assets match source.

## Function inventory

### A: page orchestration, rendering, slot controls

- `handleGoToManualAssignPage`
- `populateManualAssignmentLists`
- `renderDraggableList`
- `renderRouteSlots`
- `removeFromSlot`
- `getStayPresetValue`
- `buildStaySelectOptions`
- `getEmptyRouteSlotMarkup`
- `ensureRouteSlotSkeleton`
- `stopRouteSlotControlInteraction`
- `updateRouteSlotStay`
- `handleStayTimePresetChange`
- `handleStayTimeCustomChange`
- `getCombinedRouteSlotPositions`
- `getFirstEmptyRouteSlotPosition`
- `getAdjacentOccupiedRouteSlotPosition`
- `hasAdjacentOccupiedRouteSlot`
- `setManualAssignmentMessage`
- `addUnassignedStopToNextRouteSlot`
- `moveRouteSlotSequence`
- `attachRouteSlotControlListeners`
- `refreshManualAssignmentUi`
- `handleGoToManualAssignPageLegacy`
- `populateManualAssignmentListsLegacy`
- `renderDynamicManualRouteGroups`
- `attachUnassignedStopActionListeners`
- `renderDraggableListLegacy`
- `renderRouteSlotsLegacy`
- `removeFromSlotLegacy`
- `retrieveAllStopsFromRoutes`

### B: native drag/drop lifecycle

- `clearDraggedStopFromSource`
- `attachDragListenersToUnassignedList`
- `attachDragListenersToSlots`
- `handleSlotDragStart`
- `handleManualDragStart`
- `handleManualDragEnd`
- `handleSlotDragOver`
- `handleSlotDragLeave`
- `handleSlotDrop`
- `handleManualDragOver`
- `getDragAfterElement`
- `handleManualDrop`
- `attachDragListenersToSlotsLegacy`
- `handleSlotDragStartLegacy`
- `handleManualDragStartLegacy`
- `handleSlotDropLegacy`
- `handleManualDropLegacy`

### C: shared helpers retained

Planning state/slots remain in planning-state.js. Existing once-guarded control bindings, confirmation buttons, back controls and route-panel touchstart/touchend remain in planning-page.js. Shared grouping, optimization, direction-return ordering, map previews, route cache, safety and map detours remain in their original locations. Finalization, ETA, persistence, History and Dispatch handoff are unchanged.

### D: legacy/dead candidates retained

Earlier declarations of handleGoToManualAssignPage, populateManualAssignmentLists, renderDraggableList, renderRouteSlots, removeFromSlot, attachDragListenersToSlots, handleSlotDragStart, handleManualDragStart, handleSlotDrop and handleManualDrop are shadowed by trailing wrappers. Both declarations retained. The *Legacy implementations are ACTIVE.

clearDraggedStopFromSource and getDragAfterElement have no repository callers outside their declarations; retained for later review. No dead-code deletion.

## State and dependencies

planning-state owns manualRouteSlots, selections, unassignedStops and route/confirmation state. Page and DnD use its existing APIs; no second model. draggedItemElement / draggedItemOriginalListType remain initialized in app.html.

Page uses Stops cache, optional detail refresh, access guards, shared optimizer, DOM references and existing map preview/finalization helpers. DnD invokes page refresh; rendering binds DnD through existing globals. This existing callback relationship introduces no import cycle. History is reached through existing finalization/persistence, never a new drag handler.

DOM dependencies: page-manual-assign, routesSection, unassignedStopsList, dynamic route containers, route-slot children, Stay/Up/Down/remove/Add controls and messageBarPg2. Existing markup, capacities, numbering and handlers preserved.

### Phase 2 alias inventory

| Alias | Writers | Readers |
|---|---|---|
| manualRouteSlots | state build/reset/restore/setters; empty-page initialization | rendering, slot APIs, snapshots/finalization |
| manualRoute1Waypoints / manualRoute2Waypoints | state bootstrap/sync; retained shadowed drag declarations | legacy planning, ETA/print diagnostics, snapshots |
| window._activeRoutes | shared grouping/optimization, page fallback, state sync, manual preview | preview, detours, finalization |
| window._testRoutes | shared grouping, page fallback, finalization preparation | retained route rendering/debug code |
| AppState.plannedRoutes / window.plannedRoutes | bootstrap bridge, finalization, Retrieve All reset, app reset/history restore/legacy planning | persistence, ETA, rendering, printing/export, History |

Browser result: route1=[c,b], route2=[a], active=[[c,b],[a]], plannedRoutes===AppState.plannedRoutes. _testRoutes retains baseline snapshot semantics; it is not newly synchronized on every slot edit.

## Drag/drop and accessibility

Native dragstart/dragover/dragleave/drop/dragend preserved. Empty-target move and occupied-target swap preserve stay values. Unassigned-to-occupied displaces the old stop. Same-slot drop is a no-op. Up/Down skips empty positions; remove returns a stop once; Add uses first available slot.

No library or touch/pointer rewrite. Existing route-panel touch handlers and button alternatives remain. Full keyboard drag and live announcement support are existing accessibility gaps, documented for later work. Desktop Chromium was tested; no physical mobile-device verification claimed.

## Listener audit

- Startup ID-element registration metric: 87 -> 87; repeat initializeUIEventListeners remains 87.
- Manual live-node handlers, three stops/two groups: 105 -> 105. Two rerenders remain 105 in both versions.
- After unassign: 93 -> 93; repeat rerenders remain 93.
- After reassign and Planning -> Manual navigation: 107 -> 107 (the same baseline increase of two active handlers in both versions).
- New duplicate listeners: NO. Native DnD uses existing remove/add identity pairs.
- Dynamic cards/control children are replaced then rebound; detached nodes do not accumulate active handlers. No new document/window listeners or event delegation.

87 counts startup registration attempts on ID-bearing elements. 105/93 counts unique handlers on currently connected Manual Assignment nodes; these metrics are not additive.

## API / Firebase cost

All traffic intercepted locally with synthetic Owner/data. No production requests/credentials. Counts represent mocked logical service boundaries, not billed Firestore document counts. Stops/settings were warm; missing-detail refresh and enabled restriction-service traffic are not claimed covered.

| Action | Reads before/after | Saves before/after | Netlify before/after | Routing before/after | ETA before/after |
|---|---|---|---|---|---|
| Open | 0/0 | 0/0 | 1/1 | 1/1 | 0/0 |
| Drag A to B | 0/0 | 0/0 | 0/0 | 2/2 | 0/0 |
| Reorder | 0/0 | 0/0 | 0/0 | 2/2 | 0/0 |
| Unassign | 0/0 | 0/0 | 0/0 | 1/1 | 0/0 |
| Reassign | 0/0 | 0/0 | 0/0 | 2/2 | 0/0 |
| Finalize | 2/2 | 1/1 | 1/1 | 1/1 | 1/1 |

Finalization reads are one order query and one History refresh; save is one logical saveHistory invocation. Actual billed document costs are unmeasured. The full navigation harness intercepted nine billing-catalog requests in each version, all answered locally; one overlaps Open and one Finalize. No live Netlify or Stripe call was made.

**No increase, but the requested absolute zero-routing expectation is not true of the baseline.** Existing refreshManualAssignmentUi calls updateRouteLines, which debounces then requests uncached route previews. Removing this would alter behavior outside physical extraction. Unit tests preserve the preview hook; browser checks compare nonzero routing honestly. Existing Retrieve All calls syncSessionToCloud; existing detour handling may write device-local storage. No new autosave introduced.

## Finalization / browser checks

Actual finalization orchestration and persistence/enrichment execute with mock services: manual-check -> build -> safety -> render -> ETA -> order association -> persist -> Dispatch stable_fixture. One build, one ETA, one save; preflight unit coverage retained.

Owner login -> Planning -> Manual -> drag -> reorder -> remove/reassign -> Planning date change -> Manual -> finalize -> History -> standalone Dispatch URL: PASS. No uncaught page errors; complete before/after outputs equal. Real handoff navigates to /dispatch.html?planId=stable_fixture; destination intercepted, no Dispatch backend execution.

## Tests and build

- `node --test tests/*.test.mjs`: 199/199 PASS (191 existing + 8 new focused tests).
- Actual Node binary: /Users/nelsontan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
- `node scripts/build-site.mjs`: PASS; 99 public files.
- Syntax, exact moved-function parity, remaining-main AST and built-asset parity: PASS.
- Browser harness/results: /private/tmp/grx-phase1d-browser.mjs and /private/tmp/grx-phase1d-browser-results.json.
- Structural check: /private/tmp/grx-phase1d-verify.mjs.

## Files changed

- app.html: exact function extraction and two classic-script links.
- planning/manual-assignment-page.js: existing page rendering/controls.
- planning/manual-assignment-dnd.js: existing native DnD lifecycle.
- tests/manual-assignment-extraction.test.mjs: eight focused tests.
- docs/app-html-modularization-phase-1d.md: inventory and evidence.
- dist/app.html and dist/planning/manual-assignment-{page,dnd}.js: generated counterparts; build regenerates dist.

No unrelated source edits in this phase. Earlier local phases retained.

## Deployment

NOT DEPLOYED. No Netlify/Firebase/IAM/billing changes.

## Recommended next phase

Extract the existing Manual Map Preview lifecycle (debounce/cache/calculation/render coordination) as one behavior-preserving boundary, exposing current routing costs for later optimization.
