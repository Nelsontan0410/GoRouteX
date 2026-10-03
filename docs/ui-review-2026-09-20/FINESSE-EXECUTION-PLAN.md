# GoRouteX Finesse UI execution contract

Date: 2026-09-21. Implement the approved light blue-grey, map-first UI proposal. Executor: GPT-5.6 Terra. This file is the scope contract; do not invent additional product requirements.

## Authority and boundaries

Read the installed finesse-ui SKILL.md and applicable project instructions. The user approved the visual direction in this conversation and requested Terra execution. Do not restart aesthetic selection or replace the approved direction with another theme. Use the existing preview at docs/ui-review-2026-09-20/preview.html as the visual reference, not as production data or code to copy wholesale.

Work locally. Do not deploy, modify hosting configuration, install dependencies, send messages, perform payment operations, or mutate real account records. Preserve user edits. Never claim full completion based solely on existing unit tests. Record unrelated issues in FINESSE-ISSUES.md and do not repair them.

Protected: route ordering and optimization, Google requests and limits, safety geometry and thresholds, Singapore detection, code activation, pin filtering, detour persistence and waypoint ordering, navigation segmentation, advisory sharing policy, storage and authentication, roles, developer exemptions, Stripe endpoints, currencies, prices, trial/cancellation rules and database fields. Do not edit their implementations. Presentation adapters and navigation wiring may change only when required to render the approved UI, while retaining the original access checks and actions.

## Locked direction

Product interface, restrained motion and moderate-to-high operational density. Cool slate neutral palette; page #F6F7F9, surface #FCFDFE, primary #2456C4, dark blue-grey text, accessible secondary text. Existing Confirm Route orange is a deliberate exception. Success/warning/error semantic colours remain distinguishable by labels. Route-leg colours remain intact. System sans-serif; body 14–16px, titles 24–28px, secondary labels 12–13px. Controls 8px radius, panels 12px. Spacing 4/8/12/16/24/32px. No decorative photos, generators, gradients, glass effects, oversized hero typography or chart inventions. Use one consistent lightweight icon approach without adding packages.

## Phase 1: baseline and connected preview

1. Inspect existing HTML, rendering functions, CSS load order and mobile overrides; inventory every affected surface and its existing handlers. Record protected files and baseline checks in FINESSE-VALIDATION.md. Use targeted reads rather than dumping large files.
2. Write PRODUCT.md and design-model.yaml documenting these approved choices, not invented capabilities.
3. Extend an isolated connected preview under docs/ui-review-2026-09-20/ to cover dashboard, stop selection, manual planning, final routes, history, saved stops, account and login. Demo data and schematic maps must be labelled and must never load production services. Preserve the reference design. No actual backend writes.

## Phase 2: application shell and dashboard

1. Desktop left navigation: Dashboard, Plan a route, Saved stops, Route history; Account/Logout below. Keep original role guards and existing final-route, map and GPS access. Active state follows mounted page. Preserve lazy page mounting. Mobile navigation has truthful labels and at most five items; no entry may imply history while opening final routes.
2. Dashboard order: title and Start Route Plan; four compact real statistics; recent route plans heading and browse action; aligned list/table. Lower priority account information stays reachable, including real sync state.
3. Replace the current four-column header/two-column body mismatch with an actual consistent table or accessible equivalent: plan/driver, delivery counts, restriction notice, action. Preserve row selection, load, role-controlled delete and existing metadata; additional metadata may be placed in expandable details, not lost. Never synthesise safe status or example figures.
4. Loading, empty, refresh failure and stale data must remain distinguishable. Keep existing status semantics and data fetching untouched.

## Phase 3: route workflow

1. Stop selection: search/filter tools above available stops and selected stops; collapsible settings; visible selected count and existing proceed action. Keep all current sorting, directional settings, selection, capacity and address behaviours.
2. Manual planning: compact header with explanation and existing four actions. Desktop map approximately 65–70%, route list 30–35%, adapting to available width. Do not remove unassigned slots or group controls.
3. Restriction and detour tools share one UI family. Both collapsed tools share one row; header around 44px; expanded content scrolls at a bounded height. Preserve one Edit/Done toggle, existing code catalogue and Singapore-only visibility. Avoid literal viewport percentage sizing that compromises usability.
4. Preserve map picking, cancel, undo, clear and leg selection. Detour coordinates are visibly navigation-only, not added to delivery totals. Map picking state must be legible without changing map action semantics.
5. Final route page: group summary and actual distance/time/count, ordered stops and existing communication actions. Keep existing warning-but-share-allowed behaviour. No new blocking review page. Map preview/fullscreen prioritise map and compact controls; legends remain readable and collapsible only through presentation state.

## Phase 4: remaining surfaces

1. History: existing filters, counts, selection/loading/deletion and paging; aligned fields and clear action hierarchy. No new filtering logic.
2. Saved stops: existing add/edit/import/manage features remain reachable; readable long addresses, compact list, labelled fields and existing validation errors. Do not redesign data model or import behaviour.
3. Account: current plan, subscription state, usage, comparison and existing controls; show real billing availability, do not invent prices or repair billing service. Preserve feedback/cancellation requirements.
4. Login/signup: same visual family, labelled inputs, existing authentication and errors. No country-limited marketing claims for this global app. Preserve all providers and recovery links.
5. GPS and driver surfaces: visually consistent controls/progress/map, existing capability gating. Do not make coming-soon features appear operational.
6. Public landing/pricing: harmonise shared brand components and typography only. Preserve content, current billing integration and feature truthfulness; do not invent testimonials, metrics, legal text or product screenshots. Record larger content discrepancies separately.

## CSS migration and interaction requirements

Use shared tokens and scoped components. Replace or consolidate conflicting rules where ownership is clear; avoid another unbounded appended !important override layer. Do not delete compatibility styles without checking all consumers. Preserve hidden, disabled and role-controlled states. Keep content accessible when text grows. Keyboard focus visible, semantic controls, reduced-motion support. Loading, empty, error, selected, focus, pressed, disabled and normal states must be considered for affected components.

## Validation and completion

Build and run relevant existing tests with the available bundled Node runtime. Inspect desktop and mobile in a browser. Target widths 320,375,414,768,1024,1440; document exact coverage and limitations, not assumed success. No horizontal page overflow or clipped actions; touch targets at least 44px, no button label wrapping, no bottom-nav occlusion. Check sidebar switching/lazy mounts, settings folding, code and detour controls and map sizing without modifying real accounts. Use isolated fixtures for write interactions if possible.

Capture matching-size preview versus implemented screenshots for dashboard and planner and assess actual geometry, not only DOM text. A successful build or 73 legacy tests does not prove visual parity. Record remaining gaps honestly. New tests only for meaningful changed behaviour, not implementation-mirroring CSS assertions. Record finesse build log/stamp only for genuinely validated completed work, not unfinished work.

Deliver FINESSE-VALIDATION.md listing files, checks, screenshots and limitations; FINESSE-ISSUES.md for out-of-scope findings. Stop before production deployment. If environmental limits prevent browser checks, complete safe local work and report the precise blocked checks. Never silently reduce this contract to cosmetic tweaks.
