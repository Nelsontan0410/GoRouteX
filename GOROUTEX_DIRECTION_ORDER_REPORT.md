# Direction-order route planning report

## Delivered locally

The stop-selection settings now include two route arrangements:

- **Standard optimisation** remains the default and retains the existing Google waypoint optimisation and end-location behaviour.
- **Direction order · Return to start** visits direction groups in a dispatcher-selected order, then returns to a snapshot of the planned start point.

The default direction order is West → North → East → South. Each row has Move earlier and Move later controls. A settings change updates the summary and marks the plan as needing a new plan; it does not send a Google request.

## Direction-mode algorithm

1. The planner snapshots the resolved start latitude and longitude. A stop without usable coordinates stops direction planning with an explanation; it is never treated as coordinate `0,0`.
2. Bearings use a spherical calculation, including international-date-line normalization. Direction ranges are North `[315°, 360°) ∪ [0°, 45°)`, East `[45°, 135°)`, South `[135°, 225°)`, and West `[225°, 315°)`.
3. Stops at the start coordinate remain first in their original order. All other stops are grouped by direction and groups are processed only in the selected order.
4. Within one directional batch, the final delivery is selected toward the next directional group (or the return start for the final group). Google Directions optimises the remaining delivery waypoints on roads, with `optimizeWaypoints: true`. The delivery-capacity limit remains eight per route group, so each optimiser request contains at most eight delivery stops.
5. The resulting ordered sequence is split into the existing route groups without changing its order. The last group ends at the stored origin snapshot. Every delivery remains a Google stopover.

This keeps Google requests bounded by the number of eight-stop directional batches: at most `ceil(stop count / 8)` for the new ordering pass. Repainting, changing zoom, and showing a saved route do not repeat those requests. The cache key includes the start snapshot and each stop coordinate.

## Manual detours and state

Starting a direction plan when existing manual detour points are attached asks the dispatcher to confirm. Cancelling keeps the current route and detours. Confirming does not clear detours until the new direction plan has completed; it then clears only the affected old points because delivery legs have changed.

The return-to-start metadata is carried from manual preview through final planning, active-route storage, and route-history records. Older saved routes have no arrangement fields and continue to open as Standard optimisation without reordering.

## Validation performed

- Ran the full local test suite: 67 passing tests.
- Added tests for direction boundaries, origin-coordinate stops, default-order restoration, and date-line bearing calculation.
- Performed a JavaScript syntax check over all inline application scripts.

No production deployment, live Google Directions request, payment change, LTA restriction change, login change, or navigation-sharing change was made. The directional road-order behaviour still needs validation against the real stop samples you plan to collect, because routing quality depends on Google’s current road graph and traffic assumptions.
