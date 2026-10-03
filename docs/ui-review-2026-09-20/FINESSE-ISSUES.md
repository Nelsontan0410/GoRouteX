# Finesse UI issues outside this pass

Date: 2026-09-21

These findings are recorded without changing the protected implementation.

| ID | Finding | Evidence | Why not changed here |
|---|---|---|---|
| F01 | Source-backed sync wording can differ between dashboard and account views. | Existing review record `UI-PLAN.md` reports Device-only versus Cloud sync wording. | Requires storage-state and product-copy verification. |
| F02 | Billing price availability and non-developer subscription paths are not locally verifiable. | Existing review record reports unavailable price configuration in the inspected developer state. | Billing catalog, prices, trial, and cancellation behavior are protected. |
| F03 | A direct empty manual-planning entry can imply that routes were generated. | Existing review record `UI-PLAN.md`. | State-copy behavior needs a source-backed interaction test; no route state was mutated. |
| F04 | Historic usage and dashboard counts may use different sources or time windows. | Existing review record `UI-PLAN.md`. | Do not alter metrics or storage presentation without confirming their source semantics. |
| F05 | The static Finesse detector still reports legacy style debt in `app.html`: side-stripe borders, root horizontal overflow handling, hard borders, opaque color literals, and broad transitions. | Detector run on 2026-09-21. | These are pre-existing, cross-surface rules. Replacing them requires real-page visual regression coverage. |
| F06 | The detector flags `window.location.href` as a dead local reference. | `app.html` URL comparison near line 8634. | Static-parser false positive; no missing asset was established. |
| F07 | Browser verification of the new production-CSS fixture could not run. | Local app redirects unauthenticated users to login; browser policy rejected opening the fixture with `file://`. | No authentication, browser-storage, or browser-policy bypass was used. |
