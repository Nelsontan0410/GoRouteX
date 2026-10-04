import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-site.mjs', import.meta.url), 'utf8');

test('stop imports support CSV, Excel and a public Google Sheet with column review', () => {
  assert.match(app, /accept="\.csv,\.tsv,\.txt,\.xlsx,\.xls/);
  assert.match(app, /id="googleSheetImportUrl"/);
  assert.match(app, /id="csvImportMappingSection"/);
  assert.match(app, /function getGoogleSheetCsvExportUrl/);
  assert.match(app, /function readStopsImportFile/);
  assert.match(app, /window\.XLSX\.utils\.sheet_to_csv/);
});

test('the Excel reader is bundled into the production site', () => {
  assert.equal(existsSync(new URL('../vendor/xlsx.full.min.js', import.meta.url)), true);
  assert.match(app, /<script src="vendor\/xlsx\.full\.min\.js"><\/script>/);
  assert.match(build, /vendor.*xlsx\.full\.min\.js/s);
});

test('the build fails when a page or module references a file missing from dist', () => {
  assert.match(build, /Build output is missing \$\{missing\.length\} referenced file/);
  assert.match(build, /process\.exit\(1\)/);
});
