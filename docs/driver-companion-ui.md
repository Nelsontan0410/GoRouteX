# Driver Companion UI

`/driver.html` is rewritten to `driver-tracking.html` by the existing Netlify redirect. The Driver experience uses the existing account guard, today's assigned routes, execution store and GPS module. No schema, rules, route engine, Dispatch or backend changes are part of this UI update.

## Presentation and actions

The surface is implemented in `driver-tracking.html`, `driver/companion.css` and `driver/driver-page.js`. It extends the established product interface described in `docs/ui-review-2026-09-20/PRODUCT.md`: cool slate surroundings, white operational surfaces and blue primary actions and selection. This page does not introduce a global design system or a new token source.

The hierarchy puts route state and the next stop ahead of supporting details. Route controls and delivery outcomes use prominent actions; contact actions and route options remain secondary. The touch-target baseline is 44px high, with the main action buttons at least 48px high. Status colours retain text labels.

- Below 800px, Today's Route and Current Stop are separate views. Desktop shows both columns. Starting or resuming opens Current Stop; Continue Route on an already active route only changes the visible view.
- Start Route calls the existing `store.start()` and tracking resume flow. Start Navigation and the remaining Google Maps part links only open Maps. They never create an execution or start GPS. Before starting, Maps uses the saved origin; while active, it uses the driver's location and remaining stops. The existing navigation partitioning and detour algorithm is unchanged.
- Current Stop follows `progress().next`. Mark Arrived is required before Mark Delivered opens the existing POD form. Report Issue retains reason validation, including mandatory notes for Other. Up next previews details without advancing execution.
- Call uses the existing saved contact. WhatsApp opens a chat only for an explicitly international saved number (`+` and 8–15 digits); no country is inferred and no message is sent. Missing contact/navigation information is explained inline.
- Route pause, stop, explicit completion, location retry, photo validation and compression, order sync, auth checks and storage modes retain their existing implementation.
- Progress and stop labels are derived from saved routes/execution snapshots. No ETA, distance, delivery or GPS success is invented.

## Validation and limits

Full `npm test`: 498 passed. Driver tests: 24 passed. `node scripts/build-site.mjs` and `git diff --check` passed. Browser checks at 320, 390, 768 and 1440px showed no horizontal overflow; inspected mobile controls are at least 44px high. Current Stop, arrival-to-delivery action change, issue form, route overview, desktop columns and empty state were inspected.

Browser screenshots use actual application HTML/CSS and `driver-page.js` with a clearly labeled local test fixture at the service boundary. Test fixtures live under `tests/` and are excluded from the site's build. They are not production fallback data. No live Driver session was available: real account, Firestore writes, device GPS, Maps app handoff and background return still need acceptance testing. The live production page returned the existing Driver-account guard.

To reproduce the local preview, run `node tests/driver-companion-preview.mjs` and open `http://127.0.0.1:8765/driver.html?fixture`. The preview renders the actual page with service facades and a visible test banner. Add `&scenario=empty`, `&scenario=active` or `&scenario=denied` for the corresponding test state. The preview server is test-only and excluded from the site build.

The requested two design images were unavailable in the referenced conversation export. The implementation follows the explicit Today’s Route / Current Stop brief and the existing slate/white/blue brand; visual fidelity to those unseen images is not claimed. The optional Impeccable detector could not run because its engine was not installed; browser inspection and an independent review were used.
