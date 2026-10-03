import { readdir, mkdir, copyFile, rm } from 'node:fs/promises';
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
console.log(`Prepared ${count} public files in dist; backend functions are bundled separately.`);
