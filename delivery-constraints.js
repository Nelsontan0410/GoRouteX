/**
 * Customer delivery constraints: the seven-day receiving schedule and service duration.
 *
 * One source of truth for the rules used by Settings (global defaults), the Customer Workspace (per-customer
 * overrides) and route planning (hard time windows). Times are "HH:MM" (24h) in the planning location's
 * local time; overnight intervals are not supported and are rejected with a clear message.
 *
 * Schedule shape: { monday: { open: true, windows: [{ start, end }], breaks: [{ start, end }] }, ... sunday }
 * Customer fields: deliveryScheduleMode 'default'|'custom', customDeliverySchedule (custom only),
 *                  serviceTimeMode 'default'|'custom', customServiceMinutes (custom only).
 * A customer in default mode stores no copy of the schedule, so changing the global default reaches it.
 */
(function (root) {
  const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const DAY_LABELS = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };
  const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
  const SERVICE_MINUTES_MIN = 1;
  const SERVICE_MINUTES_MAX = 240; // same bounds as Settings → Service Time per Stop
  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

  const weekday = () => ({ open: true, windows: [{ start: '09:00', end: '18:00' }], breaks: [{ start: '12:00', end: '13:00' }] });
  const closed = () => ({ open: false, windows: [], breaks: [] });
  function defaultSchedule() {
    return { monday: weekday(), tuesday: weekday(), wednesday: weekday(), thursday: weekday(), friday: weekday(), saturday: closed(), sunday: closed() };
  }

  function toMinutes(value) {
    const match = TIME_PATTERN.exec(String(value || '').trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function fromMinutes(minutes) {
    const total = Math.max(0, Math.round(minutes));
    const hours = Math.floor(total / 60);
    return `${String(hours).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function cleanInterval(interval) {
    return { start: String(interval?.start || '').trim(), end: String(interval?.end || '').trim() };
  }

  function cloneSchedule(schedule) {
    const result = {};
    DAY_KEYS.forEach((day) => {
      const source = schedule?.[day] || {};
      result[day] = {
        open: source.open === true,
        windows: Array.isArray(source.windows) ? source.windows.map(cleanInterval) : [],
        breaks: Array.isArray(source.breaks) ? source.breaks.map(cleanInterval) : []
      };
    });
    return result;
  }

  function intervalErrors(intervals, label) {
    const errors = [];
    const parsed = [];
    intervals.forEach((interval) => {
      const start = toMinutes(interval.start);
      const end = toMinutes(interval.end);
      if (start === null || end === null) {
        errors.push(`${label} times must be in HH:MM (24-hour) format.`);
        return;
      }
      if (end <= start) {
        errors.push(`${label} ${interval.start}–${interval.end}: end time must be after start time (overnight hours are not supported).`);
        return;
      }
      parsed.push({ start, end, text: `${interval.start}–${interval.end}` });
    });
    parsed.sort((a, b) => a.start - b.start);
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].start < parsed[i - 1].end) errors.push(`${label} ${parsed[i - 1].text} and ${parsed[i].text} overlap.`);
    }
    return { errors, parsed };
  }

  /** Returns { valid, errors: [{ day, message }] }. */
  function validateSchedule(schedule) {
    const errors = [];
    if (!schedule || typeof schedule !== 'object') return { valid: false, errors: [{ day: null, message: 'A delivery schedule is required.' }] };
    DAY_KEYS.forEach((day) => {
      const entry = schedule[day];
      const name = DAY_LABELS[day];
      const add = (message) => errors.push({ day, message: `${name}: ${message}` });
      if (!entry || typeof entry !== 'object' || typeof entry.open !== 'boolean') {
        add('choose open or closed.');
        return;
      }
      const windows = Array.isArray(entry.windows) ? entry.windows.map(cleanInterval) : [];
      const breaks = Array.isArray(entry.breaks) ? entry.breaks.map(cleanInterval) : [];
      if (!entry.open) {
        if (windows.length || breaks.length) add('a closed day cannot have receiving hours or breaks.');
        return;
      }
      if (!windows.length) {
        add('an open day needs receiving hours.');
        return;
      }
      const receiving = intervalErrors(windows, 'Receiving hours');
      const blocked = intervalErrors(breaks, 'Break');
      receiving.errors.concat(blocked.errors).forEach(add);
      if (receiving.errors.length || blocked.errors.length) return;
      blocked.parsed.forEach((block) => {
        const inside = receiving.parsed.some((window) => block.start >= window.start && block.end <= window.end);
        if (!inside) add(`break ${block.text} must be inside the receiving hours.`);
      });
    });
    return { valid: errors.length === 0, errors };
  }

  function validateServiceMinutes(value) {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < SERVICE_MINUTES_MIN || minutes > SERVICE_MINUTES_MAX) {
      return { valid: false, message: `Service time must be a whole number of minutes from ${SERVICE_MINUTES_MIN} to ${SERVICE_MINUTES_MAX}.` };
    }
    return { valid: true, minutes };
  }

  function globalDefaults(settings) {
    const planning = settings?.routePlanning || settings || {};
    const scheduleCandidate = planning.defaultDeliverySchedule;
    const schedule = scheduleCandidate && validateSchedule(scheduleCandidate).valid ? cloneSchedule(scheduleCandidate) : defaultSchedule();
    const service = validateServiceMinutes(planning.serviceMinutes);
    return { schedule, serviceMinutes: service.valid ? service.minutes : null };
  }

  /**
   * Effective values for one customer: a custom value wins only when it is set and valid; otherwise the
   * current global default applies (resolved now, never copied onto the customer).
   */
  function resolveCustomerConstraints(customer, settings) {
    const defaults = globalDefaults(settings);
    const customSchedule = customer?.deliveryScheduleMode === 'custom' && customer.customDeliverySchedule
      && validateSchedule(customer.customDeliverySchedule).valid;
    const customService = customer?.serviceTimeMode === 'custom' && validateServiceMinutes(customer.customServiceMinutes).valid;
    return {
      schedule: customSchedule ? cloneSchedule(customer.customDeliverySchedule) : defaults.schedule,
      scheduleMode: customSchedule ? 'custom' : 'default',
      serviceMinutes: customService ? Number(customer.customServiceMinutes) : defaults.serviceMinutes,
      serviceMode: customService ? 'custom' : 'default'
    };
  }

  /** Continuous allowed periods for one day, in minutes: receiving hours minus breaks. */
  function allowedIntervals(schedule, day) {
    const entry = schedule?.[day];
    if (!entry || !entry.open) return [];
    const windows = (entry.windows || []).map((w) => ({ start: toMinutes(w.start), end: toMinutes(w.end) })).filter((w) => w.start !== null && w.end !== null && w.end > w.start);
    const breaks = (entry.breaks || []).map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end) })).filter((b) => b.start !== null && b.end !== null && b.end > b.start);
    const result = [];
    windows.sort((a, b) => a.start - b.start).forEach((window) => {
      let pieces = [window];
      breaks.forEach((block) => {
        pieces = pieces.flatMap((piece) => {
          if (block.end <= piece.start || block.start >= piece.end) return [piece];
          const parts = [];
          if (block.start > piece.start) parts.push({ start: piece.start, end: block.start });
          if (block.end < piece.end) parts.push({ start: block.end, end: piece.end });
          return parts;
        });
      });
      result.push(...pieces);
    });
    return result.sort((a, b) => a.start - b.start);
  }

  /**
   * Earliest service that starts no earlier than arrival and fits entirely inside one allowed period.
   * Returns { ok: true, start, end, waitMinutes } or { ok: false, reason, message }.
   */
  function scheduleService(arrivalMinutes, serviceMinutes, schedule, day) {
    const intervals = allowedIntervals(schedule, day);
    if (!intervals.length) return { ok: false, reason: 'closed', message: `Closed on ${DAY_LABELS[day] || day}.` };
    for (const interval of intervals) {
      const start = Math.max(arrivalMinutes, interval.start);
      if (start + serviceMinutes <= interval.end) {
        return { ok: true, start, end: start + serviceMinutes, waitMinutes: start - arrivalMinutes };
      }
    }
    const longest = Math.max(...intervals.map((i) => i.end - i.start));
    if (serviceMinutes > longest) {
      return { ok: false, reason: 'service-too-long', message: `The ${serviceMinutes}-minute service does not fit in any receiving period.` };
    }
    return { ok: false, reason: 'after-hours', message: `Arrives at ${fromMinutes(arrivalMinutes)}, too late to finish ${serviceMinutes} minutes of service before receiving closes.` };
  }

  function dayKeyFromDate(date) {
    const index = (date instanceof Date ? date : new Date(date)).getDay(); // 0 = Sunday, local time
    return DAY_KEYS[(index + 6) % 7];
  }

  function dayDescription(entry) {
    if (!entry?.open) return 'closed';
    const windows = (entry.windows || []).map((w) => `${w.start}–${w.end}`).join(', ');
    const breaks = (entry.breaks || []).map((b) => `${b.start}–${b.end}`).join(', ');
    return breaks ? `${windows} (break ${breaks})` : windows;
  }

  /** Compact summary, grouping consecutive days with the same hours, e.g. "Mon–Fri 09:00–18:00 (break 12:00–13:00) · Sat–Sun closed". */
  function describeSchedule(schedule) {
    const groups = [];
    DAY_KEYS.forEach((day) => {
      const text = dayDescription(schedule?.[day]);
      const last = groups[groups.length - 1];
      if (last && last.text === text) last.days.push(day);
      else groups.push({ text, days: [day] });
    });
    return groups.map(({ text, days }) => {
      const label = days.length === 1 ? DAY_SHORT[days[0]] : `${DAY_SHORT[days[0]]}–${DAY_SHORT[days[days.length - 1]]}`;
      return `${label} ${text}`;
    }).join(' · ');
  }

  /** Fields to persist on a customer record; default modes store no copied values. */
  function customerConstraintFields(input) {
    const scheduleMode = input?.deliveryScheduleMode === 'custom' ? 'custom' : 'default';
    const serviceMode = input?.serviceTimeMode === 'custom' ? 'custom' : 'default';
    const fields = { deliveryScheduleMode: scheduleMode, serviceTimeMode: serviceMode };
    if (scheduleMode === 'custom' && input.customDeliverySchedule) fields.customDeliverySchedule = cloneSchedule(input.customDeliverySchedule);
    if (serviceMode === 'custom' && input.customServiceMinutes !== undefined && input.customServiceMinutes !== null && input.customServiceMinutes !== '') {
      fields.customServiceMinutes = Number(input.customServiceMinutes);
    }
    return fields;
  }

  /** Validation for a customer's override fields: returns a list of messages (empty when valid). */
  function validateCustomerConstraints(input) {
    const messages = [];
    if (input?.deliveryScheduleMode === 'custom') {
      validateSchedule(input.customDeliverySchedule).errors.forEach((error) => messages.push(error.message));
    }
    if (input?.serviceTimeMode === 'custom') {
      const service = validateServiceMinutes(input.customServiceMinutes);
      if (!service.valid) messages.push(service.message);
    }
    return messages;
  }

  /**
   * Narrows a schedule to one extra window (an order's time window) on every day: receiving periods are
   * cut to [start, end]; a day with nothing left becomes closed; breaks outside what is left are dropped.
   */
  function restrictSchedule(schedule, start, end) {
    const from = toMinutes(start), to = toMinutes(end);
    const result = cloneSchedule(schedule);
    if (from === null || to === null || to <= from) return result;
    DAY_KEYS.forEach((day) => {
      const entry = result[day];
      if (!entry.open) return;
      const windows = entry.windows
        .map((w) => ({ start: Math.max(toMinutes(w.start), from), end: Math.min(toMinutes(w.end), to) }))
        .filter((w) => w.end > w.start);
      if (!windows.length) { result[day] = { open: false, windows: [], breaks: [] }; return; }
      entry.windows = windows.map((w) => ({ start: fromMinutes(w.start), end: fromMinutes(w.end) }));
      entry.breaks = entry.breaks.filter((b) => windows.some((w) => toMinutes(b.start) >= w.start && toMinutes(b.end) <= w.end));
    });
    return result;
  }

  const api = {
    restrictSchedule,
    DAY_KEYS,
    DAY_LABELS,
    DAY_SHORT,
    SERVICE_MINUTES_MIN,
    SERVICE_MINUTES_MAX,
    defaultSchedule,
    cloneSchedule,
    toMinutes,
    fromMinutes,
    validateSchedule,
    validateServiceMinutes,
    globalDefaults,
    resolveCustomerConstraints,
    allowedIntervals,
    scheduleService,
    dayKeyFromDate,
    describeSchedule,
    describeDay: dayDescription,
    customerConstraintFields,
    validateCustomerConstraints
  };
  root.GoRouteXDeliveryConstraints = api;
})(typeof window !== 'undefined' ? window : globalThis);
