// GoRouteX planning service: VROOM (VRPTW solver) with an in-process OSRM road network of Singapore.
// Runs on Cloud Run (scales to zero). Only netlify/functions/plan-routes.js calls it, with X-Planner-Key.
//
//   GET  /health  -> { ok: true }                     (wakes the instance)
//   POST /solve   -> VROOM solution                    (body: VROOM problem with [lng, lat] locations)
//   POST /route   -> OSRM route { distance, duration, legs, geometry } (body: { coordinates: [[lng, lat], ...] })
//
// Env: PLANNER_KEY (required), OSRM_DATA (default /data/singapore.osrm), VROOM_BIN (default vroom),
//      PORT (default 8080), SOLVE_SECONDS (default 5), DURATION_FACTOR (calibration, default 1).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import OSRMModule from '@project-osrm/osrm';
import { improveSolution } from './improve.mjs';

const OSRM = OSRMModule.default || OSRMModule;
const KEY = process.env.PLANNER_KEY || '';
const PORT = Number(process.env.PORT) || 8080;
const VROOM_BIN = process.env.VROOM_BIN || 'vroom';
const SOLVE_SECONDS = Number(process.env.SOLVE_SECONDS) || 5;
const DURATION_FACTOR = Number(process.env.DURATION_FACTOR) || 1;
const UNREACHABLE_SECONDS = 24 * 3600; // a pair with no road connection is never chosen
const MAX_BODY_BYTES = 1_000_000;

if (!KEY) {
  console.error('PLANNER_KEY is not set');
  process.exit(1);
}
const osrm = new OSRM({ path: process.env.OSRM_DATA || '/data/singapore.osrm', algorithm: 'MLD' });

function authorized(req) {
  const given = Buffer.from(String(req.headers['x-planner-key'] || ''));
  const expected = Buffer.from(KEY);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const osrmCall = (method, options) => new Promise((resolve, reject) => {
  osrm[method](options, (error, result) => (error ? reject(error) : resolve(result)));
});

/** Replaces [lng, lat] locations with indexes into one OSRM duration matrix (VROOM custom matrix). */
export async function withMatrix(problem) {
  const points = [];
  const indexOf = new Map();
  const index = (location) => {
    const key = `${location[0]},${location[1]}`;
    if (!indexOf.has(key)) { indexOf.set(key, points.length); points.push(location); }
    return indexOf.get(key);
  };
  const jobs = problem.jobs.map(({ location, ...job }) => ({ ...job, location_index: index(location) }));
  const vehicles = problem.vehicles.map(({ start, end, ...vehicle }) => ({
    ...vehicle,
    start_index: index(start),
    ...(end ? { end_index: index(end) } : {})
  }));
  const table = await osrmCall('table', { coordinates: points, annotations: ['duration'] });
  const durations = table.durations.map((row) => row.map((value) => (value === null ? UNREACHABLE_SECONDS : Math.round(value * DURATION_FACTOR))));
  return { ...problem, jobs, vehicles, matrices: { car: { durations } } };
}

export function runVroom(input, seconds = SOLVE_SECONDS) {
  return new Promise((resolve, reject) => {
    const child = spawn(VROOM_BIN, ['-l', String(seconds), '-t', '1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const killer = setTimeout(() => child.kill('SIGKILL'), (seconds + 5) * 1000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (error) => { clearTimeout(killer); reject(error); });
    child.on('close', () => {
      clearTimeout(killer);
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`VROOM failed: ${err.slice(0, 300) || out.slice(0, 300)}`)); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export async function solve(problem) {
  const input = await withMatrix(problem);
  const solution = await runVroom(input);
  // VROOM does not count waiting time; re-optimise with GoRouteX's objective (see improve.mjs).
  if (process.env.PLANNER_IMPROVE === '0') return solution;
  return improveSolution(input, solution);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
    if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' });
    if (req.method === 'POST' && req.url === '/solve') return send(res, 200, await solve(await readBody(req)));
    if (req.method === 'POST' && req.url === '/route') {
      const body = await readBody(req);
      const result = await osrmCall('route', { coordinates: body.coordinates, overview: 'full', geometries: 'geojson', steps: false });
      const route = result.routes[0];
      return send(res, 200, { distance: route.distance, duration: route.duration * DURATION_FACTOR, legs: route.legs.map((leg) => ({ distance: leg.distance, duration: leg.duration * DURATION_FACTOR })), geometry: route.geometry });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Planner error:', error.message);
    return send(res, error.status || 500, { error: error.status ? error.message : 'Planner error' });
  }
});

if (process.env.PLANNER_NO_LISTEN !== '1') server.listen(PORT, () => console.log(`planner listening on ${PORT}`));
export { server };
