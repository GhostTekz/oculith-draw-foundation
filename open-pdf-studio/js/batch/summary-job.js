// Batch ▸ Summary as a runner job (runner.js): read each PDF's markups
// (summary-read.js), then build one CSV / XLSX / PDF (summary-output.js).
// The job returns the files as bytes; the dialog writes them after a
// completed run, so a cancelled run leaves nothing behind.

import { readPdfMarkups, fileSummaryRows } from './summary-read.js';
import { combineSummaries, buildSummaryOutputs, SUMMARY_FORMATS } from './summary-output.js';
import { throwIfCancelled } from './runner.js';

/** `markups-summary-2026-10-14` for a run on that (local) date. */
export function summaryBaseName(date = new Date()) {
  const d = new Date(date);
  const two = (n) => String(n).padStart(2, '0');
  return `markups-summary-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * @param {object} options
 * @param {object} options.pdfjs  the PDF.js module
 * @param {string} [options.sortBy]  one of SUMMARY_SORT_KEYS
 * @param {string[]} [options.formats]  any of 'csv', 'xlsx', 'pdf'
 * @param {Uint8Array} [options.fontBytes]  LiberationSans, needed for 'pdf'
 */
export function batchSummaryJob({ pdfjs, sortBy = 'file', formats = SUMMARY_FORMATS, fontBytes, generatedAt, baseName } = {}) {
  if (formats.includes('pdf') && !fontBytes?.byteLength) throw new Error('The PDF summary needs the bundled font.');
  return {
    id: 'summary',
    async processFile(file, { signal }) {
      const read = await readPdfMarkups(file.bytes, { pdfjs, signal });
      return { file: { name: file.name, path: file.path }, pageCount: read.pageCount, rows: fileSummaryRows(read, { file: file.name }) };
    },
    describe: (result) => result.rows.length,
    async finish(successes, { log, signal }) {
      if (!successes.length) return { summary: null, outputs: [] };
      const when = generatedAt ? new Date(generatedAt) : new Date();
      const summary = combineSummaries(successes.map((s) => s.result), { sortBy, log, generatedAt: when });
      throwIfCancelled(signal);
      const outputs = await buildSummaryOutputs(summary, { formats, fontBytes, baseName: baseName || summaryBaseName(when) });
      return { summary, outputs };
    },
  };
}
