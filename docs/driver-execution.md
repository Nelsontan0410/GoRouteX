# Driver Page and route execution

The existing dedicated `driver-tracking.html` page now carries the driver route workflow. Route Planning remains the source of saved plans. New history entries gain `assignedDriverUid`, set to the signed-in account UID; the Vehicle / Driver selection remains a display label. Firestore rules currently allow only the account owner to access `users/{uid}`. Separate driver logins and shared team assignment require an access model change and are not implied by a driver label. Routes saved before this feature have no assignment UID and must be saved again to appear on Driver Page.

The Driver Page lists only saved routes assigned to the signed-in UID. Cloud accounts use `users/{uid}/history`; local plan mode uses the existing IndexedDB history adapter. Start creates an immutable execution snapshot in `users/{uid}/driverExecutions/{routeId}` or a device-local IndexedDB record. It never rewrites the planning history. Each stop has its own stable execution ID, planned address/contact/order reference snapshot, status, and actual timestamps. Stops progress through PENDING → ARRIVED → DELIVERED or PENDING/ARRIVED → FAILED. Failed stops remain failed. The next unprocessed stop becomes current automatically; completion requires all stops processed and an explicit button.

POD is stored separately at `users/{uid}/driverPods/{routeId_stopId}` or device-local IndexedDB. Optional recipient name, notes, and photo are supported. Photos are resized/compressed and saved separately in `driverPodPhotos` with a 550,000-character data URL cap; execution documents contain only the POD ID. No signature setting or signature service exists, so signatures are not collected. The existing Contact Required setting controls the missing-contact warning, but it does not block delivery or select a different contact. When a route is saved, ready Order Hub orders for the exact planning date are linked by exact Saved Stop ID. Duplicate appearances of the same Saved Stop are left unlinked for review; failed Order Hub reads are marked on the route. The stop snapshot stores Order Hub internal IDs and customer-facing Order IDs. Where a planned stop carries these explicit Order Hub internal IDs, cloud-mode delivery/failure writes `executionStatus`, `driverRouteId`, and `executionUpdatedAt` to those orders without overwriting their intake/readiness `status`. Existing route plans without order IDs cannot be linked safely by guesswork.

Start Route starts the existing `driver-tracking.js` geolocation watch. Position accuracy must be within 120 m; uploads occur after 35 m of movement or 25 s since the last successful upload. The existing Firebase tracking helper updates `tracking_sessions`, `drivers_live`, and throttled point history. The dashboard Driver execution panel reads execution snapshots and subscribes to the current account's `drivers_live` latest locations. It shows progress, current stop, coordinates, last update, and stale state after 90 s. Completing the route clears the browser watch and marks the tracking session stopped. A saved pending stop-status sync retries when the page reloads or the connection returns.

Tracking depends on the web page and browser permitting GPS callbacks. Closing the page, phone lock, battery restrictions, or browser suspension can stop updates. No native background service, service worker offline cache, or durable GPS point queue is implemented. While offline, the page keeps only its latest GPS fix in memory and tries to upload that latest fix when online. Route execution uses Firestore transactions in cloud mode and IndexedDB records in local mode. Firestore SDK offline behavior is separate from this feature; the app does not claim a custom offline mutation queue.

## Live GPS diagnostics (web)

**Limitation.** A web page cannot keep sending GPS while Google Maps is in front: Android Chrome freezes the page in the background. Positions resume when the driver returns to GoRouteX. Continuous tracking during navigation needs the native driver app (planned, `com.goroutex.driver`).

**First fix.** Start Route also takes a one-off high-accuracy reading next to the watch. Android often reports a coarse position first. If no fix within 120 m arrives within `FIRST_FIX_WAIT_MS` (8 s), the best coarse fix within `MAX_APPROX_ACCURACY_METERS` (1500 m) is sent **once** as the live position, with `approximate: true` and its `accuracy`. It is written only to the live document (via `updateSession`), never to `points` or the map trace. Later uploads keep the 120 m rule, and the first accurate upload clears `approximate`.

**Before opening Maps.** During a route, a tap on a "Part N" link first sends the current position (waiting at most 1500 ms), then opens Maps in the same tab. `window.open` after a wait would be blocked as a popup. In the native app (`DriverTrackingPage.isNativeMode()`), Maps opens at once.

**Live document fields** (`users/{driverUid}/drivers_live/{driverUid}`; added, none renamed):
- `positionAt`: server time of the position itself. `lastUpdatedAt` also moves on status-only writes, so the office uses `positionAt` for age.
- `approximate`: the position is a coarse first fix.
- `gpsHint` / `gpsHintAt`: why the office may not see a fresh position, written best effort by the phone:
  - `OK`: positions are uploading.
  - `WAITING_FIRST_FIX`: tracking started; no usable fix yet.
  - `UPLOAD_FAILED`: the phone could not write its position (see the driver's alert for the error).
  - `PAGE_BACKGROUND`: GoRouteX went to the background, usually Google Maps; updates may stop.
  - `PERMISSION_DENIED`: location permission is off.
  - `OFFLINE`: accepted, but a web page cannot send it while offline. The office relies on `networkStatus` and the position age instead.

**Office rules** (`driver/live-view-model.js`, `gpsState`):
- No position: show the hint, else "Waiting for the driver's first GPS fix".
- Position at most `LIVE_FRESH_MS` (2 min) old: live, or "Approximate position ±N m".
- 2–10 min: "Last position N min ago", plus the hint's reason.
- More than `LIVE_STALE_WARN_MS` (10 min): a warning, "No GPS update for N min".

**Driver alert.** `DriverTrackingPage.getProblem()` returns `PERMISSION_DENIED`, `PERMISSION_PROMPT`, `OFFLINE`, `UPLOAD_FAILED`, `WAITING_FIRST_FIX` or `ERROR`. The driver page shows it with Retry.

**Screen wake lock.** It keeps the screen on while the driver page is in front during an active route, and is released on pause, stop or finish. It does not help while Maps is in front, because the browser releases it when the page is hidden.

**Field debugging.** On the phone, run `localStorage.debugTracking = '1'` and reload. Each fix (accepted or rejected, with its accuracy), each upload result and each hint is then logged to the console. On Android, inspect it from a computer at `chrome://inspect` with USB debugging on. Set the value back to `'0'` to stop.

The existing full-data deletion action now removes the signed-in account’s local Driver execution/POD/photo records; the Firebase account deletion helper removes the three corresponding cloud collections.
