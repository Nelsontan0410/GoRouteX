# GoRouteX release, October 2026: navigation, Stops Selection, Customer Workspace, authentication

This document hands off the release that implements `GoRouteX_Implementation_Plan.pdf` (5 October 2026). It is organised by the plan's stages. Each stage lists the changed files, data migration, configuration, tests and rollback.

**Test suites:**

| Command | What it runs | Requirement |
|---|---|---|
| `pnpm test` | Unit and integration tests | — |
| `pnpm test:rules` | Firestore rules, plus the real history code, against the emulator | Java |
| `pnpm test:auth` | Real password recovery against the Auth emulator | Java |

## Stage 1: Audit (baseline facts used by later stages)

**Navigation:** each page had its own static sidebar. Order Hub had no sidebar, only a top bar with "Route workspace".

**Stops Selection:** the Route Settings card was the only place to edit the route start, end and planning date/time. It was not a repeated display of values entered elsewhere.

**Saved stops data:**
- Records are already customer master data: id, name, address, phone, coordinates, account.
- They have stable ids (`buildStableStopId`).
- They have no time-window, opening-hours or service-time fields.
- Orders have their own `timeWindowStart/End` and `serviceTimeMinutes`; the ETA did not use them.

**Service time:**
- The existing setting is `routePlanning.serviceMinutes`, default **15**. It was used as each visit's default "stay".
- The ETA also forced any time between 12:01 and 12:59 to 13:00.

**Route optimiser:**
- Google Directions with `optimizeWaypoints` is the only optimiser, and it optimises travel time only.
- ETAs are computed in `generateTimeListAndShowOnPage3Legacy` at confirmation.

**Authentication:**
- `authDomain` is `delivery-app-cd18e.firebaseapp.com` and the site is hosted on Netlify (no Firebase Hosting).
- Google sign-in uses a popup, with a redirect fallback.
- Forgot password reused the login email field and revealed whether an account exists.
- The live Firebase Auth console configuration could not be read from this environment; see Stage 5.

## Stage 2: UI shell (Parts 1 and 2)

**Changed files:**
- New: `app-sidebar.js`, `styles/app-sidebar.css`.
- Modified: `app.html`, `order-hub.html`, `dispatch.html`, `orders/order-hub.js`, `dispatch/dispatch-page.js`, `app-shell.js`, `dashboard/dashboard-page.js`, `planning/planning-page.js`, `app-experience.css`.

**Shared sidebar:**
- One sidebar on Dashboard, Order Hub and Dispatch, with the same markup and styles on all three.
- Primary items are Dashboard, Order Hub and Dispatch, plus the account area: user and plan, Account, Settings, Logout.
- The active item comes from the page markup, so it survives direct URLs and refresh.
- Planning steps keep Dashboard active.
- The account gate also blocks sidebar links while the workspace loads.

**Removed cross-page navigation:**
- Plan a route and Saved stops are no longer primary navigation. Old bookmarks still resolve: `#page-select-stops`, `#plan`, `#page-add-stop`, `#customers`, and the new `#customer-workspace`.
- The Order Hub top bar, which carried "Route workspace" and "Settings", is removed.
- Dispatch's static sidebar copy and its mobile nav are replaced by the shared sidebar.

**Mobile:**
- The app's bottom tab bar is Dashboard, Order Hub, Dispatch, GPS.
- Order Hub and Dispatch get a compact top bar at ≤980px.

**Dashboard:**
- Start Route Plan.
- Manage Customers, which opens the Customer Workspace search.
- Load Route.
- Recent route plans is visible again. The list now reads summaries in about 0.3 s, so the earlier reason for hiding it no longer applies.

**Stops Selection:**
- The Route Settings card and its summary are removed from the page.
- The same start/end/date-time inputs (same ids, same state and storage) open from a **Route settings** button. Validation that needs an address opens that panel.
- The page description is added under the title.
- The Dashboard shortcut is removed; Back stays.

**Migration:** none.

**Config:** none.

**Rollback:** revert the Stage 2 commits (`a1d33ca`, `3e25f7a`).

## Stage 3: Customer master (Part 3)

**Changed files:**
- New: `delivery-constraints.js` (rules), `delivery-schedule-editor.js` (shared 7-day editor), `customer-constraints-form.js`, `styles/delivery-schedule.css`.
- Modified: `settings.html`, `settings/settings-model.js`, `settings/settings-page.js`, `firebase-config.js` (`normalizeStop`, `toLegacyCustomer`), `app.html`, `styles/master-search.css`.

**Settings → Route Planning Defaults:**
- Owns the **Customer Delivery Schedule**, stored as `users/{uid}/settings/operationsV1 → routePlanning.defaultDeliverySchedule`. The default is Mon–Fri 09:00–18:00, break 12:00–13:00, weekend closed.
- Owns **Default Service Time**, which is the existing `routePlanning.serviceMinutes`, unchanged and still the only source.
- `#planning` links open this section.

**Customer fields, stored on the saved-stop record:**

| Field | Meaning |
|---|---|
| `deliveryScheduleMode` | `default` or `custom` |
| `customDeliverySchedule` | Only present in custom mode |
| `serviceTimeMode` | `default` or `custom` |
| `customServiceMinutes` | Only present in custom mode |

Default mode stores no copy, so changing the global default reaches every inheriting customer. Return to default deletes the override.

**Customer Workspace:**
- The master-data page is renamed. It uses Add Customer and Search Customers, and the import/export copy is updated.
- Route-stop wording in planning is unchanged.
- Search type and Search terms stack vertically at full width and stay inside the panel. This was checked in WebKit at desktop size, at 360 px wide and at 200% zoom.

**Migration:**
- Existing records keep their ids.
- Records without the new fields resolve as `default`; no rewrite is needed and none was done.
- The audit found no existing explicit restrictions on saved stops, so nothing had to become `custom`.
- Partial updates, such as an import merge, keep an existing override.

**Rollback:**
- Revert `e97335f`, `371e454`, `1cf21db` (constraints module) and `db125a3`.
- Stored override fields are ignored by older code and are harmless.

## Stage 4: Planning (hard delivery windows)

**Changed files:**
- New: `route-time-windows.js`.
- Modified: `app.html` (ETA function, service-time defaults, delivery-window ordering), `planning/route-finalization.js`, `planning/planning-persistence.js`, `planning/planning-state.js`, `planning/manual-assignment-page.js`.

**Resolution:** customer custom values take priority over Settings defaults. They are resolved at planning time.

**Service time:** each visit's default stay is the customer's effective service minutes. A planner can still change a single visit.

**Optimisation:**
- After Google's travel-time order, a route that would miss receiving hours is reordered within the route.
- The objective is applied in this order: fewest window violations, then shortest total duration (travel + wait + service), then shortest distance.
- Travel times are estimated from the real Google legs, so there are no extra paid API calls.
- Direction-return arrangement mode keeps its own order and is still enforced at confirmation.

**ETA:**
- Early arrivals wait for opening.
- Service never crosses a break: arriving at 12:30, or at 11:50 with 20 minutes of service, starts at 13:00.
- Closed days and late arrivals are recorded as violations.
- The fixed 12:00–13:00 jump is removed.
- Each stop stores `deliveryConstraints` (day, receiving hours, modes, minutes) as the planning-time snapshot.

**Confirmation:**
- Violations open **Delivery hours conflict**, which shows the customer, ETA, receiving hours and reason.
- The actions are Change start time, Adjust routes, or Save with override.
- Save with override requires a reason. It stores `timeWindowOverride {actorUid, actorName, reason, at, violations}` on the saved plan.
- Saved plans keep their snapshot; a fresh replan reads current settings.

**Migration:** none.

**Rollback:** revert `89da753`. Plans saved with snapshot fields stay readable.

## Stage 5: Authentication (Part 4)

**Changed files:**
- New: `auth-recovery.js`, `auth-action.html`, `tests/auth/password-recovery.auth.mjs`.
- Modified: `login.html`, `firebase-config.js`, `_redirects`, `_headers`, `firebase.json`, `package.json`.

**Forgot password:**
- A dedicated reset form with validation, loading state and retry.
- The success message never reveals whether an account exists. Real failures (network, rate limit, configuration) are shown and logged.
- The continue URL is `/login.html?reset=done`. If the project rejects it, the email is still sent without it.

**`auth-action.html`:**
- A branded GoRouteX handler.
- Handles expired, used and invalid links.
- Requires the new password twice, then shows "Password updated" with Back to Sign In.

**Sign-in errors:** an unknown email and a wrong password now show the same message.

**Google branding:**
- Netlify proxies `/__/auth/*` and `/__/firebase/*` to `delivery-app-cd18e.firebaseapp.com`.
- `firebase-config.js` can use `goroutex.netlify.app` as `authDomain`.
- **Staged:** `GOROUTEX_AUTH_DOMAIN_ENABLED = false`.

**Console steps.** These cannot be done from code, and they are needed for the acceptance criteria:

1. **Google Cloud Console → APIs & Services → Credentials → Web client (auto created by Google Service):** add the Authorized redirect URI `https://goroutex.netlify.app/__/auth/handler`. Keep the existing firebaseapp.com URIs.
2. **Google Cloud Console → OAuth consent screen (Branding):**
   - App name: **GoRouteX**.
   - Upload the GoRouteX logo.
   - Set the support email and the application home page `https://goroutex.netlify.app`.
3. **Stage it:** on `https://goroutex.netlify.app`, open the browser console and run `localStorage.setItem('goroutexAuthDomain','on')`, then sign in with Google in Safari and Chrome. The account chooser should show goroutex.netlify.app. If it works, set `GOROUTEX_AUTH_DOMAIN_ENABLED = true` and deploy.
   - **Rollback:** set the constant back to `false`, or run `localStorage.removeItem('goroutexAuthDomain')`.
4. **Firebase Console → Authentication → Settings → Authorized domains:** confirm `goroutex.netlify.app` is listed.
5. **Firebase Console → Authentication → Sign-in method:** confirm Email/Password is enabled.
6. **Firebase Console → Authentication → Templates → Password reset:**
   - Sender name: **GoRouteX**.
   - Subject: "Reset your GoRouteX password".
   - **Customize action URL:** `https://goroutex.netlify.app/auth-action.html`.
   - Optional: under Customize domain, send from a GoRouteX-owned domain once you own one; this needs DNS records.
7. **Real inbox test:**
   - Use a known email/password account and request a reset. The email should arrive (check spam). The link should open `auth-action.html`; set a new password; the new password should sign in and the old one should fail.
   - Open the same link again; it should show "no longer valid".
   - Also request a reset for a Google-only account and an unknown address. Both should get the same message.

**Rollback:** revert `4a5dba8`. The proxy rules are harmless while the switch is off.

## Verification

| Suite | Result |
|---|---|
| Unit and integration (`pnpm test`) | 333 passed |
| Firestore rules and history (`pnpm test:rules`) | 58 passed |
| Auth emulator (`pnpm test:auth`) | 4 passed |
| Build | Passes, including the dist reference check |

Visual checks were run in WebKit (Playwright) for:
- Order Hub, Dispatch and Customer Workspace sidebars.
- Customer search at desktop size, 360 px wide and 200% zoom.
- The schedule editor.
- The Route settings panel.
- The login reset form on a phone.
- The `auth-action.html` invalid-link state.

These checks found no layout overflow and no page script errors.

**Not verified here:**
- Production Google sign-in after the console steps.
- A real reset email in an inbox.
- Signed-in end-to-end flows in Safari and Chrome on real devices.
