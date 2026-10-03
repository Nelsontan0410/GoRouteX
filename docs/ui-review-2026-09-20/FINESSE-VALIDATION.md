# Finesse UI validation record

Date: 2026-09-21

## Scope completed in this pass

- Corrected the dashboard's recent-plan presentation so the visible header and row share four tracks: plan/driver, delivery counts, restriction notice, and action.
- Kept the existing route selection and role-controlled delete action. Start time and final ETA are retained in a native `Plan details` disclosure rather than being dropped from the compact row.
- Corrected the mobile final-routes tab label from `History` to `Routes`, matching the page it opens.
- Applied the approved shared cool-slate tokens in `modern-theme.css`, retained orange for the existing Confirm Route control, set the approved system sans stack, removed shared decorative page gradients, and added a reduced-motion backstop.
- Added product and design records plus two isolated previews under this directory. `connected-preview.html` demonstrates the approved direction across dashboard, stop selection, manual planning, final routes, history, saved stops, account, and login using labelled synthetic data. `app-layout-fixture.html` loads production CSS only, excludes all application and third-party scripts, and uses the actual dashboard and planner selector structure for safe geometry checks.

## Files changed

| File | Change | Behavior impact |
|---|---|---|
| `app.html` | Dashboard row presentation, retained metadata disclosure, and truthful mobile tab label | Existing selection, delete permission, lazy mounting, data load, and route state are retained. |
| `app-experience.css` | Matching dashboard table tracks, details presentation, responsive collapse | Presentation only. |
| `modern-theme.css` | Approved shared tokens, primary/confirm color split, system font stack, reduced-motion fallback | Shared presentation only. |
| `docs/ui-review-2026-09-20/PRODUCT.md` | Product and state semantics | Documentation only. |
| `docs/ui-review-2026-09-20/design-model.yaml` | Approved design model | Documentation only. |
| `docs/ui-review-2026-09-20/connected-preview.html` | Isolated, custom-CSS synthetic design preview | Does not load production code or services. |
| `docs/ui-review-2026-09-20/app-layout-fixture.html` | Production-CSS synthetic fixture | Loads CSS only; no app, Google, Firebase, Stripe, storage, or auth scripts. |

No protected routing, map, safety, storage, authentication, role, billing, pricing, or Netlify implementation files were edited in this pass.

## Automated checks

| Check | Result | What it establishes |
|---|---|---|
| `node scripts/build-site.mjs` | Passed; prepared 36 public files | The edited production assets build into `dist`. |
| `node --test tests/*.test.mjs` | Passed; 73 tests | Existing route, safety, detour, navigation, storage, and billing behavior remains covered by its current automated suite. It does not prove UI parity. |
| Finesse detector on `app.html` and both previews | Ran | The new reduced-motion backstop resolved the detector's continuous-motion P0. The remaining P0, `window.location.href`, is a static-parser false positive in an in-document URL comparison, not a local asset reference. |
| Browser, approved reference preview | Rendered and inspected at the browser's default desktop viewport | The approved dashboard reference visibly presents the four-column table geometry. |

## Browser and viewport limits

The local application redirects unauthenticated visitors to `login.html`, as intended. No account credentials, storage bypass, route calculation, map request, or write operation was used to enter protected pages. Browser policy also rejected opening the local `file://` CSS fixture; no alternate route or workaround was attempted.

Therefore, this record does **not** claim actual application screenshot parity, nor coverage at 320, 375, 414, 768, 1024, or 1440. The production-CSS fixture is ready for those checks when a browser surface is available. The isolated connected preview is useful for direction review only; it is not application validation.

## Acceptance still requiring an authenticated or safe browser fixture

- Desktop and mobile screenshots of the real dashboard and manual planner at matching sizes, compared to `preview.html`.
- Dashboard sidebar switching and lazy mounts under real role guards.
- Stop selection, route settings folding, restriction and detour controls, map sizing, and final-route communication states with existing source-backed data.
- Long labels, 320px button wrapping, bottom navigation clearance, touch target measurements, and physical touch behavior.
- Full history, saved stops, account, login, GPS, driver tracking, and public marketing surfaces in their real data states.

## Historical artifact

`VERIFICATION.json` predates this execution pass. Its `production_source_changes: []` value describes the earlier proposal-only review and must not be used as current validation evidence.

## Continuation: shared visual pass

- The stop-selection workspace now uses two equal, surfaced columns with the existing selection controls unchanged.
- The manual planner now uses a desktop map/list split of approximately 65/35, with the restriction and manual-detour controls kept together above it. It becomes one column below 980px.
- The login, public entry page, and driver tracking surface now share the cool-slate and deep-blue palette. Login fields and the Google option use the same control dimensions and focus treatment as the application.
- The public page retains its existing content and actions; repeated pill-style section labels were reduced to the hero, pricing, and closing call to action. Other labels are plain hierarchy text.
- Mobile root overflow now clips horizontally without creating a horizontal scroll container. The existing vertical application layout remains unchanged.

### Continuation checks

| Check | Result |
|---|---|
| Build | Passed: 36 public files prepared. |
| Existing automated suite | Passed: 73 tests, 0 failures. |
| Finesse static check | No P0 finding remains. Existing P1/P2 findings are legacy source-wide style debt and are not claimed as resolved. |
| Browser screenshot | Not completed. The browser policy rejected access to the local `file://` login tab, so no alternative route or authentication bypass was attempted. |

This continuation did not change routing, safety checks, manual-detour persistence, Google Maps requests, authentication behavior, account roles, billing, prices, or deploy configuration.
