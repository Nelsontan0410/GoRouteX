const DirectionsServiceWrapper = (() => {
    const cache = new Map();

    function buildKey({ origin, destination, waypoints }) {
        const wp = (waypoints || [])
            .map(w => {
                const loc = w.location || w;
                if (typeof loc === 'string') return loc;
                if (loc.lat && loc.lng) return `${loc.lat},${loc.lng}`;
                return JSON.stringify(loc);
            })
            .join('|');

        const o = typeof origin === 'string' ? origin : `${origin.lat},${origin.lng}`;
        const d = typeof destination === 'string' ? destination : `${destination.lat},${destination.lng}`;

        return `${o}__${d}__${wp}`;
    }

    async function getDirections({ origin, destination, waypoints }) {
        const key = buildKey({ origin, destination, waypoints });

        if (cache.has(key)) {
            return cache.get(key);
        }

        const result = await new Promise((resolve, reject) => {
            const svc = MapHandler.initDirectionsService();
            MapHandler.route(svc, {
                origin,
                destination,
                waypoints,
                optimizeWaypoints: false,
                travelMode: 'DRIVING'
            }, (res, status) => {
                if (status === 'OK') resolve(res);
                else reject(status);
            });
        });

        cache.set(key, result);
        return result;
    }

    function clearCache() {
        cache.clear();
    }

    return {
        getDirections,
        clearCache
    };
})();

window.DirectionsServiceWrapper = DirectionsServiceWrapper;
