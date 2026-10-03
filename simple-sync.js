// Simple cross-device sync fallback
// Legacy fallback utilities (Apps Script sync disabled)

class SimpleSyncManager {
  constructor() {
    this.username = localStorage.getItem('bjsDeliveryUsername') || 'anonymous';
    this.syncKey = `bjsRoutes_${this.username}`;
  }

  // Legacy API kept for compatibility. Firestore is the active database.
  async testGoogleSheetsSync() {
    console.warn('Apps Script sync is disabled. Firestore is the active database.');
    return false;
  }

  // Export routes to downloadable file
  exportRoutes(routes) {
    try {
      const exportData = {
        username: this.username,
        exportDate: new Date().toISOString(),
        routes: routes,
        version: '1.0'
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });

      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `goroutex-routes-${this.username}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      return true;
    } catch (error) {
      console.error('Export failed:', error);
      return false;
    }
  }

  // Import routes from file
  importRoutes() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = (event) => {
        const file = event.target.files[0];
        if (!file) return resolve([]);

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            if (data.routes && Array.isArray(data.routes)) {
              resolve(data.routes);
            } else {
              reject(new Error('Invalid file format'));
            }
          } catch (error) {
            reject(error);
          }
        };
        reader.readAsText(file);
      };

      input.click();
    });
  }

  // Generate QR code for route sharing
  generateShareCode(routes) {
    try {
      const shareData = {
        routes: routes,
        shared: new Date().toISOString(),
        username: this.username
      };

      const encoded = btoa(JSON.stringify(shareData));
      return encoded;
    } catch (error) {
      console.error('Share code generation failed:', error);
      return null;
    }
  }

  // Decode shared routes
  decodeShareCode(shareCode) {
    try {
      const decoded = atob(shareCode);
      const data = JSON.parse(decoded);
      return data.routes || [];
    } catch (error) {
      console.error('Share code decoding failed:', error);
      return [];
    }
  }

  // Simple manual sync via share codes
  async manualSync() {
    const choice = confirm(
      'Manual sync options:\n' +
      'OK = Export routes to file\n' +
      'Cancel = Import routes from file'
    );

    if (choice) {
      const routes = JSON.parse(localStorage.getItem('deliveryPlannerRouteHistory') || '[]');
      return this.exportRoutes(routes);
    } else {
      try {
        const importedRoutes = await this.importRoutes();
        if (importedRoutes.length > 0) {
          const existingRoutes = JSON.parse(localStorage.getItem('deliveryPlannerRouteHistory') || '[]');
          const mergedRoutes = this.mergeRoutes(existingRoutes, importedRoutes);
          localStorage.setItem('deliveryPlannerRouteHistory', JSON.stringify(mergedRoutes));
          return mergedRoutes;
        }
        return [];
      } catch (error) {
        alert('Import failed: ' + error.message);
        return [];
      }
    }
  }

  // Merge routes from different sources
  mergeRoutes(localRoutes, importedRoutes) {
    const routeMap = new Map();

    localRoutes.forEach(route => {
      const key = route.id || route.timestamp;
      if (key) routeMap.set(key, route);
    });

    importedRoutes.forEach(route => {
      const key = route.id || route.timestamp;
      if (key) {
        const existing = routeMap.get(key);
        if (!existing || new Date(route.timestamp) > new Date(existing.timestamp)) {
          routeMap.set(key, route);
        }
      }
    });

    return Array.from(routeMap.values()).sort((a, b) =>
      new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
    );
  }
}

// Export for global use
window.SimpleSyncManager = SimpleSyncManager;
