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

  function prepare(orders, stops, maxStops) {
    if (!Array.isArray(orders) || !orders.length) throw Error('Select at least one order.');
    const unavailable = orders.filter(order => order.status !== 'READY' || order.executionStatus);
    if (unavailable.length) throw Error(unavailable.length + ' selected order(s) need review or have already been processed. Select ready, unprocessed orders.');
    const stopById = new Map((stops || []).filter(stop => stop?.id).map(stop => [String(stop.id), stop]));
    const orderIds = [...new Set(orders.map(order => String(order.internalId || '').trim()))];
    if (orderIds.some(id => !id)) throw Error('A selected order is missing its saved ID. Refresh Order Hub and try again.');
    const stopIds = [...new Set(orders.map(order => String(order.savedStopId || '').trim()))];
    if (stopIds.some(id => !id || !stopById.has(id))) throw Error('A selected order needs a saved delivery stop. Review the order before planning.');
    if (Number.isFinite(maxStops) && stopIds.length > maxStops) throw Error('This plan supports ' + maxStops + ' selected stops. Choose fewer orders or change plan.');
    return { orderIds, stopIds, planningDateTime: selectedSchedule(orders), selectedAddresses: stopIds.map(id => stopById.get(id).address) };
  }

  function save(uid, selection) {
    if (!uid || !selection?.orderIds?.length || !selection?.stopIds?.length) throw Error('Order planning selection is incomplete.');
    global.sessionStorage.setItem(KEY, JSON.stringify({ uid, orderIds: selection.orderIds, stopIds: selection.stopIds, planningDateTime: selection.planningDateTime, createdAt: Date.now() }));
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

  global.GoRouteXOrderPlan = { prepare, save, read, clear };
})(window);
