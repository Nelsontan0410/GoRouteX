# GoRouteX Phase 1 and Phase 2 fix report

## Scope completed

- Restriction validation and navigation permission are now separate. A route with Google directions but no completed restriction check is **Pending**, never **Safe**. Restriction reminders still do not block sharing or navigation.
- Every active page-3 navigation and share handoff uses the same segmented Google Maps builder. It preserves delivery points and manual navigation points in order, using no more than three intermediate waypoints per mobile link.
- Colour-coded route legs use encoded Google step geometry when `step.path` is absent. The custom route polylines are non-clickable so map clicks can create manual detour points directly on a visible route.
- Manual detour drafts are now keyed by signed-in account, origin, configured end, route group, ordered stops, and resolved stop locations. This prevents a temporary draft from being reused for a different account or route.
- While the route is recalculating, the detour picker and add button are disabled and the toolbar says **Recalculating route…**.
- Removed the customer-facing Dynamic Route Engine test button. Mobile navigation now uses **Plan** and **Stops**, and the map preview explains that delivery legs are colour-coded.
- Plan and access wording no longer presents preview-only live tracking or insights as operationally available. Dashboard storage status resolves its plan through the same product-plan function used by the dashboard.

## Validation completed

- JavaScript syntax checks passed for `route-safety.js` and `map-handler.js`.
- Automated suite: **51 passed, 0 failed**.
- Added regression coverage for unchecked-versus-safe status, encoded step geometry, account/route-scoped drafts, route-overlay clickability, and shared segmented handoff usage.

## Not performed

- No deployment, payment action, account change, saved-route creation, WhatsApp send, or production-data mutation.
- Real Google Maps mobile handoff, full browser viewport QA, and cloud account switching remain in the out-of-scope issue log because they need a controlled test environment.
