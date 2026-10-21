import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(read('csv-export.js'), ctx);
const E = ctx.GoRouteXExport;
const xlsxCtx = vm.createContext({ Uint8Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, console });
vm.runInContext(read('vendor/xlsx.full.min.js'), xlsxCtx);
const XLSX = xlsxCtx.XLSX;

const HEADER = ['Customer Name', 'Phone', 'Address', 'Unit', 'Notes'];
const ROWS = [
  ['新加坡 客户 A', '0123456789', '1 Jalan "Besar", #01-02', '', 'Back door'],
  ['Lim & Sons', '0012345678', 'Line one\r\nLine two', 'Blk 5', 'ok'],
  ['Café Ünïcode ✓', '+6586123456', '12 Main St', '', ''],
  ['=SUM(A1)', '+60 12-345 6789', 'Johor, Malaysia', '', 'note, with comma']
];

test('CSV starts with exactly one UTF-8 BOM and uses CRLF between records', () => {
  const csv = E.buildCsv(HEADER, ROWS);
  const bytes = Buffer.from(csv, 'utf8');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.notDeepEqual([...bytes.subarray(3, 6)], [0xef, 0xbb, 0xbf], 'only one BOM');
  assert.ok(csv.startsWith('﻿Customer Name,Phone,Address,Unit,Notes\r\n'), 'header and order unchanged');
});

test('RFC 4180 quoting: commas, quotes and line breaks; values are never rewritten', () => {
  const csv = E.buildCsv(HEADER, ROWS);
  assert.ok(csv.includes('"1 Jalan ""Besar"", #01-02"'));
  assert.ok(csv.includes('"Line one\r\nLine two"'));
  assert.ok(csv.includes('"note, with comma"'));
  for (const phone of ['0123456789', '0012345678', '+6586123456', '+60 12-345 6789']) assert.ok(csv.includes(`,${phone},`), phone);
  assert.ok(csv.includes('\r\n=SUM(A1),'), 'no prefix, apostrophe or formula is added');
  assert.doesNotMatch(csv, /="|​|⁠/);
});

test('a strict CSV reader gets the original values back (BOM stripped as browsers do on file.text())', async () => {
  const csv = E.buildCsv(HEADER, ROWS);
  const decoded = await new Blob([csv]).text();
  assert.ok(!decoded.startsWith('﻿'), 'Blob.text() drops the BOM (WHATWG UTF-8 decode)');
  const { parseDelimited } = await import('../orders/spreadsheet-reader.js');
  const parsed = parseDelimited(decoded, ',');
  assert.deepEqual(parsed.headers, HEADER);
  assert.deepEqual(parsed.rows, ROWS);
  assert.equal('﻿Customer Name'.trim(), 'Customer Name', 'the customer importer trims the header too');
});

test('XLSX export: every cell is text, phone numbers keep leading zeros and +, nothing is a formula', () => {
  const data = E.buildXlsx(XLSX, 'Customers', HEADER, ROWS);
  const workbook = XLSX.read(data, { type: 'array', cellFormula: true });
  const sheet = workbook.Sheets.Customers;
  assert.deepEqual([...XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })[0]], HEADER);
  const phones = ['B2', 'B3', 'B4', 'B5'].map((ref) => sheet[ref]);
  assert.deepEqual([...phones.map((c) => c.v)], ['0123456789', '0012345678', '+6586123456', '+60 12-345 6789']);
  assert.ok(phones.every((c) => c.t === 's'));
  assert.equal(sheet.A5.v, '=SUM(A1)');
  assert.equal(sheet.A5.f, undefined, 'stored as text, not a formula');
  assert.equal(sheet.A2.v, '新加坡 客户 A');
  assert.equal(sheet.C3.v, 'Line one\r\nLine two');
});

test('the app uses the shared exporter for CSV, the template and Excel', () => {
  const app = read('app.html');
  assert.doesNotMatch(app, /function downloadCsvText|function csvCell|new Blob\(\[csvContent\]/);
  assert.match(app, /GoRouteXExport\.downloadCsv\(`goroutex-stops-\$\{today\}\.csv`, CUSTOMER_EXPORT_HEADER/);
  assert.match(app, /GoRouteXExport\.downloadCsv\('goroutex-stops-template\.csv', CUSTOMER_EXPORT_HEADER/);
  assert.match(app, /GoRouteXExport\.downloadXlsx\(`goroutex-stops-\$\{today\}\.xlsx`, 'Customers', CUSTOMER_EXPORT_HEADER/);
  assert.match(app, /const CUSTOMER_EXPORT_HEADER = \['Customer Name', 'Phone', 'Address', 'Unit', 'Notes', 'Latitude', 'Longitude'\];/);
  assert.match(app, /<script src="csv-export\.js"><\/script>/);
});

test('Search → Edit opens the full form, keeps the id, returns to the search; a changed address needs a new location', () => {
  const app = read('app.html');
  assert.match(app, /editingReturnToSearch = activeStopWorkspaceMode === 'edit';/);
  assert.match(app, /saveResult = await window\.RoutePlannerStorage\.updateStop\(editingStopId, stopData\);/);
  assert.match(app, /if \(returnToSearch\) returnToCustomerSearch\(`"\$\{stopName\}" updated\.`\);/);
  assert.match(app, /if \(manageStopsSearchInput\) manageStopsSearchInput\.value = manageStopsSearchTerm;/);
  assert.match(app, /if \(addressChanged && stopAddressNeedsLocation\(\)\) \{/);
  assert.match(app, /coordInput\.placeholder = 'Address changed: click Search on Map to confirm';/);
  assert.match(app, /if \(kind === 'contact'\) window\.OrderMasterMaintenance\?\.editContact\?\.\(id\);/, 'contacts keep their own form');
});
