let currentPlannedRoutes = [];
const AppState = {
    get plannedRoutes() { return currentPlannedRoutes; },
    set plannedRoutes(routes) {
        currentPlannedRoutes = routes;
        window.dispatchEvent(new Event('planned-routes-changed'));
    },
    selectedCustomers: [],
    activeRouteId: 1
};

window.AppState = AppState;
