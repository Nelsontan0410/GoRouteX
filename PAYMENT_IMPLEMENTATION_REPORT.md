# GoRouteX Stripe payment implementation report

## Completed scope

This delivery changes only payment and subscription behaviour. Route planning, route optimisation, map display, Singapore restrictions, manual detours, navigation sharing, route history, GPS, KPI, CSV, feature limits, roles and authentication flows were not changed.

The former external checkout URL, browser-created payment request, placeholder webhook and manual Pro approval function have been removed. Payment access now comes only from verified Stripe subscription events handled by the server.

## Subscription catalogue

| Plan | Interval | SGD base price |
| --- | --- | ---: |
| Basic | Free | 0 |
| GoPlan | Monthly only | 5 |
| ProPlan | Monthly | 20 |
| ProPlan | Annual | 200 |

The backend creates and stores a price version from SGD rates for SGD, MYR and USD. Each converted amount is rounded upward to the next whole major currency unit. Existing Stripe subscriptions retain the Stripe Price ID created at their own checkout and are not changed by a later FX refresh.

## Payment flow

- The Plan & Access page has a currency selector and Stripe checkout choices for GoPlan monthly, ProPlan monthly and ProPlan annual.
- Checkout collects a payment method, starts one 3-day Stripe subscription trial for an eligible account, and does not charge until that trial ends.
- A Stripe webhook verifies the original raw request signature before it changes a plan. It stores the Stripe event ID to make duplicate delivery safe.
- Webhook handling covers checkout completion, subscription updates/deletion, successful invoice payment and failed invoice payment.
- A payment failure starts one continuous 72-hour grace period. Retries do not extend that deadline. The scheduled reconciliation function downgrades only expired grace-period accounts to Basic.
- A customer can open Stripe Customer Portal for payment-method/billing management only when the configured portal has subscription cancellation disabled.
- Cancellation is available only in GoRouteX. A reason is mandatory, `Other` needs a short explanation, and additional feedback is optional. The subscription is set to cancel at the current trial or paid-period end, so a trial cancellation prevents the first charge while keeping access until the trial ends.
- Checkout is locked for 30 minutes per account to prevent multiple parallel subscription sessions.

## Developer and existing accounts

Profiles with the existing server-protected `permanentPlan: true`, or the server-protected `developerBillingExempt: true`, are exempt from checkout, trials, payment failure, grace expiry and downgrades. The browser cannot set either flag.

No migration was applied to existing non-developer users because no migration rule was approved. Their existing profile state is left unchanged.

## Required production configuration

No production deployment or live payment action was performed. Before enabling this code, configure these Netlify environment variables for a Stripe account registered to the Malaysian business:

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe server API key; never expose it to browser code. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the configured Stripe webhook endpoint. |
| `STRIPE_PRODUCT_GOPLAN` | Stripe Product ID for GoPlan. |
| `STRIPE_PRODUCT_PROPLAN` | Stripe Product ID for ProPlan. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Customer Portal configuration with subscription cancellation disabled. |
| `APP_PUBLIC_URL` | Canonical public GoRouteX origin used for Stripe return URLs. |
| `BILLING_FX_RATE_URL` | Trusted SGD-base FX endpoint returning `rates.MYR` and `rates.USD`. |
| `BILLING_FX_API_KEY` | Optional provider key for that FX endpoint. |
| `BILLING_PRICE_REFRESH_TOKEN` | Secret for the protected manual price-refresh endpoint. |
| `BILLING_FX_MAX_AGE_HOURS` | Optional FX freshness limit; default 30 hours. |
| `BILLING_FX_MAX_CHANGE_PERCENT` | Optional abnormal-move safeguard; default 20%. |

Configure Stripe to send these events to `/.netlify/functions/stripe-webhook`:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

The scheduled price refresh runs daily and the grace reconciliation runs hourly after a production deployment. Scheduled Functions do not run automatically in deploy previews. Until the first successful price refresh creates the Stripe Price IDs, checkout remains disabled instead of charging an unquoted price.

## Validation completed locally

- All JavaScript payment functions and Firebase configuration parse successfully.
- All six inline scripts in `app.html` parse successfully.
- Full automated suite: 73 passed, 0 failed.
- New billing tests cover the approved price matrix, upward rounding, stale/abnormal FX detection, fixed 72-hour grace, developer exemption, Stripe trial collection, cancellation feedback, portal cancellation guard, webhook idempotency code and removal of the legacy manual checkout path.

## Not performed

- No Netlify, Firebase Rules or production deployment.
- No Stripe account configuration, product creation, price refresh, checkout, payment, cancellation, refund or webhook delivery.
- No refund policy. This remains intentionally deferred as requested.
- No live FX provider verification. The configured provider contract must be tested in Stripe test mode before production enablement.
- No change to legacy non-payment access definitions. Payment-specific deferred findings are recorded in `PAYMENT_OUT_OF_SCOPE_ISSUES.md` without changing plans, roles or feature behaviour.
