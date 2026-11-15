const MapHandler = (() => {
    const routeRenderers = [];
    const routeMarkers = [];
    const MAX_VISIBLE_MARKERS = 100;

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

    function triggerResize(map) {
        if (isReady() && map) google.maps.event.trigger(map, 'resize');
    }

    function addListener(target, eventName, handler) {
        return isReady() ? google.maps.event.addListener(target, eventName, handler) : null;
    }

    function removeListener(listener) {
        if (isReady() && listener) google.maps.event.removeListener(listener);
    }

    // Results from the self-hosted road network (_source: 'osrm') are drawn as a polyline in the
    // renderer's style; a DirectionsRenderer only draws Google results.
    function clearOsrmLine(renderer) {
        if (renderer && renderer.__goroutexOsrmLine) {
            renderer.__goroutexOsrmLine.setMap(null);
            renderer.__goroutexOsrmLine = null;
        }
    }

    function setDirections(renderer, directions) {
        if (!renderer) return;
        clearOsrmLine(renderer);
        if (directions && directions._source === 'osrm') {
            renderer.setDirections({ routes: [] });
            const map = typeof renderer.getMap === 'function' ? renderer.getMap() : null;
            if (!map || !isReady()) return;
            const style = (typeof renderer.get === 'function' && renderer.get('polylineOptions')) || {};
            renderer.__goroutexOsrmLine = new google.maps.Polyline({
                map,
                path: directions.routes?.[0]?.overview_path || [],
                strokeColor: style.strokeColor || '#1E90FF',
                strokeOpacity: style.strokeOpacity ?? 0.9,
                strokeWeight: style.strokeWeight || 5
            });
            return;
        }
        renderer.setDirections(directions);
    }

    function clearRendererMap(renderer) {
        clearOsrmLine(renderer);
        if (renderer) renderer.setMap(null);
    }

    function panTo(mapInstance, position) {
        if (mapInstance && position && typeof mapInstance.panTo === 'function') mapInstance.panTo(position);
    }

    function addObjectListener(target, eventName, handler) {
        return target && typeof target.addListener === 'function'
            ? target.addListener(eventName, handler)
            : null;
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
        // Basic and manual mode: self-hosted road network instead of Google (falls back to Google on error).
        const osrm = typeof window !== 'undefined' ? window.GoRouteXOsrmRouting : null;
        const points = osrm ? osrm.pointsFor(request) : null;
        if (points) {
            const viaOsrm = osrm.route(request, points).catch((error) => {
                console.warn('Road network route failed, using Google:', error?.code || error);
                return service.route(request);
            });
            if (callback) {
                viaOsrm.then((result) => callback(result, 'OK'), (error) => callback(null, error?.code || 'ERROR'));
                return null;
            }
            return viaOsrm;
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

    return {
        initMap,
        renderRouteLegs,
        clearRoutes,
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
        triggerResize,
        addListener,
        removeListener,
        setDirections,
        clearRendererMap,
        panTo,
        addObjectListener,
        extendBounds,
        getMarkerPosition,
        route,
        geocode,
        setCenter,
        setZoom,
        getZoom,
        fitBounds,
        fitMapToMarkers,
        applyMarkerCluster,
        clearCluster,
        MAX_VISIBLE_MARKERS
    };
})();

window.MapHandler = MapHandler;
