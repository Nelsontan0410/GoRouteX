// Planned vs actual, from driver executions of dispatched routes (phase 5 calibration).
// Planned ETAs are local Singapore/Malaysia times (UTC+8, no daylight saving) on the route date.

const OFFSET = '+08:00';
const MIN_VISITS_FOR_SUGGESTION = 5;
const SUGGESTION_THRESHOLD_MINUTES = 5;

/** "9:05 AM" / "13:05" on "2026-10-05" -> epoch ms, or null. */
export function plannedEtaMs(routeDate, plannedEta) {
  const date = String(routeDate || '').slice(0, 10);
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(plannedEta || '').trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = (match[3] || '').toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  const ms = Date.parse(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00${OFFSET}`);
  return Number.isFinite(ms) ? ms : null;
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p + 0.5))];
};
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

/**
 * executions: driver execution documents. defaultServiceMinutes: Settings value.
 * Returns ETA accuracy, actual service time overall and per customer, and service-time suggestions.
 */
export function computePlanInsights(executions, { defaultServiceMinutes = 15 } = {}) {
  const etaErrors = [];
  const services = [];
  const perCustomer = new Map();
  let completedStops = 0;
  for (const execution of executions || []) {
    for (const stop of execution?.stops || []) {
      if (!['DELIVERED', 'FAILED'].includes(stop?.executionStatus)) continue;
      completedStops++;
      const arrival = Date.parse(stop.actualArrivalAt || '');
      const planned = plannedEtaMs(execution.routeDate, stop.plannedEta);
      if (Number.isFinite(arrival) && planned !== null) etaErrors.push((arrival - planned) / 60000);
      const done = Date.parse(stop.actualCompletedAt || '');
      if (stop.executionStatus === 'DELIVERED' && Number.isFinite(arrival) && Number.isFinite(done) && done >= arrival) {
        const minutes = (done - arrival) / 60000;
        if (minutes <= 240) {
          services.push(minutes);
          const key = String(stop.savedStopId || stop.customerId || stop.stopName || '');
          if (key) {
            const entry = perCustomer.get(key) || { id: key, name: stop.stopName || stop.customerName || key, minutes: [] };
            entry.minutes.push(minutes);
            perCustomer.set(key, entry);
          }
        }
      }
    }
  }
  const absErrors = etaErrors.map(Math.abs);
  const customers = [...perCustomer.values()].map((entry) => ({
    id: entry.id,
    name: entry.name,
    visits: entry.minutes.length,
    medianServiceMinutes: round1(percentile(entry.minutes, 0.5))
  })).sort((a, b) => b.visits - a.visits);
  const suggestions = customers
    .filter((c) => c.visits >= MIN_VISITS_FOR_SUGGESTION && Math.abs(c.medianServiceMinutes - defaultServiceMinutes) >= SUGGESTION_THRESHOLD_MINUTES)
    .map((c) => ({ ...c, suggestedServiceMinutes: Math.max(1, Math.round(c.medianServiceMinutes)) }));
  const medianService = percentile(services, 0.5);
  return {
    routes: (executions || []).length,
    completedStops,
    eta: {
      samples: etaErrors.length,
      medianErrorMinutes: round1(percentile(etaErrors, 0.5)),
      p50AbsMinutes: round1(percentile(absErrors, 0.5)),
      p90AbsMinutes: round1(percentile(absErrors, 0.9)),
      within15MinutesShare: absErrors.length ? round1((absErrors.filter((m) => m <= 15).length / absErrors.length) * 100) : null
    },
    service: {
      samples: services.length,
      medianMinutes: round1(medianService),
      p80Minutes: round1(percentile(services, 0.8)),
      defaultMinutes: defaultServiceMinutes,
      suggestedDefaultMinutes: services.length >= 20 && medianService !== null && Math.abs(medianService - defaultServiceMinutes) >= SUGGESTION_THRESHOLD_MINUTES ? Math.round(medianService) : null
    },
    customerSuggestions: suggestions.slice(0, 20),
    minimumVisitsForSuggestion: MIN_VISITS_FOR_SUGGESTION
  };
}
