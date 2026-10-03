// BJS Delivery App Sync Manager
// Cloud-ONLY sync with Firebase — single database, no localStorage for data

class SimpleBJSSync {
  constructor() {
    this.useFirebase = false;
    this.firebaseReady = false;

    // Auth-ready promise: resolves when Firebase auth state is first determined
    this._authReadyPromise = new Promise((resolve) => {
      this._authReadyResolve = resolve;
    });

    // Timeout: don't wait forever for auth (8 seconds max)
    this._authTimeout = setTimeout(() => {
      if (this._authReadyResolve) {
        console.warn('Firebase auth timed out — proceeding without cloud');
        this._authReadyResolve(false);
        this._authReadyResolve = null;
      }
    }, 8000);

    // Check if Firebase is available
    this.initFirebase();
  }

  // Wait for Firebase auth to determine login state
  waitForAuth() {
    return this._authReadyPromise;
  }

  // Resolve the auth-ready promise (called once)
  _resolveAuth(loggedIn) {
    if (this._authReadyResolve) {
      clearTimeout(this._authTimeout);
      this._authReadyResolve(loggedIn);
      this._authReadyResolve = null;
    }
  }

  // Initialize Firebase if available
  async initFirebase() {
    try {
      if (window.FirebaseApp) {
        let initialized = false;
        if (typeof window.FirebaseApp.isInitialized === 'function' && window.FirebaseApp.isInitialized()) {
          initialized = true;
        } else if (typeof window.FirebaseApp.init === 'function') {
          initialized = window.FirebaseApp.init();
        }

        if (initialized) {
          this.firebaseReady = true;
          console.log('Firebase sync manager initialized (cloud-only mode)');

          // Listen for auth state changes
          window.FirebaseApp.auth.onAuthStateChange(async (user) => {
            this.useFirebase = !!user;

            // Resolve the auth-ready promise on first callback
            this._resolveAuth(!!user);

            if (user) {
              console.log('Cloud sync enabled for user:', user.email);
            } else {
              console.log('User logged out');
            }

            // Update UI if available
            if (typeof window.updateUserInfoDisplay === 'function') {
              window.updateUserInfoDisplay();
            }

          });

          return; // Wait for auth callback — don't resolve yet
        }
      }

      // Firebase not available — resolve immediately
      this._resolveAuth(false);
    } catch (error) {
      console.warn('Firebase not available:', error);
      this._resolveAuth(false);
    }
  }

  // Load routes from cloud ONLY
  async loadRoutes() {
    // Wait for auth state to be determined before checking
    await this.waitForAuth();

    if (!this.useFirebase || !window.FirebaseApp) {
      console.warn('Cloud not available — no routes to load');
      return [];
    }

    try {
      const result = await window.FirebaseApp.data.loadRoutes();
      if (result.success) {
        console.log('Loaded', result.routes.length, 'routes from cloud');
        return result.routes;
      }
      return [];
    } catch (error) {
      console.error('Failed to load routes from cloud:', error);
      return [];
    }
  }

  // Save route to cloud ONLY
  async saveRoute(routeData) {
    await this.waitForAuth();

    if (!this.useFirebase || !window.FirebaseApp) {
      console.warn('Cloud not available — cannot save route');
      return false;
    }

    try {
      const result = await window.FirebaseApp.data.saveRoute(routeData);
      if (result.success) {
        console.log('Route saved to cloud:', result.id);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Cloud save failed:', error);
      return false;
    }
  }

  // Delete route from cloud ONLY
  async deleteRoute(routeId) {
    await this.waitForAuth();

    if (!this.useFirebase || !window.FirebaseApp) {
      console.warn('Cloud not available — cannot delete route');
      return false;
    }

    try {
      await window.FirebaseApp.data.deleteRoute(routeId);
      console.log('Route deleted from cloud:', routeId);
      return true;
    } catch (error) {
      console.error('Cloud delete failed:', error);
      return false;
    }
  }

  // Save current session (selected stops, etc.) to cloud ONLY
  async saveSession(sessionData) {
    await this.waitForAuth();

    if (!this.useFirebase || !window.FirebaseApp) {
      console.warn('Cloud not available — cannot save session');
      return false;
    }

    try {
      await window.FirebaseApp.data.saveSession(sessionData);
      console.log('Session saved to cloud');
      return true;
    } catch (error) {
      console.error('Cloud session save failed:', error);
      return false;
    }
  }

  // Load current session from cloud ONLY
  async loadSession() {
    await this.waitForAuth();

    if (!this.useFirebase || !window.FirebaseApp) {
      return null;
    }

    try {
      const result = await window.FirebaseApp.data.loadSession();
      if (result.success && result.session) {
        console.log('Session loaded from cloud');
        return result.session;
      }
      return null;
    } catch (error) {
      console.error('Cloud session load failed:', error);
      return null;
    }
  }

  // Sync — just loads from cloud (single source of truth)

  // Stops live sync is intentionally disabled in this manager.
  // Use window.FirebaseApp.stops for all stops operations.
  async loadStops() {
    return [];
  }

  async saveStops() {
    return false;
  }
  async sync() {
    return this.loadRoutes();
  }

  // Check if cloud sync is available
  isCloudSyncAvailable() {
    return this.useFirebase && this.firebaseReady;
  }

  // Get sync status
  getSyncStatus() {
    if (this.useFirebase) {
      return { status: 'cloud', message: 'Cloud sync active' };
    } else if (this.firebaseReady) {
      return { status: 'waiting', message: 'Login for cloud sync' };
    } else {
      return { status: 'offline', message: 'Cloud not available' };
    }
  }
}

// Export for global use
window.SyncManager = SimpleBJSSync;
