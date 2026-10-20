/**
 * One way to write spreadsheet exports (customer export and the import template).
 *
 * CSV: UTF-8 with exactly one BOM (EF BB BF) so Windows Excel reads Chinese and other non-ASCII text correctly;
 * RFC 4180 quoting (a cell containing a comma, double quote, CR or LF is wrapped in quotes and inner quotes are
 * doubled); CRLF between records. Cell values are written exactly as stored: nothing is prefixed or rewritten.
 *
 * Limitation (by design): a CSV file has no column types. When Excel opens a CSV directly it converts number-like
 * text, so "0123456789" shows as 123456789 and "+6586123456" as 6586123456. Adding ="..." formulas, apostrophes or
 * invisible characters would change the data and break re-import, so the CSV is left faithful. For phone numbers
 * that must look right in Excel, use the XLSX export: every cell is written as a text cell (format "@"), which
 * Excel shows unchanged and never evaluates as a formula.
 *
 * Exposes window.GoRouteXExport.
 */
(function (root) {
  const BOM = '﻿';
  const CRLF = '\r\n';

  function cell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  /** header: [string], rows: [[value]] -> CSV text with one leading BOM. */
  function buildCsv(header, rows) {
    const lines = [header, ...(rows || [])].map((row) => row.map(cell).join(','));
    return BOM + lines.join(CRLF);
  }

  function saveBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  function downloadCsv(filename, header, rows) {
    saveBlob(new Blob([buildCsv(header, rows)], { type: 'text/csv;charset=utf-8' }), filename);
  }

  /** Worksheet with every cell stored as text ("s" type, number format "@"). Needs SheetJS (vendor/xlsx). */
  function buildTextSheet(XLSX, header, rows) {
    const matrix = [header, ...(rows || [])].map((row) => row.map((value) => String(value ?? '')));
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    for (const address of Object.keys(sheet)) {
      if (address[0] === '!') continue;
      sheet[address].t = 's';
      sheet[address].z = '@';
    }
    sheet['!cols'] = header.map((title, index) => ({ wch: Math.min(60, Math.max(String(title).length, ...matrix.slice(1).map((row) => String(row[index] ?? '').length)) + 2) }));
    return sheet;
  }

  function buildXlsx(XLSX, sheetName, header, rows) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, buildTextSheet(XLSX, header, rows), sheetName);
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  }

  function downloadXlsx(filename, sheetName, header, rows) {
    const XLSX = root.XLSX;
    if (!XLSX?.utils?.aoa_to_sheet || !XLSX.write) throw new Error('Excel export is unavailable. Reload the page and try again.');
    saveBlob(new Blob([buildXlsx(XLSX, sheetName, header, rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  }

  root.GoRouteXExport = { BOM, cell, buildCsv, downloadCsv, buildTextSheet, buildXlsx, downloadXlsx };
})(typeof window !== 'undefined' ? window : globalThis);
