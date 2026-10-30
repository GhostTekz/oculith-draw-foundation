import { zipStore } from '../bcf/bcf-zip.js';
import { fingerprintPdfBytes } from './pdf-fingerprint.js';
import { buildCurrentSetPdf } from './publish-current-pdf.js';
import { sortSheetsByLabel } from './sheet-register.js';

export const SET_PACKAGE_LIMITS = Object.freeze({
  sheets: 200,
  sourceBytes: 128 * 1024 * 1024,
  pdfBytes: 96 * 1024 * 1024,
  archiveBytes: 100 * 1024 * 1024,
});

const SOURCE_HASH = /^[a-f0-9]{64}$/;
const PACKAGE_PDF = 'current-sheets.pdf';
const PACKAGE_MANIFEST = 'manifest.json';

function sourceName(path) {
  return (String(path).replaceAll('\\', '/').split('/').at(-1) || 'source.pdf')
    .replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120);
}

function snapshotSheet(sheet) {
  return { id: sheet.id, label: sheet.label, title: sheet.title,
    revision: sheet.revision, filePath: sheet.filePath,
    page: sheet.page, sourceSha256: sheet.sourceSha256 };
}

function assertPlanCurrent(plan) {
  if (JSON.stringify(plan.register) !== plan.registerJson) {
    throw new Error('The drawing set changed since package preview. Review its current sheets again.');
  }
}

/** Plan only current, ready pages selected by the user. No source reads or writes occur here. */
export function createSetPackagePlan(register, readiness, selectedIds) {
  if (readiness?.register !== register || !Array.isArray(selectedIds)) {
    throw new Error('Check current sheet readiness before preparing a package.');
  }
  if (!selectedIds.length || selectedIds.length > SET_PACKAGE_LIMITS.sheets
      || new Set(selectedIds).size !== selectedIds.length) {
    throw new Error(`Choose 1 to ${SET_PACKAGE_LIMITS.sheets} distinct current sheets for the package.`);
  }
  const selected = new Set(selectedIds);
  const sheets = sortSheetsByLabel(register.sheets.filter(sheet => selected.has(sheet.id)));
  if (sheets.length !== selected.size) throw new Error('A selected sheet is no longer in this drawing set.');
  const reviewed = new Map(readiness.rows.map(row => [row.sheetId, row]));
  const sources = new Map();
  for (const sheet of sheets) {
    const row = reviewed.get(sheet.id);
    if (!row || row.status !== 'ready' || row.issues?.length
        || row.filePath !== sheet.filePath || row.page !== sheet.page
        || row.label !== sheet.label || row.title !== sheet.title
        || row.revision !== sheet.revision || row.recordedSha256 !== sheet.sourceSha256
        || row.observedSha256 !== sheet.sourceSha256 || !SOURCE_HASH.test(sheet.sourceSha256 || '')
        || !Number.isSafeInteger(row.pageCount) || sheet.page < 1 || sheet.page > row.pageCount
        || !Number.isSafeInteger(row.byteLength) || row.byteLength < 1) {
      throw new Error(`${sheet.label}: source readiness changed. Check the current sheets again.`);
    }
    const prior = sources.get(sheet.filePath);
    if (prior && (prior.sha256 !== sheet.sourceSha256 || prior.byteLength !== row.byteLength
      || prior.pageCount !== row.pageCount)) {
      throw new Error(`${sheet.label}: registered pages at one PDF path disagree about their source.`);
    }
    if (!prior) sources.set(sheet.filePath, {
      filePath: sheet.filePath, fileName: sourceName(sheet.filePath),
      sha256: sheet.sourceSha256, pageCount: row.pageCount, byteLength: row.byteLength,
    });
  }
  const sourceBytes = [...sources.values()].reduce((sum, source) => sum + source.byteLength, 0);
  if (sourceBytes > SET_PACKAGE_LIMITS.sourceBytes) {
    throw new Error('Selected source PDFs exceed the 128 MiB package preparation limit. Choose fewer sheets.');
  }
  return { register, registerJson: JSON.stringify(register), name: register.name,
    sheets: sheets.map(snapshotSheet), sources: [...sources.values()], sourceBytes };
}

/** Build one selected-pages PDF plus a portable, source-hash manifest in a bounded ZIP. */
export async function buildSetPackage(plan, readSource) {
  assertPlanCurrent(plan);
  if (typeof readSource !== 'function') throw new Error('A PDF source reader is required.');
  let readBytes = 0;
  const sources = new Map(plan.sources.map(source => [source.filePath, source]));
  const pdf = await buildCurrentSetPdf({ version: 1, name: plan.name,
    sheets: plan.sheets.map(sheet => ({ ...sheet, history: [], sourceAliases: [] })) }, async path => {
    const source = sources.get(path);
    const bytes = await readSource(path);
    if (!source || !bytes?.length) {
      throw new Error(`${source?.fileName || 'PDF source'} changed since readiness review. Check current sheets again.`);
    }
    readBytes += bytes.length;
    if (readBytes > SET_PACKAGE_LIMITS.sourceBytes) {
      throw new Error('Selected source PDFs exceed the 128 MiB package preparation limit.');
    }
    return bytes;
  });
  assertPlanCurrent(plan);
  if (pdf.length > SET_PACKAGE_LIMITS.pdfBytes) {
    throw new Error('Selected pages exceed the 96 MiB package PDF limit. Choose fewer sheets.');
  }
  const sourceIds = new Map(plan.sources.map((source, index) => [source.filePath, `source-${index + 1}`]));
  const manifest = {
    format: 'oculith-drawing-set-package', version: 1, setName: plan.name,
    packagePdf: { file: PACKAGE_PDF, sha256: await fingerprintPdfBytes(pdf), byteLength: pdf.length },
    sources: plan.sources.map(source => ({ id: sourceIds.get(source.filePath),
      fileName: source.fileName, sha256: source.sha256, pageCount: source.pageCount,
      byteLength: source.byteLength })),
    sheets: plan.sheets.map((sheet, index) => ({ id: sheet.id, label: sheet.label,
      title: sheet.title, revision: sheet.revision, sourceId: sourceIds.get(sheet.filePath),
      sourcePage: sheet.page, packagePage: index + 1 })),
  };
  const bytes = zipStore([
    { name: PACKAGE_MANIFEST, data: JSON.stringify(manifest, null, 2) + '\n' },
    { name: PACKAGE_PDF, data: pdf },
  ], new Date(1980, 0, 1));
  if (bytes.length > SET_PACKAGE_LIMITS.archiveBytes) {
    throw new Error('Package exceeds the 100 MiB ZIP limit. Choose fewer sheets.');
  }
  assertPlanCurrent(plan);
  return { bytes, manifest };
}

/** Re-read every unique source immediately before a prepared package is written. */
export async function recheckSetPackageSources(plan, readSource) {
  assertPlanCurrent(plan);
  if (typeof readSource !== 'function') throw new Error('A PDF source reader is required.');
  for (const source of plan.sources) {
    let bytes;
    try { bytes = await readSource(source.filePath); } catch { /* Report as stale below. */ }
    if (!bytes?.length || bytes.length !== source.byteLength
        || await fingerprintPdfBytes(bytes) !== source.sha256) {
      throw new Error(`${source.fileName} changed or became unavailable since package preview. Review the current sheets again.`);
    }
    assertPlanCurrent(plan);
  }
}
