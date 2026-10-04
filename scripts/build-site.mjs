import { readdir, mkdir, copyFile, rm, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'data'), { recursive: true });
await mkdir(path.join(output, 'vendor'), { recursive: true });
for (const directory of ['orders', 'styles', 'driver', 'dispatch', 'settings', 'dashboard', 'history', 'planning']) await mkdir(path.join(output, directory), { recursive: true });
let count = 0;
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!(/\.(html|css|js|png|jpg|jpeg|svg|ico|webp|csv)$/.test(entry.name) || ['_headers', '_redirects'].includes(entry.name))) continue;
  if (/^(codex-|lta-debug|whatsapp-test-demo)/.test(entry.name) || entry.name === 'google-apps-script.js') continue;
  await copyFile(path.join(root, entry.name), path.join(output, entry.name));
  count++;
}
for (const name of ['lta-restrictions.json', 'singapore-boundary.geojson']) {
  await copyFile(path.join(root, 'data', name), path.join(output, 'data', name));
  count++;
}
for (const directory of ['orders', 'styles', 'driver', 'dispatch', 'settings', 'dashboard', 'history', 'planning']) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|css)$/.test(entry.name)) continue;
    await copyFile(path.join(root, directory, entry.name), path.join(output, directory, entry.name));
    count++;
  }
}
for (const name of ['xlsx.full.min.js']) {
  await copyFile(path.join(root, 'vendor', name), path.join(output, 'vendor', name));
  count++;
}

// Fail the build if any page or module references a local file that did not make it into dist.
const exists = file => access(file).then(() => true, () => false);
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full)); else files.push(full);
  }
  return files;
}
function localTarget(reference) {
  const value = reference.trim();
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value) || /[${}+]/.test(value)) return null;
  return value.split(/[?#]/)[0] || null;
}
async function resolves(fromFile, reference) {
  const target = path.join(reference.startsWith('/') ? output : path.dirname(fromFile), reference);
  if (!target.startsWith(output)) return false;
  if (await exists(target)) return !reference.endsWith('/') || exists(path.join(target, 'index.html'));
  return !path.extname(target) && exists(`${target}.html`);
}
const missing = [];
for (const file of await walk(output)) {
  const text = /\.(html|js)$/.test(file) ? await readFile(file, 'utf8') : '';
  const references = file.endsWith('.html')
    ? [...text.matchAll(/\s(?:src|href)=["']([^"']+)["']/g)].map(match => match[1])
    : [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)].map(match => match[1]);
  for (const reference of references) {
    const target = localTarget(reference);
    if (target && !(await resolves(file, target))) missing.push(`${path.relative(output, file)} -> ${reference}`);
  }
}
if (missing.length) {
  console.error(`Build output is missing ${missing.length} referenced file(s):\n  ${[...new Set(missing)].join('\n  ')}`);
  process.exit(1);
}
console.log(`Prepared ${count} public files in dist; backend functions are bundled separately.`);
