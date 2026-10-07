// Plan Engine shadow and calibration report (read-only).
// Credentials: FIREBASE_SERVICE_ACCOUNT_JSON, or Application Default Credentials (gcloud auth application-default login).
//   node scripts/plan-engine-report.mjs [--days 30]
import admin from 'firebase-admin';
import { summariseShadow, summariseCalibration } from './lib/plan-engine-report.mjs';

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 30;
const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
admin.initializeApp(json ? { credential: admin.credential.cert(JSON.parse(json)) } : { projectId: process.env.FIREBASE_PROJECT_ID || 'delivery-app-cd18e' });
const db = admin.firestore();
const since = admin.firestore.Timestamp.fromDate(new Date(Date.now() - days * 86400000));
const read = async (name) => (await db.collection(name).where('createdAt', '>=', since).get()).docs.map((d) => d.data());

const shadow = summariseShadow(await read('planEngineShadow'));
const calibration = summariseCalibration(await read('planEngineCalibration'));
console.log(JSON.stringify({ days, shadow, calibration }, null, 2));
console.log(shadow.readyForRollout
  ? '\nREADY: the Plan Engine met the rollout gate. Set PLAN_ENGINE_ENABLED = true in planning/plan-engine-client.js.'
  : `\nNOT YET: need ${shadow.gate.minComparisons}+ comparisons with no more violations in ${shadow.gate.minNoWorseViolationsShare * 100}% and no longer total time.`);
if (calibration.recommendedDurationFactor) console.log(`Calibration: set DURATION_FACTOR=${calibration.recommendedDurationFactor} on the planning service.`);
