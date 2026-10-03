(function (global) {
  const GEO_OPTIONS = {
    enableHighAccuracy: true,
    maximumAge: 10000,
    timeout: 15000
  };
  const UPLOAD_DISTANCE_THRESHOLD_METERS = 35;
  const UPLOAD_TIME_THRESHOLD_MS = 25000;
  const STALE_AFTER_MS = 90000;
  const MAX_ACCEPTED_ACCURACY_METERS = 120;
  const SESSION_STORAGE_KEY = 'grxDriverTracking.currentSession';
  const MAP_TRACE_LIMIT = 600;
  const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const STATUS_META = {
    ready: { label: 'Ready', chipClass: 'is-ready' },
    active: { label: 'Active', chipClass: 'is-active' },
    paused: { label: 'Paused', chipClass: 'is-paused' },
    stopped: { label: 'Stopped', chipClass: 'is-stopped' },
    error: { label: 'Error', chipClass: 'is-error' },
    offline: { label: 'Offline', chipClass: 'is-offline' },
    stale: { label: 'Stale', chipClass: 'is-stale' }
  };

  const dom = {};
  const state = {
    authUser: null,
    profile: null,
    accessContext: null,
    trackingContext: {
      driverId: '',
      driverName: '',
      routeId: '',
      routeName: ''
    },
    sessionId: '',
    sessionSnapshot: null,
    sessionCreatedInCloud: false,
    runtimeStatus: 'ready',
    remoteSessionStatus: null,
    permissionState: 'checking',
    networkState: navigator.onLine ? 'online' : 'offline',
    lastKnownPosition: null,
    lastUploadedAt: null,
    lastUploadedPosition: null,
    lastUploadError: '',
    statusMessage: 'Waiting for your action.',
    watchId: null,
    tracePoints: [],
    pageVisible: !document.hidden,
    mapApiReady: Boolean(global.google && global.google.maps),
    map: null,
    mapMarker: null,
    accuracyCircle: null,
    traceLine: null,
    mapCenteredOnce: false,
    statusTimer: null,
    authUnsubscribe: null,
    domReady: false,
    bootstrapComplete: false,
    routeUnlocked: false,
    uploadPending: false,
    uploadPromise: null,
    pendingStopSync: false
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function sanitizeText(value, fallback = '', maxLength = 120) {
    if (value === undefined || value === null) return fallback;
    const cleanValue = String(value)
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .trim()
      .slice(0, maxLength);
    return cleanValue || fallback;
  }

  function sanitizeId(value, fallback = '', maxLength = 80) {
    if (value === undefined || value === null) return fallback;
    const cleanValue = String(value)
      .trim()
      .replace(/[^a-zA-Z0-9:_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, maxLength);
    return cleanValue || fallback;
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value.toDate === 'function') {
      const converted = value.toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDateTime(value) {
    const dateValue = toDate(value);
    return dateValue ? DATE_TIME_FORMATTER.format(dateValue) : 'Not available';
  }

  function formatRelativeTime(value) {
    const dateValue = toDate(value);
    if (!dateValue) return 'No upload yet';
    const diffMs = Date.now() - dateValue.getTime();
    if (diffMs < 30000) return 'Just now';
    if (diffMs < 60000) return `${Math.max(1, Math.round(diffMs / 1000))} seconds ago`;
    if (diffMs < 3600000) return `${Math.round(diffMs / 60000)} minutes ago`;
    if (diffMs < 86400000) return `${Math.round(diffMs / 3600000)} hours ago`;
    return `${Math.round(diffMs / 86400000)} days ago`;
  }

  function formatCoordinates(position) {
    if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
      return 'Not available';
    }
    return `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
  }

  function formatAccuracy(position) {
    if (!position || typeof position.accuracy !== 'number') {
      return 'Waiting for GPS';
    }
    return `+/- ${Math.round(position.accuracy)} m`;
  }

  function formatSpeed(position) {
    if (!position || typeof position.speed !== 'number' || Number.isNaN(position.speed)) {
      return '';
    }
    return `${(position.speed * 3.6).toFixed(1)} km/h`;
  }

  function buildCurrentTarget() {
    const fileName = window.location.pathname.split('/').pop() || 'driver-tracking.html';
    return `${fileName}${window.location.search || ''}`;
  }

  function buildLoginHref() {
    return `login.html?next=${encodeURIComponent(buildCurrentTarget())}`;
  }

  function getDisplayStatus() {
    if (state.runtimeStatus === 'error') return 'error';
    if (state.runtimeStatus === 'paused') return state.networkState === 'offline' ? 'offline' : 'paused';
    if (state.runtimeStatus === 'stopped') return 'stopped';
    if (state.runtimeStatus === 'active') {
      if (state.networkState === 'offline') return 'offline';
      if (state.lastUploadedAt && (Date.now() - state.lastUploadedAt.getTime()) > STALE_AFTER_MS) return 'stale';
      return 'active';
    }
    if (state.remoteSessionStatus === 'active' && state.sessionId) return 'stale';
    if (state.remoteSessionStatus === 'paused') return 'paused';
    if (state.remoteSessionStatus === 'stopped') return 'stopped';
    return 'ready';
  }

  function getStatusMeta() {
    return STATUS_META[getDisplayStatus()] || STATUS_META.ready;
  }

  function generateClientSessionId() {
    return `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function readQueryContext() {
    const params = new URLSearchParams(window.location.search);
    return {
      routeId: sanitizeId(params.get('routeId'), ''),
      routeName: sanitizeText(params.get('routeName'), ''),
      driverId: sanitizeId(params.get('driverId'), ''),
      driverName: sanitizeText(params.get('driverName'), ''),
      sessionId: sanitizeId(params.get('sessionId'), '')
    };
  }

  function loadStoredSession() {
    try {
      const rawValue = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!rawValue) return null;
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function persistSessionState() {
    if (!state.authUser || !state.sessionId || (getDisplayStatus() === 'stopped' && !state.pendingStopSync)) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    const payload = {
      ownerUid: state.authUser.uid,
      driverId: state.trackingContext.driverId,
      driverName: state.trackingContext.driverName,
      routeId: state.trackingContext.routeId || '',
      routeName: state.trackingContext.routeName || '',
      sessionId: state.sessionId,
      status: state.remoteSessionStatus || state.runtimeStatus || 'ready',
      sessionCreatedInCloud: state.sessionCreatedInCloud,
      pendingStopSync: state.pendingStopSync,
      updatedAt: new Date().toISOString()
    };

    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  }

  function clearStoredSession() {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function setLoadingScreen() {
    dom.loadingScreen.hidden = false;
    dom.blockedScreen.hidden = true;
    dom.workspace.hidden = true;
  }

  function setBlockedScreen(title, message, primaryLabel, primaryHref, secondaryLabel, secondaryHref) {
    dom.blockedTitle.textContent = title;
    dom.blockedMessage.textContent = message;
    dom.blockedPrimaryAction.textContent = primaryLabel;
    dom.blockedPrimaryAction.href = primaryHref;
    dom.blockedSecondaryAction.textContent = secondaryLabel;
    dom.blockedSecondaryAction.href = secondaryHref;
    dom.loadingScreen.hidden = true;
    dom.blockedScreen.hidden = false;
    dom.workspace.hidden = true;
  }

  function setWorkspaceVisible() {
    dom.loadingScreen.hidden = true;
    dom.blockedScreen.hidden = true;
    dom.workspace.hidden = false;
  }

  function updateStatusChip(element, statusKey, labelOverride) {
    if (!element) return;
    const meta = STATUS_META[statusKey] || STATUS_META.ready;
    element.className = `tracking-status-chip ${meta.chipClass}`;
    element.textContent = labelOverride || meta.label;
  }

  function buildPrimaryWarning() {
    if (state.permissionState === 'denied') {
      return 'Location permission is denied. Enable GPS access in browser settings before starting tracking.';
    }
    if (state.networkState === 'offline') {
      return 'You are offline. GPS can still update locally, but live uploads will wait until the connection returns.';
    }
    if (state.lastUploadError) {
      return state.lastUploadError;
    }
    if (state.runtimeStatus === 'error') {
      return state.statusMessage;
    }
    if (!state.pageVisible && state.runtimeStatus === 'active') {
      return 'This page is in the background. Some mobile browsers reduce or stop GPS updates when the page is not visible.';
    }
    return '';
  }

  function permissionLabel(permissionState) {
    switch (permissionState) {
      case 'granted':
        return { value: 'Allowed', meta: 'Browser can access precise location' };
      case 'prompt':
        return { value: 'Prompt', meta: 'Location access will be requested when tracking starts' };
      case 'denied':
        return { value: 'Denied', meta: 'Turn location access back on in browser settings' };
      case 'unsupported':
        return { value: 'Unsupported', meta: 'This browser does not expose geolocation permission state' };
      default:
        return { value: 'Checking', meta: 'Reading browser permission state' };
    }
  }

  function renderContextNotice() {
    const notices = [];
    if (!state.trackingContext.routeId && !state.trackingContext.routeName) {
      notices.push('Select an assigned route and start it before sharing location.');
    }
    if (state.sessionId && !state.sessionCreatedInCloud && state.networkState === 'offline') {
      notices.push('A local session is ready, but the cloud session will not appear until the device is online.');
    }

    if (notices.length === 0) {
      dom.contextNotice.hidden = true;
      dom.contextNoticeText.textContent = '';
      return;
    }

    dom.contextNotice.hidden = false;
    dom.contextNoticeText.textContent = notices.join(' ');
  }

  function renderInfoCards() {
    const statusMeta = getStatusMeta();
    const permissionMeta = permissionLabel(state.permissionState);
    const routeTitle = state.trackingContext.routeName || (state.trackingContext.routeId ? `Route ${state.trackingContext.routeId}` : 'No active route');
    const routeMeta = state.trackingContext.routeId ? `Route ID: ${state.trackingContext.routeId}` : 'No route ID linked';
    const sessionMeta = state.sessionCreatedInCloud
      ? 'Cloud session is visible to this account’s dashboard'
      : 'Cloud session will be created on the next successful upload';

    dom.infoDriverName.textContent = state.trackingContext.driverName || 'Driver';
    dom.infoDriverMeta.textContent = sanitizeText(state.profile?.email || state.authUser?.email || 'Authenticated account');
    dom.infoRouteName.textContent = routeTitle;
    dom.infoRouteMeta.textContent = routeMeta;
    dom.infoSessionId.textContent = state.sessionId || 'Not started';
    dom.infoSessionMeta.textContent = sessionMeta;
    dom.infoTrackingStatus.textContent = statusMeta.label;
    dom.infoTrackingMeta.textContent = state.statusMessage;
    dom.infoLastUpload.textContent = state.lastUploadedAt ? formatDateTime(state.lastUploadedAt) : 'Never uploaded';
    dom.infoLastUploadMeta.textContent = state.lastUploadedAt ? formatRelativeTime(state.lastUploadedAt) : 'No live position has been sent yet';
    dom.infoGpsPermission.textContent = permissionMeta.value;
    dom.infoGpsPermissionMeta.textContent = permissionMeta.meta;
    dom.infoNetworkStatus.textContent = state.networkState === 'online' ? 'Online' : 'Offline';
    dom.infoNetworkMeta.textContent = state.networkState === 'online'
      ? 'Live uploads available'
      : 'Uploads will resume when the connection returns';
    updateStatusChip(dom.driverStatusChip, getDisplayStatus());
  }

  function renderControls() {
    const displayStatus = getDisplayStatus();
    const canStart = state.bootstrapComplete && state.authUser && state.routeUnlocked && state.trackingContext.routeId && state.runtimeStatus !== 'active';
    const canPause = state.runtimeStatus === 'active' || state.runtimeStatus === 'paused';
    const canStop = state.runtimeStatus === 'active'
      || state.runtimeStatus === 'paused'
      || displayStatus === 'stale'
      || displayStatus === 'offline'
      || (state.sessionId && displayStatus === 'error');

    dom.startButton.disabled = !canStart;
    dom.pauseButton.disabled = !canPause;
    dom.stopButton.disabled = !canStop;
    dom.startButton.textContent = displayStatus === 'stale' ? 'Resume Tracking' : 'Start Tracking';
    dom.pauseButton.textContent = state.runtimeStatus === 'paused' ? 'Resume Tracking' : 'Pause Tracking';
  }

  function renderStatusPanel() {
    const statusMeta = getStatusMeta();
    const warningText = buildPrimaryWarning();
    const speedLabel = formatSpeed(state.lastKnownPosition);

    dom.runtimeBanner.textContent = state.statusMessage || 'Waiting for your action.';
    dom.statusPrimaryValue.textContent = statusMeta.label;
    updateStatusChip(dom.statusPrimaryChip, getDisplayStatus());
    dom.statusCoordinatesValue.textContent = formatCoordinates(state.lastKnownPosition);
    dom.statusAccuracyValue.textContent = speedLabel
      ? `${formatAccuracy(state.lastKnownPosition)} | ${speedLabel}`
      : formatAccuracy(state.lastKnownPosition);
    dom.statusLastUploadValue.textContent = state.lastUploadedAt ? formatDateTime(state.lastUploadedAt) : 'Never uploaded';
    dom.statusSessionValue.textContent = state.sessionId || 'Not started';
    dom.statusNetworkValue.textContent = state.networkState === 'online'
      ? 'Online and ready to upload'
      : 'Offline - waiting to reconnect';

    dom.warningBanner.hidden = !warningText;
    dom.warningBanner.textContent = warningText;
  }

  function renderMap() {
    if (!dom.mapFallback) return;

    if (!state.mapApiReady) {
      dom.mapFallback.hidden = false;
      dom.mapFallback.textContent = 'Map preview will appear when Google Maps is available. Tracking still works without it.';
      return;
    }

    if (!state.map) {
      initializeMap();
    }

    if (!state.map) {
      dom.mapFallback.hidden = false;
      dom.mapFallback.textContent = 'Map preview could not be initialized on this device.';
      return;
    }

    dom.mapFallback.hidden = true;

    if (state.traceLine) {
      state.traceLine.setPath(state.tracePoints);
    }

    if (state.lastKnownPosition && state.mapMarker && state.accuracyCircle) {
      const position = { lat: state.lastKnownPosition.lat, lng: state.lastKnownPosition.lng };
      state.mapMarker.setPosition(position);
      state.accuracyCircle.setCenter(position);
      state.accuracyCircle.setRadius(Math.max(0, state.lastKnownPosition.accuracy || 0));
      if (!state.mapCenteredOnce) {
        state.map.setCenter(position);
        state.map.setZoom(16);
        state.mapCenteredOnce = true;
      }
    }
  }

  function renderAll() {
    if (!state.domReady || dom.workspace.hidden) return;
    renderContextNotice();
    renderInfoCards();
    renderControls();
    renderStatusPanel();
    renderMap();
    persistSessionState();
  }

  function stopGeoWatch() {
    if (state.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.watchId);
    }
    state.watchId = null;
  }

  function appendTracePoint(position) {
    if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') return;
    const lastPoint = state.tracePoints.length ? state.tracePoints[state.tracePoints.length - 1] : null;
    if (lastPoint && calculateDistanceMeters(lastPoint, position) < 3) return;

    state.tracePoints.push({ lat: position.lat, lng: position.lng });
    if (state.tracePoints.length > MAP_TRACE_LIMIT) {
      state.tracePoints = state.tracePoints.slice(-MAP_TRACE_LIMIT);
    }
  }

  function initializeMap() {
    if (!state.mapApiReady || state.map || !dom.mapCanvas || !global.google || !global.google.maps) return;

    state.map = new global.google.maps.Map(dom.mapCanvas, {
      center: { lat: 1.3521, lng: 103.8198 },
      zoom: 11,
      disableDefaultUI: true,
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      gestureHandling: 'greedy'
    });

    state.traceLine = new global.google.maps.Polyline({
      map: state.map,
      path: state.tracePoints,
      geodesic: true,
      strokeColor: '#f97316',
      strokeOpacity: 0.9,
      strokeWeight: 4
    });

    state.mapMarker = new global.google.maps.Marker({
      map: state.map,
      title: 'Driver location'
    });

    state.accuracyCircle = new global.google.maps.Circle({
      map: state.map,
      strokeColor: '#2563eb',
      strokeOpacity: 0.22,
      strokeWeight: 1,
      fillColor: '#60a5fa',
      fillOpacity: 0.14,
      radius: 0
    });
  }

  function onMapApiReady() {
    state.mapApiReady = true;
    if (state.domReady) {
      renderMap();
    }
  }

  function calculateDistanceMeters(pointA, pointB) {
    if (!pointA || !pointB) return 0;
    const toRadians = (value) => value * Math.PI / 180;
    const earthRadius = 6371000;
    const latDiff = toRadians(pointB.lat - pointA.lat);
    const lngDiff = toRadians(pointB.lng - pointA.lng);
    const lat1 = toRadians(pointA.lat);
    const lat2 = toRadians(pointB.lat);
    const a = Math.sin(latDiff / 2) * Math.sin(latDiff / 2)
      + Math.cos(lat1) * Math.cos(lat2)
      * Math.sin(lngDiff / 2) * Math.sin(lngDiff / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  }

  function shouldUploadPosition(position, forceUpload) {
    if (forceUpload || !state.lastUploadedPosition || !state.lastUploadedAt) {
      return { shouldUpload: true, distanceMeters: 0 };
    }

    const distanceMeters = calculateDistanceMeters(state.lastUploadedPosition, position);
    const elapsedMs = Date.now() - state.lastUploadedAt.getTime();
    return {
      shouldUpload: distanceMeters >= UPLOAD_DISTANCE_THRESHOLD_METERS || elapsedMs >= UPLOAD_TIME_THRESHOLD_MS,
      distanceMeters
    };
  }

  async function refreshPermissionState() {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      state.permissionState = 'unsupported';
      renderAll();
      return;
    }

    try {
      const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
      state.permissionState = permissionStatus.state;
      permissionStatus.onchange = function () {
        state.permissionState = permissionStatus.state;
        renderAll();
      };
    } catch (error) {
      state.permissionState = 'unsupported';
    }
    renderAll();
  }

  function createPointPayload(position, statusValue, distanceMeters) {
    return {
      sessionId: state.sessionId,
      driverId: state.trackingContext.driverId,
      driverName: state.trackingContext.driverName,
      routeId: state.trackingContext.routeId || '',
      routeName: state.trackingContext.routeName || '',
      lat: position.lat,
      lng: position.lng,
      accuracy: typeof position.accuracy === 'number' ? position.accuracy : null,
      speed: typeof position.speed === 'number' ? position.speed : null,
      heading: typeof position.heading === 'number' ? position.heading : null,
      recordedAt: position.recordedAt,
      status: statusValue,
      networkStatus: state.networkState,
      distanceSinceLastUploadMeters: distanceMeters
    };
  }

  async function ensureCloudSession(statusValue) {
    if (!global.FirebaseApp || !global.FirebaseApp.tracking || !state.authUser) return false;
    if (!state.sessionId) {
      state.sessionId = generateClientSessionId();
    }
    if (state.networkState !== 'online') {
      return false;
    }

    const sessionPayload = {
      sessionId: state.sessionId,
      driverId: state.trackingContext.driverId,
      driverName: state.trackingContext.driverName,
      routeId: state.trackingContext.routeId || '',
      routeName: state.trackingContext.routeName || '',
      status: statusValue,
      networkStatus: state.networkState,
      lat: state.lastKnownPosition?.lat,
      lng: state.lastKnownPosition?.lng,
      accuracy: state.lastKnownPosition?.accuracy,
      speed: state.lastKnownPosition?.speed,
      heading: state.lastKnownPosition?.heading
    };

    try {
      let result;
      if (!state.sessionCreatedInCloud) {
        result = await global.FirebaseApp.tracking.startSession(sessionPayload);
        if (!result.success) throw new Error(result.error || 'Unable to start tracking session');
        state.sessionCreatedInCloud = true;
        state.sessionId = result.sessionId || state.sessionId;
      } else {
        result = await global.FirebaseApp.tracking.updateSession(state.sessionId, sessionPayload);
        if (!result.success) throw new Error(result.error || 'Unable to update tracking session');
      }
      state.remoteSessionStatus = statusValue;
      state.lastUploadError = '';
      persistSessionState();
      return true;
    } catch (error) {
      state.lastUploadError = `Live session sync failed: ${sanitizeText(error.message, 'Unknown error', 180)}`;
      renderAll();
      return false;
    }
  }

  async function uploadCurrentPosition(forceUpload, statusValue) {
    if (state.uploadPromise) return state.uploadPromise;
    if (!state.lastKnownPosition || !global.FirebaseApp?.tracking || state.networkState !== 'online') return false;
    const position = { ...state.lastKnownPosition };
    const uploadDecision = shouldUploadPosition(position, forceUpload);
    if (!uploadDecision.shouldUpload) return false;

    const operation = (async () => {
      state.uploadPending = true;
      try {
        const sessionReady = await ensureCloudSession(statusValue || 'active');
        if (!sessionReady) return false;
        const payload = createPointPayload(position, statusValue || 'active', uploadDecision.distanceMeters);
        const result = await global.FirebaseApp.tracking.recordLocation(payload);
        if (!result.success) {
          state.lastUploadError = `Live upload failed: ${sanitizeText(result.error || 'Unknown error', 'Unknown error', 180)}`;
          renderAll();
          return false;
        }
        state.lastUploadedAt = toDate(payload.recordedAt);
        state.lastUploadedPosition = { lat: payload.lat, lng: payload.lng };
        state.sessionCreatedInCloud = true;
        state.remoteSessionStatus = statusValue || 'active';
        state.lastUploadError = '';
        renderAll();
        return true;
      } catch (error) {
        state.lastUploadError = `Live upload failed: ${sanitizeText(error.message, 'Unknown error', 180)}`;
        renderAll();
        return false;
      } finally {
        state.uploadPending = false;
      }
    })();
    state.uploadPromise = operation;
    try { return await operation; }
    finally { if (state.uploadPromise === operation) state.uploadPromise = null; }
  }

  async function syncStoppedState() {
    if (!state.sessionId || state.networkState !== 'online') return;
    if (await ensureCloudSession('stopped')) { state.pendingStopSync = false; clearStoredSession(); }
  }

  async function startTrackingFlow() {
    if (!state.routeUnlocked || !state.trackingContext.routeId) return false;
    if (!navigator.geolocation) {
      state.runtimeStatus = 'error';
      state.statusMessage = 'Geolocation is not supported by this browser.';
      renderAll();
      return false;
    }

    if (!state.sessionId || getDisplayStatus() === 'stopped') {
      state.sessionId = generateClientSessionId();
      state.sessionCreatedInCloud = false;
      state.sessionSnapshot = null;
      state.remoteSessionStatus = null;
      state.tracePoints = [];
      state.lastUploadedAt = null;
      state.lastUploadedPosition = null;
      state.mapCenteredOnce = false;
    }

    state.runtimeStatus = 'active';
    state.statusMessage = 'Tracking is active. Waiting for a GPS fix and the next eligible upload.';
    state.lastUploadError = '';
    stopGeoWatch();

    if (state.networkState === 'online') {
      await ensureCloudSession('active');
    }

    state.watchId = navigator.geolocation.watchPosition(
      handlePositionSuccess,
      handlePositionError,
      GEO_OPTIONS
    );

    renderAll();
    return true;
  }

  async function pauseTrackingFlow() {
    if (state.runtimeStatus === 'paused') {
      state.runtimeStatus = 'active';
      state.statusMessage = 'Tracking resumed. Live uploads will continue on the next eligible location update.';
      if (state.networkState === 'online') {
        await ensureCloudSession('active');
      }
      state.watchId = navigator.geolocation.watchPosition(
        handlePositionSuccess,
        handlePositionError,
        GEO_OPTIONS
      );
      renderAll();
      return;
    }

    stopGeoWatch();
    if (state.uploadPromise) await state.uploadPromise;
    if (state.lastKnownPosition) {
      await uploadCurrentPosition(true, 'active');
    }

    state.runtimeStatus = 'paused';
    state.statusMessage = 'Tracking is paused. Resume when you are ready to continue uploading live driver positions.';
    if (state.networkState === 'online' && state.sessionId && global.FirebaseApp?.tracking?.updateSession) {
      const pauseResult = await global.FirebaseApp.tracking.updateSession(state.sessionId, {
        driverId: state.trackingContext.driverId,
        driverName: state.trackingContext.driverName,
        routeId: state.trackingContext.routeId || '',
        routeName: state.trackingContext.routeName || '',
        status: 'paused',
        networkStatus: state.networkState,
        lat: state.lastKnownPosition?.lat,
        lng: state.lastKnownPosition?.lng,
        accuracy: state.lastKnownPosition?.accuracy,
        speed: state.lastKnownPosition?.speed,
        heading: state.lastKnownPosition?.heading
      });
      if (pauseResult && pauseResult.success) {
        state.sessionCreatedInCloud = true;
        state.remoteSessionStatus = 'paused';
      } else if (pauseResult && pauseResult.error) {
        state.lastUploadError = `Pause state sync failed: ${sanitizeText(pauseResult.error, 'Unknown error', 180)}`;
      }
    }
    renderAll();
  }

  async function stopTrackingFlow() {
    stopGeoWatch();
    if (state.uploadPromise) await state.uploadPromise;
    if (state.lastKnownPosition && state.networkState === 'online') {
      await uploadCurrentPosition(true, 'active');
    }

    let remoteStopped = false;
    if (state.networkState === 'online' && state.sessionId && global.FirebaseApp?.tracking?.updateSession) {
      const stopResult = await global.FirebaseApp.tracking.updateSession(state.sessionId, {
        driverId: state.trackingContext.driverId,
        driverName: state.trackingContext.driverName,
        routeId: state.trackingContext.routeId || '',
        routeName: state.trackingContext.routeName || '',
        status: 'stopped',
        networkStatus: state.networkState,
        lat: state.lastKnownPosition?.lat,
        lng: state.lastKnownPosition?.lng,
        accuracy: state.lastKnownPosition?.accuracy,
        speed: state.lastKnownPosition?.speed,
        heading: state.lastKnownPosition?.heading
      });
      if (stopResult && stopResult.success) {
        remoteStopped = true;
        state.sessionCreatedInCloud = true;
      } else if (stopResult && stopResult.error) {
        state.lastUploadError = `Stop state sync failed: ${sanitizeText(stopResult.error, 'Unknown error', 180)}`;
      }
    }

    state.runtimeStatus = 'stopped';
    state.remoteSessionStatus = 'stopped';
    state.statusMessage = state.sessionCreatedInCloud
      ? 'Tracking stopped. The latest driver session has been closed cleanly.'
      : 'Tracking stopped locally. No live cloud session was written from this device.';
    state.pendingStopSync = !remoteStopped && state.sessionCreatedInCloud;
    if (!state.pendingStopSync) clearStoredSession();
    renderAll();
    return !state.pendingStopSync;
  }

  function handlePositionSuccess(position) {
    if (state.runtimeStatus !== 'active' || !state.routeUnlocked) return;
    const {latitude,longitude,accuracy}=position.coords;
    if (!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy>MAX_ACCEPTED_ACCURACY_METERS) {
      state.statusMessage = 'Waiting for a usable GPS fix (within 120 m accuracy).';
      renderAll();
      return;
    }
    const nextPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed,
      heading: position.coords.heading,
      recordedAt: new Date().toISOString()
    };

    state.lastKnownPosition = nextPosition;
    appendTracePoint(nextPosition);
    if (state.runtimeStatus !== 'paused' && state.runtimeStatus !== 'stopped') {
      state.runtimeStatus = 'active';
      state.statusMessage = 'Tracking is active and GPS is available.';
    }
    renderAll();
    void uploadCurrentPosition(false, 'active');
  }

  function geolocationErrorMessage(error) {
    if (!error) return 'Location could not be read.';
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return 'Location access was denied by the browser or device settings.';
      case error.POSITION_UNAVAILABLE:
        return 'GPS is temporarily unavailable. Move to a clearer area and try again.';
      case error.TIMEOUT:
        return 'Location request timed out. Keep the page open and try again.';
      default:
        return 'An unknown geolocation error occurred.';
    }
  }

  function handlePositionError(error) {
    if (error && error.code === error.PERMISSION_DENIED) {
      state.permissionState = 'denied';
    }
    state.runtimeStatus = 'error';
    state.statusMessage = geolocationErrorMessage(error);
    stopGeoWatch();
    if (state.networkState === 'online' && state.sessionId && global.FirebaseApp?.tracking?.updateSession) {
      void global.FirebaseApp.tracking.updateSession(state.sessionId, {
        driverId: state.trackingContext.driverId,
        driverName: state.trackingContext.driverName,
        routeId: state.trackingContext.routeId || '',
        routeName: state.trackingContext.routeName || '',
        status: 'error',
        networkStatus: state.networkState,
        errorCode: error && typeof error.code !== 'undefined' ? String(error.code) : 'unknown',
        errorMessage: state.statusMessage,
        lat: state.lastKnownPosition?.lat,
        lng: state.lastKnownPosition?.lng,
        accuracy: state.lastKnownPosition?.accuracy
      }).then((errorResult) => {
        if (errorResult && errorResult.success) {
          state.sessionCreatedInCloud = true;
          state.remoteSessionStatus = 'error';
        } else if (errorResult && errorResult.error) {
          state.lastUploadError = `Error state sync failed: ${sanitizeText(errorResult.error, 'Unknown error', 180)}`;
          renderAll();
        }
      });
    }
    renderAll();
  }

  async function loadExistingSession() {
    if (!state.sessionId || !global.FirebaseApp?.tracking?.loadSession) {
      state.sessionSnapshot = null;
      state.remoteSessionStatus = null;
      return;
    }

    const sessionResult = await global.FirebaseApp.tracking.loadSession(state.sessionId);
    if (!sessionResult.success || !sessionResult.session) {
      state.sessionSnapshot = null;
      state.remoteSessionStatus = null;
      return;
    }

    const session = sessionResult.session;
    state.sessionSnapshot = session;
    state.sessionCreatedInCloud = true;
    state.remoteSessionStatus = sanitizeText(session.status, '');
    state.trackingContext.driverId = sanitizeId(session.driverId, state.trackingContext.driverId || state.authUser?.uid || 'driver');
    state.trackingContext.driverName = sanitizeText(session.driverName, state.trackingContext.driverName || 'Driver');
    state.trackingContext.routeId = sanitizeId(session.routeId, state.trackingContext.routeId || '');
    state.trackingContext.routeName = sanitizeText(session.routeName, state.trackingContext.routeName || '');
    state.lastUploadedAt = toDate(session.lastUploadedClientAt || session.updatedAt || session.lastHeartbeatAt);

    if (typeof session.lastKnownLat === 'number' && typeof session.lastKnownLng === 'number') {
      state.lastKnownPosition = {
        lat: session.lastKnownLat,
        lng: session.lastKnownLng,
        accuracy: typeof session.lastAccuracy === 'number' ? session.lastAccuracy : null,
        speed: typeof session.lastSpeed === 'number' ? session.lastSpeed : null,
        heading: typeof session.lastHeading === 'number' ? session.lastHeading : null,
        recordedAt: session.lastUploadedClientAt || session.updatedAt || session.lastHeartbeatAt || null
      };
      state.lastUploadedPosition = {
        lat: session.lastKnownLat,
        lng: session.lastKnownLng
      };
      appendTracePoint(state.lastKnownPosition);
    }

    if (global.FirebaseApp.tracking.loadSessionPoints) {
      const pointsResult = await global.FirebaseApp.tracking.loadSessionPoints(state.sessionId, { limitCount: 150 });
      if (pointsResult.success && Array.isArray(pointsResult.points) && pointsResult.points.length) {
        state.tracePoints = pointsResult.points
          .filter((point) => typeof point.lat === 'number' && typeof point.lng === 'number')
          .map((point) => ({ lat: point.lat, lng: point.lng }));

        const lastPoint = pointsResult.points[pointsResult.points.length - 1];
        if (lastPoint && typeof lastPoint.lat === 'number' && typeof lastPoint.lng === 'number') {
          state.lastKnownPosition = {
            lat: lastPoint.lat,
            lng: lastPoint.lng,
            accuracy: typeof lastPoint.accuracy === 'number' ? lastPoint.accuracy : state.lastKnownPosition?.accuracy || null,
            speed: typeof lastPoint.speed === 'number' ? lastPoint.speed : state.lastKnownPosition?.speed || null,
            heading: typeof lastPoint.heading === 'number' ? lastPoint.heading : state.lastKnownPosition?.heading || null,
            recordedAt: lastPoint.recordedAt || lastPoint.uploadedAt || state.lastKnownPosition?.recordedAt || null
          };
          state.lastUploadedPosition = { lat: lastPoint.lat, lng: lastPoint.lng };
          state.lastUploadedAt = toDate(lastPoint.recordedAt || lastPoint.uploadedAt || state.lastUploadedAt);
        }
      }
    }

    if (state.remoteSessionStatus === 'paused') {
      state.runtimeStatus = 'paused';
      state.statusMessage = 'A paused tracking session was restored on this device.';
    } else if (state.remoteSessionStatus === 'stopped') {
      state.runtimeStatus = 'stopped';
      state.statusMessage = 'A completed tracking session was restored for reference.';
    } else if (state.remoteSessionStatus === 'active') {
      state.runtimeStatus = 'ready';
      state.statusMessage = 'An active cloud session exists. Tap Start Tracking to resume uploads from this browser.';
    }
  }

  function mergeTrackingContext() {
    const queryContext = readQueryContext();
    const storedSession = loadStoredSession();
    const canReuseStoredSession = Boolean(
      storedSession
      && storedSession.ownerUid === state.authUser?.uid
      && (storedSession.status !== 'stopped' || storedSession.pendingStopSync)
      && (!queryContext.routeId || !storedSession.routeId || queryContext.routeId === storedSession.routeId)
      && (!queryContext.driverId || queryContext.driverId === storedSession.driverId)
    );

    state.trackingContext = {
      driverId: sanitizeId(
        queryContext.driverId
        || (canReuseStoredSession ? storedSession.driverId : '')
        || state.authUser?.uid,
        state.authUser?.uid || 'driver'
      ),
      driverName: sanitizeText(
        queryContext.driverName
        || (canReuseStoredSession ? storedSession.driverName : '')
        || state.profile?.name
        || state.authUser?.displayName
        || state.authUser?.email?.split('@')[0]
        || 'Driver',
        'Driver'
      ),
      routeId: sanitizeId(queryContext.routeId || (canReuseStoredSession ? storedSession.routeId : ''), ''),
      routeName: sanitizeText(queryContext.routeName || (canReuseStoredSession ? storedSession.routeName : ''), ''),
      sessionId: sanitizeId(queryContext.sessionId || (canReuseStoredSession ? storedSession.sessionId : ''), '')
    };

    state.sessionId = state.trackingContext.sessionId || '';
    state.sessionCreatedInCloud = Boolean(canReuseStoredSession && storedSession.sessionCreatedInCloud);
    state.pendingStopSync = Boolean(canReuseStoredSession && storedSession.pendingStopSync);
  }

  async function hydrateWorkspaceForUser(user) {
    state.authUser = user;
    state.bootstrapComplete = false;
    setLoadingScreen();

    let profileResult;
    try {
      profileResult = await global.FirebaseApp.auth.loadProfile(user, { source: 'server' });
    } catch (error) {
      profileResult = { success: false, error: error.message };
    }
    state.profile = profileResult?.success ? (profileResult.profile || {}) : {};
    state.accessContext = global.GoRouteXAccess?.resolveUserContext
      ? global.GoRouteXAccess.resolveUserContext(state.profile || {})
      : null;

    const accessState = global.FirebaseApp.auth.resolveAccessState
      ? global.FirebaseApp.auth.resolveAccessState({ user, profile: state.profile, now: new Date() })
      : 'active';

    if (accessState === 'expired') {
      setBlockedScreen(
        'Tracking access has expired',
        'This account no longer has active GoRouteX access. Renew access in the main app before starting live driver tracking again.',
        'View Pricing',
        'index.html#pricing',
        'Open Main App',
        'app.html#page-history-dashboard'
      );
      return;
    }

    if (state.profile?.active === false) {
      setBlockedScreen(
        'Driver account inactive',
        'Ask your dispatcher to reactivate this Driver account.',
        'Continue to Login',
        buildLoginHref(),
        'Open Main App',
        'app.html#page-history-dashboard'
      );
      return;
    }

    if (!global.FirebaseApp.auth.isDriverAccount?.(user)
        || state.accessContext?.roleKey !== 'driver') {
      setBlockedScreen(
        'Driver account required',
        'This page is available only to an active Driver account.',
        'Open Main App',
        'app.html#page-history-dashboard',
        'Continue to Login',
        buildLoginHref()
      );
      return;
    }

    if (!global.FirebaseApp.tracking) {
      setBlockedScreen(
        'Tracking services are unavailable',
        'Shared Firebase tracking helpers did not initialize correctly on this page.',
        'Open Main App',
        'app.html#page-history-dashboard',
        'Continue to Login',
        buildLoginHref()
      );
      return;
    }

    mergeTrackingContext();
    await loadExistingSession();
    if (state.pendingStopSync && state.networkState === 'online') await syncStoppedState();
    state.bootstrapComplete = true;
    state.statusMessage = state.statusMessage || 'Waiting for your action.';
    setWorkspaceVisible();
    renderAll();
    window.dispatchEvent(new CustomEvent('goroutex:tracking-ready'));
  }

  async function handleAuthStateChanged(user) {
    stopGeoWatch();
    state.runtimeStatus = 'ready';
    state.lastUploadError = '';
    state.sessionSnapshot = null;
    state.remoteSessionStatus = null;
    state.sessionCreatedInCloud = false;
    state.bootstrapComplete = false;
    state.sessionId = '';
    state.routeUnlocked = false;
    state.pendingStopSync = false;
    state.lastKnownPosition = null;
    state.lastUploadedAt = null;
    state.lastUploadedPosition = null;
    state.tracePoints = [];
    state.mapCenteredOnce = false;

    if (!user) {
      state.authUser = null;
      state.profile = null;
      state.accessContext = null;
      clearStoredSession();
      setBlockedScreen(
        'Sign in required',
        'Sign in before starting the dedicated driver tracking workspace. Your tracking link and route context will be preserved after login.',
        'Continue to Login',
        buildLoginHref(),
        'Open Main App',
        'app.html#page-history-dashboard'
      );
      return;
    }

    await hydrateWorkspaceForUser(user);
  }

  function handleOnline() {
    state.networkState = 'online';
    if (state.runtimeStatus === 'active' && state.lastKnownPosition) {
      void uploadCurrentPosition(true, 'active');
    } else if (state.runtimeStatus === 'paused' && state.sessionId) {
      void ensureCloudSession('paused');
    } else if (state.runtimeStatus === 'stopped' && state.sessionId) {
      void syncStoppedState();
    }
    renderAll();
  }

  function handleOffline() {
    state.networkState = 'offline';
    renderAll();
  }

  function bindEvents() {
    byId('driverSignOutBtn').addEventListener('click', async () => {
      try {
        await global.FirebaseApp?.auth?.signOut?.();
      } finally {
        window.location.href = 'login.html';
      }
    });
    dom.startButton.addEventListener('click', () => {
      void startTrackingFlow();
    });
    dom.pauseButton.addEventListener('click', () => {
      void pauseTrackingFlow();
    });
    dom.stopButton.addEventListener('click', () => {
      void stopTrackingFlow();
    });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', () => {
      state.pageVisible = !document.hidden;
      renderAll();
    });
  }

  function initDom() {
    dom.loadingScreen = byId('trackingLoadingScreen');
    dom.blockedScreen = byId('trackingBlockedScreen');
    dom.workspace = byId('trackingWorkspace');
    dom.blockedTitle = byId('blockedTitle');
    dom.blockedMessage = byId('blockedMessage');
    dom.blockedPrimaryAction = byId('blockedPrimaryAction');
    dom.blockedSecondaryAction = byId('blockedSecondaryAction');
    dom.driverStatusChip = byId('driverStatusChip');
    dom.contextNotice = byId('trackingContextNotice');
    dom.contextNoticeText = byId('trackingContextNoticeText');
    dom.infoDriverName = byId('infoDriverName');
    dom.infoDriverMeta = byId('infoDriverMeta');
    dom.infoRouteName = byId('infoRouteName');
    dom.infoRouteMeta = byId('infoRouteMeta');
    dom.infoSessionId = byId('infoSessionId');
    dom.infoSessionMeta = byId('infoSessionMeta');
    dom.infoTrackingStatus = byId('infoTrackingStatus');
    dom.infoTrackingMeta = byId('infoTrackingMeta');
    dom.infoLastUpload = byId('infoLastUpload');
    dom.infoLastUploadMeta = byId('infoLastUploadMeta');
    dom.infoGpsPermission = byId('infoGpsPermission');
    dom.infoGpsPermissionMeta = byId('infoGpsPermissionMeta');
    dom.infoNetworkStatus = byId('infoNetworkStatus');
    dom.infoNetworkMeta = byId('infoNetworkMeta');
    dom.startButton = byId('trackingStartBtn');
    dom.pauseButton = byId('trackingPauseBtn');
    dom.stopButton = byId('trackingStopBtn');
    dom.runtimeBanner = byId('trackingRuntimeBanner');
    dom.statusPrimaryValue = byId('statusPrimaryValue');
    dom.statusPrimaryChip = byId('statusPrimaryChip');
    dom.statusCoordinatesValue = byId('statusCoordinatesValue');
    dom.statusAccuracyValue = byId('statusAccuracyValue');
    dom.statusLastUploadValue = byId('statusLastUploadValue');
    dom.statusSessionValue = byId('statusSessionValue');
    dom.statusNetworkValue = byId('statusNetworkValue');
    dom.warningBanner = byId('trackingWarningBanner');
    dom.mapCanvas = byId('trackingMap');
    dom.mapFallback = byId('trackingMapFallback');
    state.domReady = true;
  }

  async function bootstrap() {
    initDom();
    bindEvents();
    setLoadingScreen();
    await refreshPermissionState();

    const initOk = global.FirebaseApp?.isInitialized?.() || global.FirebaseApp?.init?.();
    if (!initOk || !global.FirebaseApp?.auth) {
      setBlockedScreen(
        'Tracking failed to initialize',
        'The dedicated driver tracking page could not initialize Firebase authentication on this device.',
        'Continue to Login',
        buildLoginHref(),
        'Open Main App',
        'app.html#page-history-dashboard'
      );
      return;
    }

    const hasAuthListener = typeof global.FirebaseApp.auth.onAuthStateChange === 'function';
    if (hasAuthListener) {
      state.authUnsubscribe = global.FirebaseApp.auth.onAuthStateChange((user) => {
        void handleAuthStateChanged(user);
      });
    }

    if (!hasAuthListener) {
      await handleAuthStateChanged(global.FirebaseApp.auth.getCurrentUser ? global.FirebaseApp.auth.getCurrentUser() : null);
    }

    if (global.__driverTrackingMapReady) {
      onMapApiReady();
    }

    state.statusTimer = window.setInterval(() => {
      renderAll();
    }, 15000);
  }

  function setRouteContext(route) {
    if (!state.authUser || route?.assignedDriverUid !== state.authUser.uid) throw Error('Route is not assigned to this account.');
    const routeId = sanitizeId(route.id, '');
    if (!routeId) throw Error('Route ID is missing.');
    if (state.trackingContext.routeId && state.trackingContext.routeId !== routeId && state.watchId !== null) throw Error('Stop the active route before changing routes.');
    if (state.trackingContext.routeId !== routeId) { state.sessionId = ''; state.sessionCreatedInCloud = false; state.lastUploadedAt = null; state.lastUploadedPosition = null; }
    state.trackingContext = { driverId: state.authUser.uid, driverName: sanitizeText(state.authUser.displayName || state.authUser.email || 'Driver'), routeId, routeName: sanitizeText(route.routeName || `Route ${routeId}`) };
    state.routeUnlocked = true;
    renderAll();
  }
  global.DriverTrackingPage = { onMapApiReady, setRouteContext, startTracking: startTrackingFlow, stopTracking: stopTrackingFlow, getLatestPosition: () => state.lastKnownPosition, getStatus: () => getDisplayStatus(), isReady: () => state.bootstrapComplete };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void bootstrap(); }, { once: true });
  else void bootstrap();
})(window);
