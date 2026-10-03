# GoRouteX Stripe Billing V1 setup

The current production Netlify site is `goroutex` (`d231093f-7052-48ce-9bdf-59ca2b8c91a7`). Billing code can be deployed while checkout remains disabled. Free workspaces do not need Stripe.

## Configure Stripe test mode first

1. In Stripe test mode, create recurring GO and PRO products/prices. Match the existing approved GoRouteX commercial plan terms; do not guess prices.
2. Set Netlify **function** environment variables for this existing site: `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET` (test endpoint signing secret), `STRIPE_PRICE_GO_MONTHLY`, and `STRIPE_PRICE_PRO_MONTHLY`. The existing Pro annual offer can also use `STRIPE_PRICE_PRO_YEARLY` if that price is intentionally available. Keep the two secrets protected and out of browser/build variables.
3. Create a Stripe webhook endpoint at `https://goroutex.netlify.app/.netlify/functions/stripe-webhook`. Subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.
4. Create a Stripe Customer Portal configuration. Enable payment method updates, invoice history, and cancellation **at period end**. Disable subscription plan switching for V1. Set `STRIPE_PORTAL_CONFIGURATION_ID` for the same Stripe mode.
5. `APP_PUBLIC_URL` may be set to `https://goroutex.netlify.app`; the Netlify-provided `URL` is the fallback. Never accept a return URL supplied by the browser.
6. Confirm the public billing catalog reports `configured: true` and displays amounts returned from the configured Stripe Price objects. Only then perform a test-mode Checkout and verify the signed webhook updates the workspace plan and its existing Driver entitlement. Use the Portal to verify invoice and payment method access. No automated test should make a real charge.

Stripe test and live credentials, prices, portal configurations, and webhook signing secrets must never be mixed. The server rejects a Price whose mode, currency, or billing interval does not match the selected offer. A valid test-mode flow should be completed before configuring live credentials.

The older dynamic multi-currency catalog remains supported when no fixed Price IDs are configured. It uses `STRIPE_PRODUCT_GOPLAN`, `STRIPE_PRODUCT_PROPLAN`, `BILLING_FX_RATE_URL`, and optionally `BILLING_FX_API_KEY`, with price refresh managed by the existing function. Fixed configured Price IDs take precedence over that catalog. Use one pricing approach deliberately.

Billing data is stored on the workspace owner's `users/{uid}` profile, with a server-only Stripe customer mapping and signed-webhook event records. Browser Firestore rules protect paid plan and Stripe fields. Existing routes, orders, Drivers, and history are never deleted on downgrade.
