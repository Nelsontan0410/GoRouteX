# Singapore restriction panel collapse delivery

## Completed behavior

- A Singapore or Singapore-crossing route continues to reveal the existing LTA restriction settings panel.
- The panel starts expanded when the current signed-in account has no saved folding preference in this browser session.
- **Done** collapses the panel immediately without changing the LTA toggle or selected restriction codes. The compact bar states Off, No codes selected, or the exact selected-code count and includes **Edit**.
- **Edit** restores the existing controls and selected checkboxes. It does not re-enable the feature or alter its selected codes.
- The compact state is stored only in session storage under a versioned key scoped to the Firebase UID. Logged-out use has its own anonymous scope. A storage failure retains the state in memory for the current page.
- The same panel retains its display state while it moves among manual assignment, final route, and map preview pages. Country detection, recalculation, code changes, and late country checks do not reopen a panel the user collapsed.
- When the route no longer touches Singapore, the complete panel and compact bar hide. The current account preference remains for the next Singapore route.
- Done moves keyboard focus to Edit; Edit moves focus to the LTA toggle. Normal background updates do not move focus.

## Verification

- Automated tests: **64 passed, 0 failed**.
- Added state tests for Done, Edit, summaries, anonymous/account separation, and session-storage failure.
- Existing country-option tests verify Singapore, cross-border, non-Singapore, late-result, and boundary-failure visibility behavior.
- `route-safety.js`, `route-region.js`, and all inline scripts in `app.html` parsed successfully.

## Browser verification record

No real browser route was created, saved, shared, or sent. The local application redirects to its login page before route planning, so full interactive verification with a simulated signed-in local account remains unverified. No production site or account was changed for this delivery.
