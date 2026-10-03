const MapHandler = (() => {
    const routeRenderers = [];
    const routeMarkers = [];
    const MAX_VISIBLE_MARKERS = 100;
    let markerClustererLoadPromise = null;
    let lastRouteMap = null;
    let lastRoutes = [];

    function isReady() {
        return !!(window.google && window.google.maps);
    }

    function hasAdvancedMarker() {
        return !!(isReady() && google.maps.marker?.AdvancedMarkerElement && google.maps.marker?.PinElement);
    }

    function initMap(elementOrId, options = {}) {
        if (!isReady()) return null;
        const element = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
        if (!element) return null;
        const map = new google.maps.Map(element, options);
        window.RouteSafety?.registerMap(map);
        return map;
    }

    function initDirectionsService() {
        return isReady() ? new google.maps.DirectionsService() : null;
    }

    function initDirectionsRenderer(options = {}) {
        return isReady() ? new google.maps.DirectionsRenderer(options) : null;
    }

    function initGeocoder() {
        return isReady() ? new google.maps.Geocoder() : null;
    }

    function initAutocomplete(input, options = {}) {
        if (!isReady() || !google.maps.places?.Autocomplete || !input) return null;
        return new google.maps.places.Autocomplete(input, options);
    }

    function createLatLngBounds() {
        return isReady() ? new google.maps.LatLngBounds() : null;
    }

    function createAdvancedMarker(options = {}) {
        return hasAdvancedMarker() ? new google.maps.marker.AdvancedMarkerElement(options) : null;
    }

    function createPin(options = {}) {
        return hasAdvancedMarker() ? new google.maps.marker.PinElement(options) : null;
    }

    function createMarker(options = {}) {
        return isReady() ? new google.maps.Marker(options) : null;
    }

    function createPolyline(options = {}) {
        return isReady() ? new google.maps.Polyline(options) : null;
    }

    function createInfoWindow(options = {}) {
        return isReady() ? new google.maps.InfoWindow(options) : null;
    }

    function createSize(width, height) {
        return isReady() ? new google.maps.Size(width, height) : null;
    }

    function createPoint(x, y) {
        return isReady() ? new google.maps.Point(x, y) : null;
    }

    function triggerResize(map) {
        if (isReady() && map) google.maps.event.trigger(map, 'resize');
    }

    function addListener(target, eventName, handler) {
        return isReady() ? google.maps.event.addListener(target, eventName, handler) : null;
    }

    function removeListener(listener) {
        if (isReady() && listener) google.maps.event.removeListener(listener);
    }

    function setDirections(renderer, directions) {
        if (renderer) renderer.setDirections(directions);
    }

    function clearDirections(renderer) {
        setDirections(renderer, { routes: [] });
    }

    function clearRendererMap(renderer) {
        if (renderer) renderer.setMap(null);
    }

    function setRendererMap(renderer, mapInstance) {
        if (renderer && typeof renderer.setMap === 'function') renderer.setMap(mapInstance || null);
    }

    function panTo(mapInstance, position) {
        if (mapInstance && position && typeof mapInstance.panTo === 'function') mapInstance.panTo(position);
    }

    function addObjectListener(target, eventName, handler) {
        return target && typeof target.addListener === 'function'
            ? target.addListener(eventName, handler)
            : null;
    }

    function openInfoWindow(infoWindow, mapInstance, marker) {
        if (infoWindow && typeof infoWindow.open === 'function') infoWindow.open(mapInstance, marker);
    }

    function extendBounds(bounds, position) {
        if (bounds && position && typeof bounds.extend === 'function') bounds.extend(position);
    }

    function getMarkerPosition(marker) {
        return marker && typeof marker.getPosition === 'function' ? marker.getPosition() : null;
    }

    function route(service, request, callback) {
        if (!service) {
            if (callback) {
                callback(null, 'NO_DIRECTIONS_SERVICE');
                return null;
            }
            return Promise.reject('NO_DIRECTIONS_SERVICE');
        }
        if (callback) return service.route(request, callback);
        return service.route(request);
    }

    function geocode(geocoder, request, callback) {
        if (!geocoder) {
            if (callback) {
                callback([], 'NO_GEOCODER');
                return null;
            }
            return Promise.reject('NO_GEOCODER');
        }
        if (callback) return geocoder.geocode(request, callback);
        return geocoder.geocode(request);
    }

    function setCenter(mapInstance, center) {
        if (mapInstance && center) mapInstance.setCenter(center);
    }

    function setZoom(mapInstance, zoom) {
        if (mapInstance && Number.isFinite(Number(zoom))) mapInstance.setZoom(Number(zoom));
    }

    function getZoom(mapInstance) {
        return mapInstance && typeof mapInstance.getZoom === 'function' ? mapInstance.getZoom() : 0;
    }

    function fitBounds(mapInstance, bounds) {
        if (mapInstance && bounds) mapInstance.fitBounds(bounds);
    }

    function fitMapToMarkers(mapInstance, markersToFit) {
        if (!mapInstance || !Array.isArray(markersToFit) || markersToFit.length === 0) return;
        const bounds = createLatLngBounds();
        if (!bounds) return;
        markersToFit.forEach(marker => {
            if (marker.position) bounds.extend(marker.position);
        });
        fitBounds(mapInstance, bounds);
    }

    function getMarkerLatLng(position) {
        if (!position) return null;
        if (typeof position.lat === 'function' && typeof position.lng === 'function') {
            return { lat: position.lat(), lng: position.lng() };
        }
        const lat = Number(position.lat);
        const lng = Number(position.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    }

    function isPositionInBounds(mapInstance, position) {
        if (!mapInstance || typeof mapInstance.getBounds !== 'function') return true;
        const bounds = mapInstance.getBounds();
        const latLng = getMarkerLatLng(position);
        if (!bounds || !latLng || typeof bounds.contains !== 'function') return true;
        return bounds.contains(latLng);
    }

    function limitMarkerCandidates(mapInstance, candidates = [], maxMarkers = MAX_VISIBLE_MARKERS) {
        const normalized = Array.isArray(candidates) ? candidates.filter((candidate) => candidate && candidate.position) : [];
        const visibleCandidates = normalized.filter((candidate) => isPositionInBounds(mapInstance, candidate.position));
        const source = visibleCandidates.length > 0 ? visibleCandidates : normalized;
        return source.slice(0, Math.max(1, Math.min(Number(maxMarkers) || MAX_VISIBLE_MARKERS, MAX_VISIBLE_MARKERS)));
    }

    function loadMarkerClusterer() {
        if (window.markerClusterer?.MarkerClusterer) {
            return Promise.resolve(window.markerClusterer.MarkerClusterer);
        }
        if (markerClustererLoadPromise) return markerClustererLoadPromise;

        markerClustererLoadPromise = new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-goroutex-markerclusterer="true"]');
            if (existingScript) {
                existingScript.addEventListener('load', () => resolve(window.markerClusterer?.MarkerClusterer || null), { once: true });
                existingScript.addEventListener('error', () => reject(new Error('Marker clusterer could not be loaded.')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js';
            script.async = true;
            script.defer = true;
            script.dataset.goroutexMarkerclusterer = 'true';
            script.onload = () => resolve(window.markerClusterer?.MarkerClusterer || null);
            script.onerror = () => {
                markerClustererLoadPromise = null;
                reject(new Error('Marker clusterer could not be loaded.'));
            };
            document.head.appendChild(script);
        });

        return markerClustererLoadPromise;
    }

    function applyMarkerCluster() {
        return Promise.resolve(null);
    }

    function clearCluster(cluster) {
        if (cluster && typeof cluster.clearMarkers === 'function') {
            cluster.clearMarkers();
        } else if (cluster && typeof cluster.setMap === 'function') {
            cluster.setMap(null);
        }
    }

    function clearMarkers(markers = routeMarkers) {
        markers.forEach((marker) => {
            if (marker) marker.map = null;
            if (marker && typeof marker.setMap === 'function') marker.setMap(null);
        });
        markers.length = 0;
    }

    function clearRoutes(renderers = routeRenderers) {
        renderers.forEach((renderer) => clearRendererMap(renderer));
        renderers.length = 0;
        if (renderers === routeRenderers) {
            lastRoutes = [];
        }
    }

    function addMarkers(stops, map, color = '#1E90FF') {
        if (!Array.isArray(stops) || !map) return [];
        const markers = [];
        stops.forEach((stop, index) => {
            const position = stop?.position || (Number.isFinite(Number(stop?.lat)) && Number.isFinite(Number(stop?.lng))
                ? { lat: Number(stop.lat), lng: Number(stop.lng) }
                : null);
            if (!position) return;
            const marker = createAdvancedMarker({
                position,
                map,
                title: stop.name || stop.label || `Stop ${index + 1}`
            });
            const pin = createPin({
                background: color,
                borderColor: '#fff',
                glyphColor: '#fff',
                glyph: String(index + 1)
            });
            if (marker && pin) marker.content = pin.element;
            if (marker) markers.push(marker);
        });
        routeMarkers.push(...markers);
        return markers;
    }

    function renderRoute(route, map, options = {}) {
        if (!route || !route.directionsResult || !map) return null;
        const renderer = initDirectionsRenderer({
            map,
            suppressMarkers: options.suppressMarkers !== false,
            polylineOptions: {
                strokeColor: route.color || options.color || '#1E90FF',
                strokeOpacity: options.strokeOpacity ?? 0.9,
                strokeWeight: options.strokeWeight || 5
            }
        });
        setDirections(renderer, route.directionsResult);
        routeRenderers.push(renderer);
        if (!lastRoutes.some((item) => item && route && item.id === route.id)) {
            lastRoutes.push(route);
        }
        lastRouteMap = map;
        return renderer;
    }

    function renderRouteLegs(route, map, options = {}) {
        const directionsRoute = route?.directionsResult?.routes?.[0];
        if (!map || !Array.isArray(directionsRoute?.legs) || !directionsRoute.legs.length) return [];

        const polylines = [];
        directionsRoute.legs.forEach((leg, legIndex) => {
            const path = [];
            (leg.steps || []).forEach((step) => {
                let stepPath = step.path || [];
                if ((!Array.isArray(stepPath) || !stepPath.length) && step.polyline?.points) {
                    try {
                        stepPath = window.LorryRestrictions?.decodePolyline?.(step.polyline.points)
                            || google.maps.geometry?.encoding?.decodePath?.(step.polyline.points)
                            || [];
                    } catch {
                        stepPath = [];
                    }
                }
                (stepPath || []).forEach((point) => {
                    const previous = path[path.length - 1];
                    const samePoint = previous
                        && Number(previous.lat instanceof Function ? previous.lat() : previous.lat) === Number(point.lat instanceof Function ? point.lat() : point.lat)
                        && Number(previous.lng instanceof Function ? previous.lng() : previous.lng) === Number(point.lng instanceof Function ? point.lng() : point.lng);
                    if (!samePoint) path.push(point);
                });
            });
            if (path.length < 2 && leg.start_location && leg.end_location) {
                path.splice(0, path.length, leg.start_location, leg.end_location);
            }
            if (path.length < 2) return;

            const polyline = createPolyline({
                map,
                path,
                geodesic: false,
                strokeColor: options.colorForLeg?.(legIndex, route) || route.color || options.color || '#1E90FF',
                strokeOpacity: options.strokeOpacity ?? 0.9,
                strokeWeight: options.strokeWeight || 5,
                // A dispatcher must be able to pin directly on the displayed road
                // while adding a manual detour. Route overlays must not swallow it.
                clickable: options.clickable ?? false
            });
            if (polyline) polylines.push(polyline);
        });
        return polylines;
    }

    function renderAllRoutes(routes, map, options = {}) {
        if (options.clear !== false) clearRoutes();
        lastRoutes = Array.isArray(routes) ? routes.filter(Boolean) : [];
        lastRouteMap = map || lastRouteMap;
        return lastRoutes
            .map((route) => renderRoute(route, map, options))
            .filter(Boolean);
    }

    function fitRouteBounds(route, map) {
        const directionsRoute = route?.directionsResult?.routes?.[0];
        if (!directionsRoute || !Array.isArray(directionsRoute.legs) || !directionsRoute.legs.length || !map) return;
        const bounds = createLatLngBounds();
        if (!bounds) return;
        directionsRoute.legs.forEach((leg) => {
            if (leg.start_location) extendBounds(bounds, leg.start_location);
            if (leg.end_location) extendBounds(bounds, leg.end_location);
        });
        fitBounds(map, bounds);
    }

    function focusRoute(routeId, routes, map) {
        const activeRoutes = Array.isArray(routes) ? routes.filter(Boolean) : lastRoutes;
        const activeMap = map || lastRouteMap;
        const selectedId = Number(routeId);
        const route = activeRoutes.find((item) => item && Number(item.id) === selectedId);
        if (!route || !activeMap) return null;

        clearRoutes();
        activeRoutes.forEach((item, index) => {
            const isSelected = Number(item.id) === selectedId;
            renderRoute(item, activeMap, {
                suppressMarkers: true,
                strokeOpacity: isSelected ? 1 : 0.22,
                strokeWeight: isSelected ? 7 : 4,
                color: item.color || ['#1E90FF', '#FF4D4F', '#52C41A', '#FA8C16', '#722ED1', '#13C2C2'][index % 6]
            });
        });
        fitRouteBounds(route, activeMap);
        return route;
    }

    function travelModeDriving() {
        return isReady() ? google.maps.TravelMode.DRIVING : 'DRIVING';
    }

    return {
        initMap,
        renderRoute,
        renderRouteLegs,
        renderAllRoutes,
        clearRoutes,
        focusRoute,
        addMarkers,
        clearMarkers,
        isReady,
        hasAdvancedMarker,
        initDirectionsService,
        initDirectionsRenderer,
        initGeocoder,
        initAutocomplete,
        createLatLngBounds,
        createAdvancedMarker,
        createPin,
        createMarker,
        createPolyline,
        createInfoWindow,
        createSize,
        createPoint,
        triggerResize,
        addListener,
        removeListener,
        setDirections,
        clearDirections,
        clearRendererMap,
        setRendererMap,
        panTo,
        addObjectListener,
        openInfoWindow,
        extendBounds,
        getMarkerPosition,
        route,
        geocode,
        setCenter,
        setZoom,
        getZoom,
        fitBounds,
        fitMapToMarkers,
        limitMarkerCandidates,
        applyMarkerCluster,
        clearCluster,
        MAX_VISIBLE_MARKERS,
        travelModeDriving
    };
})();

window.MapHandler = MapHandler;
