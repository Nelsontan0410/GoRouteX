import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { DATASET_ID, SOURCE_URL, SPECIFICATION_URL, normalizeLtaGeoJSON } from './lib/lta-parser.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[i + 1];
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`LTA download request failed: HTTP ${response.status}`);
  return response;
}

async function download() {
  const base = `https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET_ID}`;
  await request(`${base}/initiate-download`, { method: 'GET' });
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await (await request(`${base}/poll-download`)).json();
    if (result.code && result.code !== 0) throw new Error('data.gov.sg could not prepare the download.');
    if (result.data?.url) {
      const url = new URL(result.data.url);
      if (url.protocol !== 'https:') throw new Error('Expected an HTTPS dataset download URL.');
      return Buffer.from(await (await request(url)).arrayBuffer());
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error('LTA download was not ready within the retry limit.');
}

async function main() {
  const input = option('--input');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = resolve(option('--output') || resolve(root, 'data/lta-restrictions.json'));
  const bytes = input ? await readFile(resolve(input)) : await download();
  const parsed = normalizeLtaGeoJSON(JSON.parse(bytes.toString('utf8')));
  const count4002 = parsed.signs.filter((s) => s.signCode === '4002' && s.threshold === 2500 && s.comparison === 'EXCEEDING').length;
  if (!count4002) throw new Error('4002 extraction check failed. Existing output has not been replaced.');
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Existing output cannot be read; inspect it before updating.'); }
  if (previous && (parsed.sourceFeatureCount < previous.sourceFeatureCount * 0.8 || parsed.signs.length < previous.signs.length * 0.8)) {
    throw new Error('Source or retained sign count fell by more than 20%. Generate to a separate --output path and review before replacing the published dataset.');
  }
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const dataset = {
    schemaVersion: 1, datasetId: DATASET_ID, sourceUrl: SOURCE_URL,
    generatedAt: new Date().toISOString(), sourceSha256, sourceBytes: bytes.length,
    // Source publication metadata is optional and explicitly supplied; generation time is not data age.
    sourceDataPeriod: option('--source-period'), sourcePublishedDate: option('--source-published'),
    bearingSpecification: { url: SPECIFICATION_URL, section: '16.37 note 4', convention: 'Traffic flow except codes 1014 and 4006' }, thresholdsFrom: 'Explicit source descriptions only',
    ...parsed, count4002
  };
  await mkdir(dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(dataset) + '\n');
    await rename(temp, output);
  } finally { await rm(temp, { force: true }); }
  console.log(JSON.stringify({ output, sourceFeatureCount: parsed.sourceFeatureCount, retained: parsed.signs.length,
    count4002, outputBytes: Buffer.byteLength(JSON.stringify(dataset)), sourceSha256, issues: parsed.issues }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
