import { fingerprintPdfBytes, inspectPdfPages } from './pdf-page-import.js';
import { sortSheetsByLabel } from './sheet-register.js';

async function inspectSource(path, readSource) {
  let bytes;
  try { bytes = await readSource(path); }
  catch { return { availability: 'missing' }; }
  if (!bytes?.length) return { availability: 'missing' };
  let observedSha256;
  try {
    observedSha256 = await fingerprintPdfBytes(bytes);
    const { pageCount } = await inspectPdfPages(bytes);
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('PDF has no pages');
    return { availability: 'readable', observedSha256, pageCount, byteLength: bytes.length };
  } catch { return { availability: 'unreadable', observedSha256, byteLength: bytes.length }; }
}

/** Snapshot current registered sources without changing the register or any PDF. */
export async function buildSetTransmittalReadiness(register, readSource) {
  const sheets = sortSheetsByLabel(register.sheets);
  const paths = [...new Set(sheets.map(sheet => sheet.filePath))];
  const inspected = new Map();
  let nextPath = 0;
  await Promise.all(Array.from({ length: Math.min(2, paths.length) }, async () => {
    while (nextPath < paths.length) {
      const path = paths[nextPath++];
      inspected.set(path, await inspectSource(path, readSource));
    }
  }));

  const rows = sheets.map(sheet => {
    const source = inspected.get(sheet.filePath);
    const issues = [];
    if (source.availability !== 'readable') issues.push(source.availability);
    else {
      if (!/^[a-f0-9]{64}$/.test(sheet.sourceSha256 || '')) issues.push('unverified');
      else if (sheet.sourceSha256 !== source.observedSha256) issues.push('changed');
      if (!Number.isSafeInteger(sheet.page) || sheet.page < 1 || sheet.page > source.pageCount)
        issues.push('invalid-page');
    }
    return { sheetId: sheet.id, label: sheet.label, title: sheet.title,
      revision: sheet.revision, filePath: sheet.filePath, page: sheet.page,
      recordedSha256: sheet.sourceSha256 || null,
      observedSha256: source.observedSha256 || null, pageCount: source.pageCount || null,
      byteLength: source.byteLength || null,
      issues, status: issues[0] || 'ready' };
  });
  return { register, rows, readyCount: rows.filter(row => row.status === 'ready').length };
}
