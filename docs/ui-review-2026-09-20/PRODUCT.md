# GoRouteX product interface

GoRouteX is an operational route-planning application. A planner selects saved delivery stops, arranges route groups, checks restrictions, adds navigation-only detours where needed, and shares or follows the resulting route. The interface must make the current route state, actionable controls, and source-backed status easy to scan without changing route calculation, storage, access, or billing behavior.

The primary desktop workflow is Dashboard → Plan a route → Stop selection → Manual planning → Final routes. Saved stops, route history, account access, GPS, and driver tracking remain available through their existing guarded entries. Mobile navigation uses plain labels that match the page each entry opens.

The visual language is restrained and operational: cool slate page background, near-white surfaces, blue for primary controls and selection, and orange only for an explicit confirm-route action. Status colours communicate existing states and always retain their text labels. Maps, route-leg colours, restriction indicators, and detour labels remain functional presentation supplied by the existing application state.

The application does not infer delivery success, route safety, synchronisation, pricing, entitlement, ETA, or route data. Loading, empty, stale, error, disabled, selected, and role-limited states keep their existing data and access semantics.
