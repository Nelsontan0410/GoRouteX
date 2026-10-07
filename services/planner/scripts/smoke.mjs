import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const ctx = vm.createContext({});
vm.runInContext(readFileSync(`${ROOT}/delivery-constraints.js`, 'utf8'), ctx);
vm.runInContext(readFileSync(`${ROOT}/planner-problem.js`, 'utf8'), ctx);
const C = ctx.GoRouteXDeliveryConstraints, P = ctx.GoRouteXPlannerProblem;
const morning = C.defaultSchedule(); morning.monday = { open: true, windows: [{ start: '09:00', end: '10:30' }], breaks: [] };
const afternoon = C.defaultSchedule(); afternoon.monday = { open: true, windows: [{ start: '14:00', end: '17:00' }], breaks: [] };
const closedMon = C.defaultSchedule(); closedMon.monday = { open: false, windows: [], breaks: [] };
const places = [
  ['tampines', 1.3530, 103.9450], ['bedok', 1.3240, 103.9300], ['changi-biz', 1.3340, 103.9630, morning], ['pasir-ris', 1.3730, 103.9490],
  ['woodlands', 1.4360, 103.7860, morning], ['yishun', 1.4290, 103.8350], ['amk', 1.3700, 103.8490], ['bishan', 1.3510, 103.8480],
  ['orchard', 1.3040, 103.8320, afternoon], ['raffles', 1.2840, 103.8510], ['harbourfront', 1.2650, 103.8220], ['queenstown', 1.2940, 103.8060],
  ['clementi', 1.3150, 103.7650], ['jurong-w', 1.3400, 103.7060], ['tuas', 1.3200, 103.6500, closedMon], ['bukit-batok', 1.3490, 103.7490],
  ['punggol', 1.4050, 103.9020], ['sengkang', 1.3920, 103.8950]
];
const stops = places.map(([id, lat, lng, schedule]) => ({ id, lat, lng, serviceMinutes: 20, schedule: schedule || C.defaultSchedule() }));
const input = { startDate: new Date(2026, 9, 5, 9, 0), origin: { lat: 1.3331, lng: 103.7424 }, end: { lat: 1.3331, lng: 103.7424 }, availableDrivers: 0,
  driverRules: { workingStart: '08:00', workingEnd: '18:00', breakMinutes: 60, maxStops: 20 }, maxDurationMinutes: 600, stops };
console.log('unsupported:', P.unsupportedReason(input));
const built = P.buildProblem(input);
const t0 = performance.now();
const res = await fetch(`${process.env.PLANNER_URL || 'http://127.0.0.1:8088'}/solve`, { method: 'POST', headers: { 'X-Planner-Key': process.env.PLANNER_KEY || 'test-key', 'Content-Type': 'application/json' }, body: JSON.stringify(built.problem) });
const solution = await res.json();
const ms = Math.round(performance.now() - t0);
if (solution.code !== 0) { console.log('FAILED', res.status, solution); process.exit(1); }
const mapped = P.mapSolution(solution, built);
console.log(`solve ${ms} ms; routes ${mapped.routes.length}; cost ${solution.summary.cost}; unassigned ${mapped.unassigned.map((u) => `${u.id}:${u.reason}`).join(', ') || 'none'}`);
let violations = 0;
for (const [i, route] of mapped.routes.entries()) {
  console.log(`Route ${i + 1} (${route.stops.length} stops): ` + route.stops.map((s) => `${s.id}@${s.serviceStart}${s.waitMinutes ? `(wait ${s.waitMinutes})` : ''}`).join(' -> '));
  if (route.stops.length > 8) violations++;
  for (const s of route.stops) {
    const stop = stops.find((x) => x.id === s.id);
    const fit = C.scheduleService(C.toMinutes(s.serviceStart), stop.serviceMinutes, stop.schedule, 'monday');
    if (!fit.ok || fit.waitMinutes > 0) { violations++; console.log('  VIOLATION', s.id, s.serviceStart, fit.message || `needs wait ${fit.waitMinutes}`); }
  }
}
const breaks = solution.routes.map((r) => r.steps.filter((s) => s.type === 'break').map((s) => C.fromMinutes(Math.floor((s.arrival + (s.waiting_time || 0)) / 60))));
console.log('driver breaks start at:', JSON.stringify(breaks));
console.log(violations ? `FAIL: ${violations} violations` : 'PASS: every service starts and finishes inside its customer window; <= 8 stops per route');
