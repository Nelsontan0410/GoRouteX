# GoRouteX business-readiness audit — 16 September 2026

## Scope and conclusion

Audit of the live homepage, login, signup, signed-in stop selection, dashboard, Plan & Access, history loading and map preview using Computer Use, plus local source inspection and isolated reproductions. The user signed in during the audit. An existing saved plan loaded successfully and its road geometry displayed in multiple colors. No new route was confirmed, no messages were sent and no payment or actual mobile-device journey was completed. Local source is not assumed to match production. No application changes or deployment were made.

Recommendation: prepare a small, supported business pilot before offering self-service paid subscriptions. The product has a useful core, but reliability, billing and account permissions need stronger acceptance tests. The existing 47 automated tests pass; they do not establish business readiness.

## Findings and fixes, in priority order

| Priority | Evidence | Finding | Required change / acceptance |
|---|---|---|---|
| P0 before self-service payment | Historical local audit, 16 September 2026 | The audited build had an unimplemented payment webhook. | Superseded by the Stripe implementation report. Before production use, configure Stripe test mode, price refresh, webhook delivery and Firestore rules, then run the documented end-to-end test matrix. |
| P1 route correctness | Isolated execution of `app.html` navigation function | With restrictions off and no detour, an eight-delivery-stop route produced seven intermediate waypoints in one URL. Mobile-browser support is up to three. | Use the same segmented link builder for every route and share action. Verify each delivery and manual point appears in order across parts on actual phones. |
| P1 honest status | Isolated execution of `RouteSafety.summary` | A route marked NOT_CHECKED is summarized as SAFE because permission to share is reused as evidence of a successful check. | Separate navigation permission from validation status. Unchecked, expired and failed checks remain visibly distinct; sharing continues as requested. |
| P1 map accuracy | Isolated execution of `MapHandler.renderRouteLegs` | Encoded-only step geometry falls back to a straight start-to-end line. The restriction geometry extractor already supports decoding. | Decode valid step polylines; if geometry is unavailable show that explicitly. Test saved-route formats and ensure displayed bends match road geometry. Actual frequency in saved customer data is unverified. |
| P1 commercial access | Local `firestore.rules` | Owner access to ordinary user subcollections does not enforce paid storage entitlement or route quotas. Profile role is writable by the owner. | Enforce paid operations and quotas in a trusted backend/rules where appropriate; define which roles users may edit. Test cross-account denial and concurrent quota use. This is not proof of cross-user data exposure: owner checks and admin claims already exist. |
| P1 persistence isolation | Local `app.html` detour cache | Temporary detours use one session key and route/customer IDs, without account identity or origin/end identity. | Namespace drafts by authenticated account and full route identity. Verify account switch, origin change, back/forward, reorder, reload, history restoration and explicit clear. |
| P2 sales clarity | Live homepage and login | Homepage says Basic is device-only; login says cloud-synced across all devices. Paid cards contain plan labels but no actual prices. | Show consistent storage promises, a clear price or Request a Quote, included limits and a working purchase/contact path. |
| P1 storage confidence | Signed-in dashboard and Plan Details, after history loaded | The same ProPlan account shows Device-only storage on the dashboard and Cloud sync in Plan Details. | Derive both from the actual storage adapter; label loading/fallback honestly. This observation establishes inconsistent labels, not actual loss of cloud persistence. |
| P2 feature readiness | Signed-in Plan & Access | Live Route Tracking says Available now in Feature access and Coming Soon in the comparison table on the same page. | Use one readiness definition and hide unavailable operational actions. |
| P2 map clarity | Signed-in saved-route map preview | Header says Route 1 (Blue) & Route 2 (Red), but road segments use multiple colors. | Label marker colors separately from leg colors and provide an accurate map legend. |
| P2 production polish | Signed-in Stops Selection | Test Dynamic Route Engine is exposed in the normal planning UI; navigation has two different Stops tabs. | Remove developer tools from customer UI and distinguish Plan from Customers. |
| P2 trust | Live signup/homepage inspection | No visible privacy, service terms or support links in inspected flows. | Provide clear privacy/data handling, service terms and a reachable support channel before public paid launch. Legal content needs appropriate review. |
| P2 maintainability | Local source | `app.html` is approximately 20,000 lines, with separate legacy/product plan definitions. | Extract routing, draft state, maps, sharing and account modules incrementally; consolidate entitlement definitions. Avoid a full rewrite before pilot validation. |

Google documents the mobile waypoint limitation and preservation of waypoint order: https://developers.google.com/maps/documentation/urls/get-started

Firebase guidance for trusted access control: https://firebase.google.com/docs/firestore/solutions/role-based-access

## Product and revenue plan

Start with one audience: Singapore SME dispatchers handling recurring multi-stop deliveries. Position GoRouteX around reusable customers, daily route preparation, manual detour points and WhatsApp handoff. Describe restriction pins as advisory; do not sell guaranteed fine avoidance or locked Google Maps paths.

Keep the primary flow to **Customers → Plan → Review map → Save and share**. Put restrictions, vehicle settings and advanced options behind progressive disclosure. Make Saved, Saving, Failed and Device-only unmistakable. Provide a sample route and guided first-run workflow. Keep driver tracking and proof of delivery visibly unavailable until their full workflows are tested.

Use three commercial stages:

1. **Supported pilot:** recruit 3–5 businesses, assist onboarding, observe real daily usage and record support burden. Agree on a pilot fee only after understanding their workflow; no pricing here is claimed to be market-validated.
2. **Paid planner:** charge per company/workspace with clear included capacity. Cloud persistence, repeatable planning and reliable sharing must work before scaling sales. Add dispatcher/driver seat pricing only after tenant and role isolation are implemented.
3. **Fleet operations:** add delivery completion, proof of delivery and tracking only when pilot demand justifies their operational and support costs.

Measure time to first saved/shared route, weekly active businesses, minutes saved per dispatch day, routes reopened successfully, missing navigation stops, support tickets, cancellations and API cost per active business. Calculate contribution as collected revenue minus maps, hosting, database, payment and support costs; do not set unlimited usage before measuring those costs.

## Execution gates

**First: correctness.** Fix navigation segmentation, unchecked status, encoded geometry and draft isolation. Acceptance: no lost detours, no dropped stops and no false checked status across edit/save/back/reload/history.

**Second: paid access.** Test tenant isolation, trusted entitlements, quotas, billing and recovery. Validate production configuration separately from local code. Establish backup/export and a tested restore process.

**Third: polished onboarding.** Align plan copy, pricing, support and policies. Test desktop plus actual iOS/Android workflows, including denied location permission and slow/offline transitions.

**Fourth: controlled releases.** Use source control, a preview environment, release identifiers, production smoke checks and a rollback path. Track sanitized errors without logging customer contacts or precise locations unnecessarily.

## Outstanding live verification

### Completed save-and-reopen test (follow-up)

After the user requested continued account testing, created one saved test plan using the existing ten-stop itinerary and one temporary navigation point. The history entry is labelled Route 16/09/2026 and displays 09:34 pm in this browser. It is an audit route, not a dispatch recommendation; the test point was chosen to exercise persistence.

- Saving succeeded; the dashboard reported two plans today instead of one. Delivery count for this plan remained ten.
- Schedule generation produced arrival/departure times and did not add a delivery stay for the manual point.
- Reopened that specific new entry from history, returned to manual assignment, and observed the same navigation-point coordinates on the map. Save-and-reopen persistence passed for this case.
- The reopened route again showed ETA available after schedule generation, and history showed Final ETA Not available. Schedule results generated after saving are not visibly retained by this workflow; clarify whether they should be saved or regenerated.
- The test history entry was left intact. No WhatsApp message was sent. Actual external Google Maps navigation-link behavior remains unverified by this live test.

### Additional signed-in interaction checks

- Returned from the saved-route results to manual assignment; the ten delivery stops restored across two route groups.
- Activated Add detour point. A click directly on the colored route produced no pin; a nearby click off the overlay created a navigation point. Overlay interception is the likely cause (the local Polyline options do not disable click handling), but the event-level cause still needs verification. Fix by forwarding overlay clicks or making route polylines non-clickable while adding detours.
- Navigated to Dashboard and used browser Back: the temporary navigation pin and the one-detour count survived. The delivery lists still contained ten stops.
- Opened the confirmation modal: the account identified itself as ProPlan with a daily limit of 50 and one used. Cancelled without saving or consuming another route-plan quota.
- Used Undo to remove the temporary test detour. No WhatsApp message was sent, no history entry was deleted and no new route was confirmed.
- During route recalculation, the detour toolbar temporarily shows Plan a route first. Replace that transient empty state with Recalculating route and disable add controls until the selected leg is ready.

These checks establish page-back draft persistence for this case, not reload persistence, a completed save-and-reopen cycle or actual Google Maps handoff.

Existing-history loading and map preview passed the signed-in browser check. Creating/editing test stops, detour save/back/reopen, actual link handoff, plan-limit enforcement and account separation still need a controlled test workflow. Real mobile Google Maps handoff and payment sandbox testing remain outstanding. The current audit does not claim those flows passed.
