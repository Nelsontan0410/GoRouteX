# Payment out-of-scope issue log

This file records findings that were not changed because they fall outside the approved payment-only delivery.

| ID | Finding | Evidence | Deferred action |
| --- | --- | --- | --- |
| PAY-OOS-001 | The legacy access-policy module contains old Trial/Basic/Pro/Team names and obsolete prices. | `go-routex-access.js` has a separate `PLAN_DEFINITIONS` catalogue; the active payment cards use `route-planner-product.js`. | Consolidate entitlement models only in a separately approved access-model task. Do not change limits, roles or feature gates as part of payment work. |
| PAY-OOS-002 | Existing non-developer account migration was not specified. | Existing profiles can contain legacy plan fields without Stripe subscription identifiers. | Define migration eligibility, communication and rollback before changing any existing non-developer account. |
| PAY-OOS-003 | A live Stripe and trusted FX provider test requires real credentials and a Malaysia-registered Stripe account configuration. | No Stripe or FX environment credentials are present in the local workspace. | Run the test-mode checklist in `PAYMENT_IMPLEMENTATION_REPORT.md` after configuration; do not enable live payments before it passes. |
