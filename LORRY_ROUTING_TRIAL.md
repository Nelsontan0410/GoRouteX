# Selected LTA restriction avoidance trial

The existing delivery optimizer and delivery order are preserved. The opt-in layer is under **Route Settings → Avoid selected LTA restriction codes**. Select codes such as 4002; no vehicle type or dimensions are required. The implementation includes experimental bounded Google rerouting and waypoint-based navigation handoff. It is local code awaiting real-route and phone verification, not an exact-route navigation guarantee.

## Implemented

- Official LTA download/read → filtered normalized JSON, with checksum, source dates, code catalogue, diagnostics and atomic replacement.
- Development inspection at `/lta-debug.html`, defaulting to code 4002, with sign filters, IDs, limits and a Google map using the existing app configuration.
- Searchable, multiple-choice restriction codes with descriptions inside Route Settings. Selecting a code enables avoidance. Default selection is 4002 with avoidance initially off. Previous vehicle measurements are ignored; new settings contain only the toggle and selected codes. Settings and a rolling 100-event trial log are scoped to the signed-in user on this device and do not cloud-sync.
- Detailed Google step geometry extraction, encoded-polyline fallback, spatial grid candidate lookup, segment distance and heading analysis.
- Manual assignment and final planning use the same order-preserving route request definition. The manual page now runs the full Google route → selected-code check → bounded bypass → full-route recheck flow after a 400 ms edit debounce. Confirm waits for that work and reuses the checked geometry when its complete input signature is still current.
- Manual and final validation have separate versioned run contexts. A late manual response cannot overwrite a final route and vice versa; identical concurrent checks in one context are coalesced. Cache identity includes resolved coordinates, stop order, selected codes, LTA dataset hash and rule version.
- The manual page has a fixed restriction status panel for off, no-route, checking, safe, avoided and pending-review states. A failed or incomplete check can be saved and remains visibly marked for review, while navigation/share handoff remains blocked.
- WARNING/BLOCKED handoff prevention while enabled; all direct navigation, share generation, copy and WhatsApp route-share paths use the same gate. Turning the trial off restores existing behavior and records the toggle as an override event.
- Each map is bound to its own route collection: the manual map uses preview routes and final/preview/fullscreen maps use current final routes. Only selected-code conflicts from the bound current checks are pinned, including clear and suspected conflicts. No route means no restriction pins. Overview maps deduplicate the same LTA sign across routes. Route/code changes and rechecks clear invalid markers; successful bypass removes cleared conflicts. Map movement never reveals unrelated selected signs. Restored checks need revalidation before pins appear. All conflict pins are retained without the previous 500-sign display cap.
- On conflict, request alternatives for the affected delivery leg, derive one to three via points from a checked Google alternative, then recompute and check the full delivery route. Only accept a result preserving all delivery endpoints and passing the selected-code check. A failed attempt retains the original route and requires manual review.
- Navigation and share links preserve delivery and safety points. URLs split into ordered parts at delivery stops, each with at most three intermediate waypoints for mobile-browser compatibility. No point is silently truncated. The next part starts at the previous destination.
- Validation snapshots in existing history/active-route serialization. Restored snapshots are never treated as current approval: recheck before handoff.
- Approval invalidates on selected-code, ordered-stop or route-geometry changes; approval expires after 30 minutes. Data older than 14 days since preprocessing cannot yield SAFE.

## Verified source snapshot

Downloaded from [data.gov.sg](https://data.gov.sg/datasets/d_bbf0132c7290d6838f82003972d933d5/view) on 6 September 2026.

- Dataset: `d_bbf0132c7290d6838f82003972d933d5`
- Source publication shown by the portal: 1 September 2026; source period: October 2025.
- 144,613 features; 59,655,612 raw bytes.
- 7,128 retained signs; approximately 2.8 MB uncompressed compact JSON.
- SHA-256: `0fd1525a8b8ed0ef2b584a079bc38a0fc4dbdec730822772d7d17fa6c0f6969b`
- 17 raw records lack a code or description. They are counted as unclassified, not silently interpreted as irrelevant.
- Zero invalid coordinates or missing bearings among retained records. LTA specification v3.3 §16.37 note 4 defines bearing along traffic flow except 1014 and 4006; those exceptions are not used as travel bearings.

| Code | Description / extracted condition | Count |
|---|---|---:|
| 4002 | Exceeding 2500 kg unladen weight | 435 |
| 1011 | Restriction on lorry | 635 |
| 1012 | Restriction on vehicles with 3 or more axles | 24 |
| 1005 | Width limit, numerical limit unknown | 3 |
| 1006 | Weight limit, numerical limit unknown | 218 |
| 1007 | Height limit 4.5 m | 2,560 |
| 1036 | Restriction on lorry/bus/coach | 67 |
| 1069 | Maximum laden weight 30 tonnes | 1 |
| 4004 | Except authorised vehicles | 1,126 |
| 4007 | Vehicles NOT exceeding 2500 kg unladen weight | 498 |
| 4010 | Except loading/unloading | 78 |
| 4136 | No movement of vehicles with 3 or more axles | 1 |

Other actual height-limit codes: 1031 (4.3 m), 1033 (2.5 m), 1035 (3.8 m), 1047 (3.2 m), 1050 (2.1 m), 1053 (2.2 m), 1058 (5.4 m), 1062 (3.9 m), 1076 (unknown X.X m), 3132 (2.5 m), 3133 (3.7 m), 3195 (3.0 m), 3414 (2.0 m). Advance-warning height signs are separately labelled. The generated `catalogue` contains every observed code/description/count, including excluded types, to make updates auditable.

The GeoJSON uses **TYP_NAM as code** and **TYP_CD as description**. The parser isolates this source mapping. `FMEL_UPD_D` is retained as an uninterpreted source timestamp; no timezone is invented.

[LTA GIS Data Collection Specification v3.3, section 17.1.4](https://www.lta.gov.sg/content/dam/ltagov/industry_innovations/industry_matters/development_construction_resources/Street_Work_Proposals/Standards_and_Specifications/GIS_Data_Hub/gis_data_hub_data_collection_specification_v3.3.pdf) identifies 4002, 4004, 4007 and related codes as supplementary traffic signs. They are not independently treated as complete legal restrictions. Selecting these codes means a user preference to avoid their sign locations, regardless of vehicle applicability.

Example official 4002 record: ID **125153**, latitude **1.3225538899525182**, longitude **103.83897136108114**, source bearing **56.03055766**.

## Accuracy boundaries

Current source records do not expose a parent-sign ID, road-segment ID, road level, or numerical limit beyond values explicitly present in descriptions. General directional and time-only plates are not retained unless their descriptions match the commercial/context filter; the complete code catalogue is retained for follow-up investigation. This is not a complete legal restriction model.

Only selected codes are checked. A 35 m segment corridor finds review candidates. Detailed geometry passing within 12 m, entering the sign vicinity and agreeing within 35 degrees of the documented travel bearing produces HIGH/BLOCKED for the user's avoidance preference. Other nearby selected signs produce WARNING. This does not certify same-road or legal applicability: parallel roads, overhead roads and supplementary-sign context remain unresolved. A verified different road or verified same-road reverse direction can exclude a sign; the shipped records lack road-segment IDs. These thresholds require practical calibration.

No-overlap SAFE means no selected-code conflict found within the available data and geometry. Empty selection, a selected code missing from the compact dataset, incomplete geometry, out-of-Singapore geometry and stale/unavailable data produce WARNING. Both WARNING and BLOCKED prevent handoff while avoidance is enabled.

Automatic bypass has a hard limit of **three extra routing requests** per route per check, including the alternative search. It handles the first identifiable conflict leg; the full recheck must also clear all other selected conflicts. It does not exhaustively search Singapore's road network. Additional requests use the existing Google Directions service and may incur normal API charges. Route/code edits during a request cancel acceptance of that result.

Google Maps URLs accept coordinates and waypoints, not our full checked polyline or a custom list of prohibited signs. Google can recalculate; some products do not support waypoints. Safety points may appear as stops in external Google Maps, although they are pass-through points in the internal route. Ordered parts require the driver to open the next part. Exact navigation equivalence and avoidance after a driver deviates cannot be guaranteed. See [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) and [Directions alternatives](https://developers.google.com/maps/documentation/javascript/legacy/directions).

Trial logs retain stop order, driver identifier, selected codes, before/after conflict counts, safety waypoints, request count, status, source version and override events. They do not retain a full Google response/polyline. Establish permitted retention and storage strategy before using full route geometry for long-term operational comparisons. Existing route history persistence remains in place.

## Refresh and inspect

Requires Node 20+; no new npm dependencies.

```sh
npm run lta:update
npm run test:lta
```

For a previously downloaded official file:

```sh
npm run lta:update -- --input /path/to/LTATrafficSign.geojson --source-period 2025-10 --source-published 2026-09-01
```

Supply publication metadata only after checking the portal for that download. A refresh without those options reports the source period/publication as unknown, rather than reusing potentially incorrect dates. `generatedAt` always records preprocessing time, not when LTA last surveyed a road.

Run the updater weekly as an admin process, then publish the compact file with the app. Scheduling/deployment is not configured by this change. Downloads, parse failures, missing 4002 records, invalid relevant coordinates or duplicate IDs do not replace the last valid output. A greater-than-20% count drop requires review via a separate `--output` file. The raw 59.7 MB file is not included in the webapp.

Serve the project with the existing local server and open `/lta-debug.html`. The Google map requires a referrer already allowed by the existing key. Local verification returned **RefererNotAllowedMapError** for `http://127.0.0.1:8765/lta-debug.html`; the code reports this and keeps the table usable. No key permissions were changed.

`/tests/lorry-safety-harness.html` is a synthetic integration harness with its own test storage namespace. `/tests/manual-safety-ui-harness.html` and its 390 px iframe wrapper verify the fixed manual status layout. `/tests/west-coast-live-route-harness.html` requests the stated Toh Guan → Pandan Loop → Third Lok Yang → Toh Guan route without saving it. Test fixtures should be excluded from a production publish if not wanted.

## Verification and next trial

Automated tests cover official field mapping, malformed inputs, coordinate order, missing bearings, selected-code filtering, step/encoded geometry, long-segment matches, direction confidence, changed/restored approvals, network failures and disabled behavior. The compact-data regression test confirms West Coast sign 120054 remains code 4002 at latitude 1.3143747913860258, longitude 103.7548210862709, bearing 38.27819222. Mock routing tests check request limits, cancellation, failed alternatives, preserving delivery endpoints/order, and retaining every safety/delivery point across mobile URL parts. Mock map tests verify zero pins without routes, manual-map ownership independent of AppState, conflict-only pins, deduplication, removal after code/route changes or successful bypass, clearing on recheck, and no unrelated pins after map movement. Context tests cover independent cancellation, same-input request coalescing and manual-to-final result reuse.

Browser checks cover desktop and 390 px mobile rendering of the fixed manual status panel, including the 120054 conflict reason without checkbox/content overlap. Existing inline application scripts pass syntax checks. The Google key rejects the localhost West Coast harness with `RefererNotAllowedMapError`, so no real Directions geometry or live rerouting result is claimed from this environment. No API key permissions were changed, nothing was deployed, and the signed-in production workflow and actual phone navigation have not been exercised.

Before operational use, replay historical fine locations with known travel directions, compare detections and false warnings, and inspect successful detours on real Google responses. Test every ordered URL part on drivers' iOS/Android Google Maps, including whether safety points are retained after recalculation. The synthetic tests establish program behavior, not real-road avoidance accuracy.
