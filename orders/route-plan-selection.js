(function (global) {
  const KEY = 'goroutex-order-plan-selection';
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function deliveryTime(order) {
    const raw = String(order.deliveryTime || order.timeWindowStart || '').trim();
    if (!raw) return '09:00';
    const match = raw.match(/^(\d{1,2}):([0-5]\d)(?:\s*(AM|PM))?$/i);
    if (!match) throw Error('A selected order has an invalid delivery time. Review its time before planning.');
    let hour = Number(match[1]);
    if (match[3]) {
      if (hour < 1 || hour > 12) throw Error('A selected order has an invalid delivery time.');
      hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
    } else if (hour > 23) throw Error('A selected order has an invalid delivery time.');
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
  }

  function selectedSchedule(orders) {
    const values = [...new Set(orders.map(order => `${order.deliveryDate || todayKey()}T${deliveryTime(order)}`))];
    if (values.length !== 1) throw Error('Selected orders have different delivery dates or times. Plan orders with the same schedule together.');
    return values[0];
  }

  // Per-stop limits from the orders' own time windows and service minutes. Several orders at one stop:
  // the window is their overlap (latest start, earliest end) and the service time the longest one.
  const hhmm = value => {
    const match = String(value || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
  };
  // An order with a confirmed one-time delivery address is planned as its own stop at that address;
  // the customer's saved stop is not changed. Keep in step with driver/route-enrichment.js.
  const ONE_TIME_PREFIX = 'order-address-';
  function oneTimeAddress(order) {
    const value = order?.deliveryOverride;
    const lat = Number(value?.lat), lng = Number(value?.lng);
    if (!value || !String(value.address || '').trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
    return { address: String(value.address).trim(), lat, lng };
  }
  function planningStopId(order) {
    const internalId = String(order?.internalId || '').trim();
    return oneTimeAddress(order) && internalId ? ONE_TIME_PREFIX + internalId : String(order?.savedStopId || '').trim();
  }

  function stopConstraints(orders) {
    const result = {};
    for (const order of orders) {
      const id = planningStopId(order);
      if (!id) continue;
      const entry = result[id] || {};
      const start = hhmm(order.timeWindowStart), end = hhmm(order.timeWindowEnd);
      if (start && end && start < end) {
        entry.windowStart = entry.windowStart && entry.windowStart > start ? entry.windowStart : start;
        entry.windowEnd = entry.windowEnd && entry.windowEnd < end ? entry.windowEnd : end;
      }
      // Load per stop for capacity planning: orders at the same stop add up.
      for (const field of ['weight', 'quantity']) {
        const value = Number(order[field]);
        if (Number.isFinite(value) && value > 0) entry[field] = Math.round(((entry[field] || 0) + value) * 1000) / 1000;
      }
      const minutes = Number(order.serviceTimeMinutes);
      if (Number.isInteger(minutes) && minutes > 0 && minutes <= 240) entry.serviceMinutes = Math.max(entry.serviceMinutes || 0, minutes);
      if (Object.keys(entry).length) result[id] = entry;
    }
    return result;
  }

  function prepare(orders, stops, maxStops) {
    if (!Array.isArray(orders) || !orders.length) throw Error('Select at least one order.');
    const unavailable = orders.filter(order => order.status !== 'READY' || order.executionStatus);
    if (unavailable.length) throw Error(unavailable.length + ' selected order(s) need review or have already been processed. Select ready, unprocessed orders.');
    const stopById = new Map((stops || []).filter(stop => stop?.id).map(stop => [String(stop.id), stop]));
    const orderIds = [...new Set(orders.map(order => String(order.internalId || '').trim()))];
    if (orderIds.some(id => !id)) throw Error('A selected order is missing its saved ID. Refresh Order Hub and try again.');
    if (orders.some(order => !stopById.has(String(order.savedStopId || '').trim()))) throw Error('A selected order needs a saved delivery stop. Review the order before planning.');
    const stopIds = [...new Set(orders.map(planningStopId))];
    if (Number.isFinite(maxStops) && stopIds.length > maxStops) throw Error('This plan supports ' + maxStops + ' selected stops. Choose fewer orders or change plan.');
    const oneTimeStops = orders.filter(oneTimeAddress).map(order => ({ id: planningStopId(order), savedStopId: String(order.savedStopId).trim(), orderId: String(order.internalId).trim(), ...oneTimeAddress(order) }));
    const oneTimeById = new Map(oneTimeStops.map(stop => [stop.id, stop]));
    return { orderIds, stopIds, oneTimeStops, planningDateTime: selectedSchedule(orders), selectedAddresses: stopIds.map(id => (oneTimeById.get(id) || stopById.get(id)).address), stopConstraints: stopConstraints(orders) };
  }

  function save(uid, selection) {
    if (!uid || !selection?.orderIds?.length || !selection?.stopIds?.length) throw Error('Order planning selection is incomplete.');
    global.sessionStorage.setItem(KEY, JSON.stringify({ uid, orderIds: selection.orderIds, stopIds: selection.stopIds, oneTimeStops: selection.oneTimeStops || [], planningDateTime: selection.planningDateTime, stopConstraints: selection.stopConstraints || {}, createdAt: Date.now() }));
  }

  function read(uid) {
    try {
      const value = JSON.parse(global.sessionStorage.getItem(KEY) || 'null');
      if (value?.uid !== uid || Date.now() - value.createdAt > MAX_AGE_MS
          || !Array.isArray(value.orderIds) || !value.orderIds.length
          || !Array.isArray(value.stopIds) || !value.stopIds.length) return null;
      return value;
    } catch {
      return null;
    }
  }

  function clear(uid) {
    if (!uid || read(uid)) global.sessionStorage.removeItem(KEY);
  }

  global.GoRouteXOrderPlan = { prepare, save, read, clear, planningStopId };
})(window);
