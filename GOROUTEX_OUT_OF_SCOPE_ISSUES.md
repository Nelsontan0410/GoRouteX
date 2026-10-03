# GoRouteX out-of-scope issue log

This log records issues intentionally left unchanged outside the approved payment scope.

| ID | Finding | Evidence | Recommended later work |
| --- | --- | --- | --- |
| OOS-001 | Paid limits and profile role protection are not enforced by the current Firestore rules for ordinary owner subcollections. | `firestore.rules` permits owner writes without entitlement/quota checks. | Move paid-operation enforcement to a trusted backend/rules design and test cross-account, concurrent quota, and role-edit cases. |
| OOS-002 | The legacy fallback branch in `generateShareableLinkPage3` still contains an obsolete single Google Maps URL builder. It is unreachable after the current share-data path returns, but should be removed in a separate legacy-code cleanup. | `app.html` legacy fallback after `buildRouteShareData`. | Remove the obsolete fallback only after checking all historical share callers. |
| OOS-003 | Actual iOS/Android Google Maps handoff and real cloud account-switch testing require a controlled device/account test. | Local automated tests verify URL segmentation and draft identity only. | Test on dedicated mobile accounts without creating dispatch records. |
| OOS-004 | `go-routex-access.js` retains an older plan catalog with obsolete prices and plan names, while the active route-product plan catalog drives the app payment cards. | `go-routex-access.js` defines Trial/Basic/Pro/Team price labels that differ from the approved Stripe catalogue. | Consolidate legacy access-policy data in a separately approved access-model cleanup. No plan limits, roles, or access behaviour were changed in this payment delivery. |
