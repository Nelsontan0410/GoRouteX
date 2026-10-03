# Order Hub

`order-hub.html` is the standalone order intake workspace. The existing `app.html` route planner remains the source of Saved Stops and the account settings screen. The Order Hub ends at `READY`; it does not plan, dispatch or optimize routes.

## Architecture

- `orders/spreadsheet-reader.js` parses XLSX, CSV and pasted tables into one table shape.
- `orders/import-mapper.js`, `import-profiles.js`, `order-normalizer.js`, `import-validator.js`, `duplicate-detector.js` and `import-engine.js` handle header mapping, reusable profiles, canonical normalization, validation, duplicate detection and preview. Files are never persisted on selection.
- `orders/customer-matcher.js` indexes customer names, confirmed aliases and account numbers, stops by customer ID and contacts by customer ID. Ambiguous customer, stop and contact matches require selection. A unique ship-to code or exact raw address may identify one stop.
- `orders/order-readiness.js` is the central import readiness rule. A resolved customer and delivery stop are required; a resolved contact is required only when Contact Required is ON. Malformed dates, numbers, email and delivery windows remain review issues.
- `orders/master-data.js` reads user-scoped Customers and Contacts from Firestore and Saved Stops through the existing `RoutePlannerStorage` abstraction. `orders/master-maintenance.js` extends the existing Saved Stops page with a Contacts panel and a return action. `orders/import-return-context.js` stores the in-progress import draft in IndexedDB and the stable row ID/return assignment in session storage.
- `orders/order-store.js` persists orders, profiles and batches under the signed-in user's Firestore document. `orders/order-hub.js` handles the UI and keeps preview rendering to 30 rows and the orders table to 50 rows per page.

## Canonical order and storage

Orders live at `users/{uid}/orders/{internalId}`. They retain `orderId`, `source`, `importBatchId`, customer/order fields, normalized delivery fields, validation status/issues and timestamps. Resolved imports also keep `customerId`, `savedStopId`, `contactId`, `deliveryAddress`, `latitude`/`longitude`, `contactName` and `contactPhone`. These delivery and contact values are snapshots at import time; later master record edits do not rewrite historical orders. Raw imported values remain in `rawInput` for review.

Import profiles live at `users/{uid}/importProfiles/{profileId}` and map normalized header identities to fields, so reordered columns remain compatible. Batch records live at `users/{uid}/importBatches/{batchId}` with source method, filename, profile, counts, actor, timestamp and `SAVING`/`COMPLETE`/`PARTIAL` state. Customer records live at `users/{uid}/orderCustomers/{customerId}` and contacts at `users/{uid}/orderContacts/{contactId}`. The Contact Required switch lives at `users/{uid}/settings/orderHub` as `contactRequired`. Existing Saved Stops continue through `RoutePlannerStorage` and retain `customerId`, `customerName`, label and site code when present. Data remains scoped to the active signed-in user, matching the current GoRouteX account model.

## Import and resolution

1. File or paste input is parsed, detected, mapped, normalized, validated, deduplicated and previewed through one pipeline. Mapping can be corrected before preview and saved as an Import Profile.
2. Preview resolves a customer using an exact account number or confirmed name/alias match. Legacy stops without a customer ID can join one uniquely matching customer; no fuzzy match is guessed.
3. A customer with one stop gets that stop automatically. With multiple stops, the operator selects a stop for each order unless a unique ship-to code or exact address identifies one. Stop and contact references are stored per order, not per customer.
4. Contacts can be customer-level or stop-specific. Only contacts relevant to the selected stop are shown. One relevant contact is selected automatically; multiple require selection unless imported name/phone identifies exactly one. Changing stop recomputes the relevant contacts.
5. Rows retain the existing `READY`, `NEEDS_REVIEW` and `DUPLICATE` statuses. A resolution code explains whether a stop or contact is missing or needs selection. Contact Required OFF permits a missing contact. Exact duplicate rows cannot be selected; other review rows can be imported independently of ready rows.
6. Add Stop, Add Contact and Add Stop + Contact actions open the existing Saved Stops workspace in `app.html`. The draft and stable `internalId` survive navigation. After saving, the newly created IDs are assigned to that one originating row, the draft is restored and readiness is recalculated. An existing customer ID is reused when adding another delivery stop.
7. Confirming saves only selected preview rows, then records a batch and optional profile. A partial write is reported as partial; it is never shown as a complete import.

## Limits and next integration

Manual orders use the same normalizer and validator and may be saved with an address even if no master customer/stop exists; the customer/stop resolution workflow currently applies to imports. The Order Hub does not geocode every imported row. A future planning adapter should transform `READY` canonical orders into the existing route planner's stop input without changing the route engine. Cloud Firestore security and production account behavior require deployment/account verification; the local browser acceptance harness uses an isolated mock account.
