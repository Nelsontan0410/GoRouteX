# Customer Workspace update — 2026-10-20

## Findings and changes

The previous export and Search → Edit changes are already present. Customer timing still exposed only Settings default versus the full seven-day editor. The shared editor also discarded all receiving intervals and breaks after the first when saving.

- New customers start with Weekdays + Full Day (09:00–18:00, no break). Simple presets are stored using the existing custom schedule model; no schema changes.
- Existing inheriting customers continue using live Settings defaults, including their breaks. The default summary shows the effective schedule.
- Simple timing offers Weekdays/Weekend and Full Day/AM/PM. Selecting no days prevents save.
- Advanced Timing preserves daily hours, breaks and multiple existing intervals. Schedules that cannot be represented exactly by a preset open in advanced mode. Replacing them with a simple preset requires an explicit confirmation.
- Service Time remains available in Advanced details; existing custom service time opens the disclosure automatically.
- The illustrated optional contact section is hidden from ordinary customer management. Order Hub's explicit customer-plus-contact creation still reveals it and retains its associations.
- Save Customer / Save Changes and Cancel are the primary form actions.

## Files

- app.html
- customer-constraints-form.js
- delivery-schedule-editor.js
- styles/delivery-schedule.css
- tests/customer-workspace.test.mjs
- tests/customer-timing.test.mjs

## Validation

- Existing full suite: 488 passed, 0 failed.
- New timing regression suite: 6 passed, 0 failed.
- JavaScript syntax checks and git diff whitespace check passed.
- CSV/XLSX tests verify one UTF-8 BOM, Chinese, CSV escaping and literal XLSX text cells (including leading zero / plus phone numbers and formula-looking values).
- No connected browser was available for desktop/mobile visual verification. No Windows Excel installation was available for actual open-file testing. Neither is claimed as verified.
- No live customer create/edit writes were performed against Firebase.

## Compatibility and scope

CSV remains a faithful data exchange format without cell types. Excel may convert phone numbers or interpret formula-looking content in raw CSV. XLSX is the supported choice for literal spreadsheet display and text-cell formula protection. The existing exporter was not changed in this update.

No Firebase migration, Import changes, ID changes, Order Hub/Dispatch/Planning Engine business-rule changes, merge or deployment. The shared schedule editor also serves Settings; multiple interval preservation applies there, but Settings defaults are unchanged. Unrelated pre-existing Planner working-tree changes were left intact.

Branch: fix/plan-engine-coordinates. Changes remain uncommitted; no commit or PR created.
