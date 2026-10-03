(function (global) {
  const DB_VERSION = 1;
  const STORE_STOPS = 'stops';
  const STORE_HISTORY = 'history';
  const STORE_RECORDS = 'records';
  const RECORD_SELECTION = 'selection.current';
  const RECORD_ACTIVE_ROUTES = 'routes.active';
  const RECORD_MIGRATION = 'meta.cloudSeeded';
  const warmMigrationPromises = new Map();

  function getProductToolkit() {
    return global.RoutePlannerProduct || null;
  }

  function getCurrentProfile() {
    return global.currentUserProfile || {};
  }

  function getCurrentAuthUser() {
    return global.FirebaseApp?.auth?.getCurrentUser
      ? global.FirebaseApp.auth.getCurrentUser()
      : null;
  }

  function getOwnerKey() {
    const authUser = getCurrentAuthUser();
    const rawKey = authUser?.uid
      || global.localStorage?.getItem('bjsUserId')
      || 'device-user';
    return String(rawKey).trim() || 'device-user';
  }

  function sanitizeDbSuffix(value) {
    return String(value || 'device-user').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'device-user';
  }

  function getDbName(ownerKey) {
    return `goroutex-route-planner-${sanitizeDbSuffix(ownerKey)}`;
  }

  function openIndexedDb(ownerKey) {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB is not available on this device'));
        return;
      }

      const request = global.indexedDB.open(getDbName(ownerKey), DB_VERSION);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_STOPS)) {
          db.createObjectStore(STORE_STOPS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          db.createObjectStore(STORE_RECORDS, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  function withStore(ownerKey, storeName, mode, executor) {
    return openIndexedDb(ownerKey).then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let settled = false;

      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(undefined);
        }
        db.close();
      };
      transaction.onerror = () => {
        if (!settled) {
          settled = true;
          reject(transaction.error || new Error(`IndexedDB transaction failed for ${storeName}`));
        }
        db.close();
      };
      transaction.onabort = () => {
        if (!settled) {
          settled = true;
          reject(transaction.error || new Error(`IndexedDB transaction aborted for ${storeName}`));
        }
        db.close();
      };

      try {
        executor(store, transaction, (value) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        }, (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
        db.close();
      }
    }));
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function extractTimestampMs(value) {
    if (!value) return 0;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value.toDate === 'function') {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
    }
    if (typeof value.seconds === 'number') {
      return value.seconds * 1000;
    }
    return 0;
  }

  function sortHistoryEntries(entries) {
    return [...(entries || [])].sort((left, right) => {
      const leftMs = extractTimestampMs(left?.timestamp) || extractTimestampMs(left?.updatedAt) || extractTimestampMs(left?.createdAt);
      const rightMs = extractTimestampMs(right?.timestamp) || extractTimestampMs(right?.updatedAt) || extractTimestampMs(right?.createdAt);
      return rightMs - leftMs;
    });
  }

  function buildLocalStopId(stop) {
    const existingId = String(stop?.id || '').trim();
    if (existingId) return existingId;

    const name = String(stop?.name || stop?.Name || '').trim().toLowerCase();
    const address = String(stop?.address || stop?.Address || '').trim().toLowerCase();
    const phone = String(stop?.phone || stop?.['Hp No'] || '').trim().toLowerCase();
    const base = `${name}|${phone}|${address}`.replace(/[^a-z0-9|]+/g, '-').replace(/-+/g, '-');
    return `stop_${base || 'local'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function ensureLocalStopShape(stop) {
    if (!stop) return null;
    return {
      ...stop,
      id: buildLocalStopId(stop)
    };
  }

  function getStopDedupKey(stop) {
    return [
      String(stop?.name || stop?.Name || '').trim().toLowerCase(),
      String(stop?.phone || stop?.['Hp No'] || '').trim().toLowerCase(),
      String(stop?.address || stop?.Address || '').trim().toLowerCase()
    ].join('|');
  }

  function createIndexedDbAdapter(ownerKey) {
    return {
      mode: 'indexeddb',

      async loadStops(options = {}) {
        const limitCount = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
          ? Math.floor(Number(options.limit))
          : null;
        const stops = await withStore(ownerKey, STORE_STOPS, 'readonly', (store, _tx, done, fail) => {
          requestToPromise(limitCount ? store.getAll(null, limitCount) : store.getAll()).then(done).catch(fail);
        });
        return {
          success: true,
          stops: stops || [],
          source: 'indexeddb',
          limit: limitCount,
          hasMore: Boolean(limitCount && (stops || []).length >= limitCount)
        };
      },

      async saveStops(stopsArray) {
        const stops = (Array.isArray(stopsArray) ? stopsArray : [])
          .map((stop) => ensureLocalStopShape(stop))
          .filter(Boolean);
        await withStore(ownerKey, STORE_STOPS, 'readwrite', (store) => {
          store.clear();
          stops.forEach((stop) => {
            if (stop && stop.id) {
              store.put(stop);
            }
          });
        });
        return { success: true, stops, totalStops: stops.length, source: 'indexeddb' };
      },

      async addStop(stopObject) {
        const stop = ensureLocalStopShape(stopObject);
        const existingStops = await this.loadStops();
        const duplicate = (existingStops?.stops || []).find((entry) => getStopDedupKey(entry) === getStopDedupKey(stop));
        if (duplicate) {
          return { success: true, id: duplicate.id, duplicate: true, source: 'indexeddb' };
        }
        await withStore(ownerKey, STORE_STOPS, 'readwrite', (store) => {
          store.put(stop);
        });
        return { success: true, id: stop?.id || null, source: 'indexeddb' };
      },

      async updateStop(stopId, stopObject) {
        await withStore(ownerKey, STORE_STOPS, 'readwrite', (store) => {
          store.put(ensureLocalStopShape({ ...(stopObject || {}), id: stopId }));
        });
        return { success: true, id: stopId, source: 'indexeddb' };
      },

      async deleteStop(stopId) {
        await withStore(ownerKey, STORE_STOPS, 'readwrite', (store) => {
          store.delete(stopId);
        });
        return { success: true, id: stopId, source: 'indexeddb' };
      },

      async loadPlan(planId) {
        const plan = await withStore(ownerKey, STORE_HISTORY, 'readonly', (store, _tx, done, fail) => {
          requestToPromise(store.get(String(planId))).then(done).catch(fail);
        });
        return { success: true, plan: plan || null, source: 'indexeddb' };
      },
      async loadLatestFinalizedPlan() {
        const plan = await withStore(ownerKey, STORE_HISTORY, 'readonly', (store, _tx, done, fail) => {
          const request = store.openCursor(null, 'prev');
          request.onerror = () => fail(request.error || new Error('Route plan cursor failed'));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return done(null);
            const candidate = cursor.value;
            if ((candidate.plannedRoutes || []).some(route => Array.isArray(route?.customerStops))) return done(candidate);
            cursor.continue();
          };
        });
        return { success: true, plan: plan || null, source: 'indexeddb' };
      },
      async loadHistory(options = {}) {
        const limitCount = Math.max(1, Math.min(Number(options.limit || options.pageSize) || 20, 50));
        const offsetCount = Math.max(0, Number(options.offset) || 0);
        const routes = await withStore(ownerKey, STORE_HISTORY, 'readonly', (store, _tx, done, fail) => {
          const items = [];
          let skipped = 0;
          let hasMore = false;
          const request = store.openCursor(null, 'prev');
          request.onerror = () => fail(request.error || new Error('IndexedDB history cursor failed'));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              done({ items, hasMore });
              return;
            }
            if (skipped < offsetCount) {
              skipped++;
              cursor.continue();
              return;
            }
            if (items.length < limitCount) {
              items.push(cursor.value);
              cursor.continue();
              return;
            }
            hasMore = true;
            done({ items, hasMore });
          };
        });
        return {
          success: true,
          routes: routes?.items || [],
          source: 'indexeddb',
          hasMore: !!routes?.hasMore,
          pageSize: limitCount
        };
      },

      async saveHistory(routeData) {
        const route = {
          ...(routeData || {}),
          id: String(routeData?.id || Date.now()),
          updatedAt: routeData?.updatedAt || new Date().toISOString()
        };
        await withStore(ownerKey, STORE_HISTORY, 'readwrite', (store) => {
          store.put(route);
        });
        return { success: true, id: route.id, source: 'indexeddb' };
      },

      async deleteRoute(routeId) {
        await withStore(ownerKey, STORE_HISTORY, 'readwrite', (store) => {
          store.delete(String(routeId));
        });
        return { success: true, id: String(routeId), source: 'indexeddb' };
      },

      async loadSelection() {
        const record = await withStore(ownerKey, STORE_RECORDS, 'readonly', (store, _tx, done, fail) => {
          requestToPromise(store.get(RECORD_SELECTION)).then(done).catch(fail);
        });
        return { success: true, session: record?.value || null, source: 'indexeddb' };
      },

      async saveSelection(sessionData) {
        await withStore(ownerKey, STORE_RECORDS, 'readwrite', (store) => {
          store.put({
            key: RECORD_SELECTION,
            value: {
              ...(sessionData || {}),
              updatedAt: sessionData?.updatedAt || new Date().toISOString()
            }
          });
        });
        return { success: true, source: 'indexeddb' };
      },

      async loadActiveRoutes() {
        const record = await withStore(ownerKey, STORE_RECORDS, 'readonly', (store, _tx, done, fail) => {
          requestToPromise(store.get(RECORD_ACTIVE_ROUTES)).then(done).catch(fail);
        });
        return { success: true, data: record?.value || null, source: 'indexeddb' };
      },

      async saveActiveRoutes(data) {
        await withStore(ownerKey, STORE_RECORDS, 'readwrite', (store) => {
          store.put({
            key: RECORD_ACTIVE_ROUTES,
            value: {
              ...(data || {}),
              updatedAt: data?.updatedAt || new Date().toISOString()
            }
          });
        });
        return { success: true, source: 'indexeddb' };
      },

      async getMeta(key) {
        const record = await withStore(ownerKey, STORE_RECORDS, 'readonly', (store, _tx, done, fail) => {
          requestToPromise(store.get(key)).then(done).catch(fail);
        });
        return record?.value;
      },

      async setMeta(key, value) {
        await withStore(ownerKey, STORE_RECORDS, 'readwrite', (store) => {
          store.put({ key, value });
        });
      },

      async clearData() {
        await Promise.all([
          withStore(ownerKey, STORE_STOPS, 'readwrite', (store) => { store.clear(); }),
          withStore(ownerKey, STORE_HISTORY, 'readwrite', (store) => { store.clear(); }),
          withStore(ownerKey, STORE_RECORDS, 'readwrite', (store) => { store.clear(); })
        ]);
        return { success: true, source: 'indexeddb' };
      }
    };
  }

  function cloudApiAvailable(path) {
    return Boolean(path);
  }

  function createCloudAdapter() {
    return {
      mode: 'cloud',

      async loadStops(options = {}) {
        const api = global.FirebaseApp?.stops?.loadStopsCache;
        if (!cloudApiAvailable(api)) {
          return { success: false, stops: [], error: 'Cloud stops API unavailable' };
        }
        return api({
          forceReload: !!options.forceReload,
          serverFirst: options.serverFirst !== false,
          allowCacheFallback: options.allowCacheFallback !== false,
          limit: Number.isFinite(Number(options.limit)) ? Number(options.limit) : undefined
        });
      },

      async saveStops(stopsArray) {
        const saveApi = global.FirebaseApp?.stops?.saveStopsCache;
        if (!cloudApiAvailable(saveApi)) {
          return { success: false, error: 'Cloud stops API unavailable' };
        }
        const result = await saveApi(stopsArray, { immediate: true });
        if (result?.success && global.FirebaseApp?.stops?.flushStopsCacheWrites) {
          await global.FirebaseApp.stops.flushStopsCacheWrites();
        }
        return result;
      },

      async addStop(stopObject) {
        const api = global.FirebaseApp?.stops?.addStop;
        if (!cloudApiAvailable(api)) {
          return { success: false, error: 'Cloud add-stop API unavailable' };
        }
        const result = await api(stopObject, { immediate: true });
        if (result?.success && global.FirebaseApp?.stops?.flushStopsCacheWrites) {
          await global.FirebaseApp.stops.flushStopsCacheWrites();
        }
        return result;
      },

      async updateStop(stopId, stopObject) {
        const api = global.FirebaseApp?.stops?.updateStop;
        if (!cloudApiAvailable(api)) {
          return { success: false, error: 'Cloud update-stop API unavailable' };
        }
        const result = await api(stopId, stopObject, { immediate: true });
        if (result?.success && global.FirebaseApp?.stops?.flushStopsCacheWrites) {
          await global.FirebaseApp.stops.flushStopsCacheWrites();
        }
        return result;
      },

      async deleteStop(stopId) {
        const api = global.FirebaseApp?.stops?.deleteStop;
        if (!cloudApiAvailable(api)) {
          return { success: false, error: 'Cloud delete-stop API unavailable' };
        }
        const result = await api(stopId, { immediate: true });
        if (result?.success && global.FirebaseApp?.stops?.flushStopsCacheWrites) {
          await global.FirebaseApp.stops.flushStopsCacheWrites();
        }
        return result;
      },

      async loadPlan(planId) {
        return global.FirebaseApp?.data?.loadPlan?.(planId) || { success: false, error: 'Cloud plan API unavailable' };
      },
      async loadLatestFinalizedPlan() {
        return global.FirebaseApp?.data?.loadLatestFinalizedPlan?.() || { success: false, error: 'Cloud plan API unavailable' };
      },
      async loadHistory(options = {}) {
        const api = global.FirebaseApp?.data?.loadRoutes;
        if (!cloudApiAvailable(api)) {
          return { success: false, routes: [], error: 'Cloud history API unavailable' };
        }
        return api(options);
      },

      async saveHistory(routeData) {
        const api = global.FirebaseApp?.data?.saveRoute;
        if (!cloudApiAvailable(api)) {
          return { success: false, error: 'Cloud history API unavailable' };
        }
        return api(routeData);
      },

      async deleteRoute(routeId) {
        const api = global.FirebaseApp?.data?.deleteRoute;
        if (!cloudApiAvailable(api)) {
          return { success: false, error: 'Cloud delete-route API unavailable' };
        }
        return api(routeId);
      },

      async loadSelection() {
        const api = global.FirebaseApp?.data?.loadSession;
        if (!cloudApiAvailable(api)) {
          return { success: false, session: null, error: 'Cloud session API unavailable' };
        }
        return api();
      },

      async saveSelection(sessionData) {
        const api = global.FirebaseApp?.data?.saveSession;
        if (!cloudApiAvailable(api)) {
          return { success: false, error: 'Cloud session API unavailable' };
        }
        return api(sessionData);
      },

      async loadActiveRoutes() {
        const api = global.FirebaseApp?.routes?.loadActive;
        if (!cloudApiAvailable(api)) {
          return { success: false, data: null, error: 'Cloud active-route API unavailable' };
        }
        const result = await api();
        return {
          success: !!result?.success,
          data: result?.success ? (result.data || null) : null,
          error: result?.error || null
        };
      },

      async saveActiveRoutes(data) {
        const api = global.FirebaseApp?.routes?.saveActive;
        if (!cloudApiAvailable(api)) {
          return { success: false, error: 'Cloud active-route API unavailable' };
        }
        return api(data);
      },

      async clearData() {
        const api = global.FirebaseApp?.clearAllData;
        if (!cloudApiAvailable(api)) {
          return { success: false, error: 'Cloud clear-data API unavailable' };
        }
        return api();
      }
    };
  }

  async function maybeHydrateIndexedDbFromCloud(indexedDbAdapter) {
    const seeded = await indexedDbAdapter.getMeta(RECORD_MIGRATION);
    if (seeded && seeded.source !== 'cloud-failed') {
      return { success: true, migrated: false };
    }

    const cloudAdapter = createCloudAdapter();
    const [localStops, localHistory, localSelection] = await Promise.all([
      indexedDbAdapter.loadStops(),
      indexedDbAdapter.loadHistory(),
      indexedDbAdapter.loadSelection()
    ]);

    const hasLocalCoreData = (localStops?.stops || []).length > 0
      || (localHistory?.routes || []).length > 0
      || Boolean(localSelection?.session);

    if (hasLocalCoreData) {
      await indexedDbAdapter.setMeta(RECORD_MIGRATION, {
        seededAt: new Date().toISOString(),
        source: 'local-existing'
      });
      return { success: true, migrated: false };
    }

    try {
      const [cloudStops, cloudHistory, cloudSelection, cloudActiveRoutes] = await Promise.all([
        cloudAdapter.loadStops({ forceReload: false, serverFirst: true, allowCacheFallback: true }),
        cloudAdapter.loadHistory(),
        cloudAdapter.loadSelection(),
        cloudAdapter.loadActiveRoutes()
      ]);

      if (cloudStops?.success && Array.isArray(cloudStops.stops) && cloudStops.stops.length > 0) {
        await indexedDbAdapter.saveStops(cloudStops.stops);
      }
      if (cloudHistory?.success && Array.isArray(cloudHistory.routes) && cloudHistory.routes.length > 0) {
        for (const route of cloudHistory.routes) {
          await indexedDbAdapter.saveHistory(route);
        }
      }
      if (cloudSelection?.success && cloudSelection.session) {
        await indexedDbAdapter.saveSelection(cloudSelection.session);
      }
      if (cloudActiveRoutes?.success && cloudActiveRoutes.data) {
        await indexedDbAdapter.saveActiveRoutes(cloudActiveRoutes.data);
      }

      await indexedDbAdapter.setMeta(RECORD_MIGRATION, {
        seededAt: new Date().toISOString(),
        source: 'cloud'
      });
      return { success: true, migrated: true };
    } catch (error) {
      return { success: false, migrated: false, error: error.message };
    }
  }

  function warmIndexedDbFromCloud(indexedDbAdapter, ownerKey) {
    const key = sanitizeDbSuffix(ownerKey || getOwnerKey());
    if (!warmMigrationPromises.has(key)) {
      const warmPromise = maybeHydrateIndexedDbFromCloud(indexedDbAdapter)
        .catch((error) => ({ success: false, migrated: false, error: error.message }))
        .finally(() => {
          // Keep the completed promise for this page session so repeated page visits
          // do not fan out cloud hydration reads.
        });
      warmMigrationPromises.set(key, warmPromise);
    }
    return warmMigrationPromises.get(key);
  }

  async function getResolvedStorage(profile = getCurrentProfile(), options = {}) {
    const product = getProductToolkit();
    const authenticated = getCurrentAuthUser();
    const sharedAccount = global.GoRouteXAccountContext;
    if (!authenticated?.uid || !sharedAccount) throw new Error('Account plan unavailable. Sign in and retry.');
    const context = sharedAccount.get();
    if (!context || context.uid !== authenticated.uid || !['basic', 'goplan', 'proplan'].includes(context.planId)) {
      throw new Error('Account plan unavailable. Retry loading your account.');
    }
    profile = context.profile;
    const planKey = context.planId;
    const storageMode = product?.getStorageModeForPlan?.(planKey);
    if (!['cloud', 'indexeddb'].includes(storageMode)) throw new Error('Account storage unavailable. Retry loading your account.');

    if (storageMode === 'indexeddb') {
      const ownerKey = getOwnerKey();
      const adapter = createIndexedDbAdapter(ownerKey);
      if (options.allowMigration !== false) {
        const warmPromise = warmIndexedDbFromCloud(adapter, ownerKey);
        if (options.awaitMigration === true) {
          await warmPromise;
        }
      }
      return { planKey, storageMode, adapter };
    }

    return { planKey, storageMode, adapter: createCloudAdapter() };
  }

  async function performStorageCall(methodName, args = [], options = {}) {
    const { planKey, storageMode, adapter } = await getResolvedStorage(options.profile, options);
    const method = adapter?.[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Storage adapter does not support ${methodName}`);
    }
    const result = await method.apply(adapter, args);
    return {
      ...(result || {}),
      planKey,
      storageMode
    };
  }

  global.RoutePlannerStorage = {
    getOwnerKey,
    getResolvedStorage,
    loadStops: (options) => performStorageCall('loadStops', [options || {}], options || {}),
    saveStops: (stopsArray, options) => performStorageCall('saveStops', [stopsArray || []], options || {}),
    addStop: (stopObject, options) => performStorageCall('addStop', [stopObject || {}], options || {}),
    updateStop: (stopId, stopObject, options) => performStorageCall('updateStop', [stopId, stopObject || {}], options || {}),
    deleteStop: (stopId, options) => performStorageCall('deleteStop', [stopId], options || {}),
    loadHistory: (options) => performStorageCall('loadHistory', [options || {}], options || {}),
    loadPlan: (planId, options) => performStorageCall('loadPlan', [planId], options || {}),
    loadLatestFinalizedPlan: (options) => performStorageCall('loadLatestFinalizedPlan', [], options || {}),
    saveHistory: (routeData, options) => performStorageCall('saveHistory', [routeData || {}], options || {}),
    deleteRoute: (routeId, options) => performStorageCall('deleteRoute', [routeId], options || {}),
    loadRoutes: (options) => performStorageCall('loadHistory', [options || {}], options || {}),
    saveRoute: (routeData, options) => performStorageCall('saveHistory', [routeData || {}], options || {}),
    loadSelection: (options) => performStorageCall('loadSelection', [], options || {}),
    saveSelection: (sessionData, options) => performStorageCall('saveSelection', [sessionData || {}], options || {}),
    loadActiveRoutes: (options) => performStorageCall('loadActiveRoutes', [], options || {}),
    saveActiveRoutes: (data, options) => performStorageCall('saveActiveRoutes', [data || {}], options || {}),
    clearData: (options) => performStorageCall('clearData', [], options || {}),
    warmUserData: (options) => {
      const ownerKey = getOwnerKey();
      return warmIndexedDbFromCloud(createIndexedDbAdapter(ownerKey), ownerKey);
    },
    sortHistoryEntries
  };
})(window);
