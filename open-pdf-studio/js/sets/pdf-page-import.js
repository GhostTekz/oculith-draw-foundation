import * as pdfjsLib from 'pdfjs-dist';
import { addSheet, relinkSheet } from './sheet-register.js';
import { fingerprintPdfBytes } from './pdf-fingerprint.js';

export { fingerprintPdfBytes };

function clean(value) {
  return String(value ?? '').trim();
}

function basename(path) {
  return clean(path).replaceAll('\\', '/').split('/').pop().replace(/\.pdf$/i, '') || 'Sheet';
}

function labelForPage(path, page, count, pageLabel) {
  const label = clean(pageLabel);
  if (label && !/^\d+$/.test(label)) return label;
  const name = basename(path);
  return count === 1 ? name : `${name}-${label || page}`;
}

function uniqueLabel(register, preferred) {
  const used = new Set(register.sheets.map(sheet => sheet.label.toLocaleLowerCase()));
  if (!used.has(preferred.toLocaleLowerCase())) return preferred;
  let suffix = 2;
  while (used.has(`${preferred}-${suffix}`.toLocaleLowerCase())) suffix++;
  return `${preferred}-${suffix}`;
}

function samePage(item, filePath, page) {
  return clean(item.filePath).toLocaleLowerCase() === clean(filePath).toLocaleLowerCase() && item.page === page;
}

function sourceRecords(sheet) {
  return [sheet, ...sheet.history, ...(sheet.sourceAliases || [])];
}

export function assertRecordedContentUnchanged(register, filePath, fingerprint) {
  if (!fingerprint) return;
  const current = register.sheets.filter(sheet => clean(sheet.filePath).toLocaleLowerCase() === clean(filePath).toLocaleLowerCase());
  const records = current.length ? current : register.sheets.flatMap(sheet =>
    [...sheet.history, ...(sheet.sourceAliases || [])].filter(item =>
      clean(item.filePath).toLocaleLowerCase() === clean(filePath).toLocaleLowerCase()));
  if (records.some(item => item.sourceSha256 && item.sourceSha256 !== fingerprint)) {
    throw new Error('This PDF changed at a registered path. Use Choose revised PDF to record a new revision, with a separate copy of the earlier PDF if it must remain available.');
  }
}

function recordFingerprint(register, sheetId, filePath, page, fingerprint) {
  if (!fingerprint) return register;
  let changed = false;
  const sheets = register.sheets.map(sheet => {
    if (sheet.id !== sheetId) return sheet;
    const update = item => {
      if (!samePage(item, filePath, page) || item.sourceSha256) return item;
      changed = true;
      return { ...item, sourceSha256: fingerprint };
    };
    const current = update(sheet);
    return { ...current, history: sheet.history.map(update), sourceAliases: (sheet.sourceAliases || []).map(update) };
  });
  return changed ? { ...register, sheets } : register;
}

export function matchingCurrentPdfSource(register, fingerprint, pageCount) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(pageCount) || pageCount < 1) return null;
  const sheets = [];
  for (let page = 1; page <= pageCount; page++) {
    const matches = register.sheets.filter(sheet => sheet.page === page && sheet.sourceSha256 === fingerprint);
    if (matches.length > 1) return null;
    if (matches.length === 1) sheets.push(matches[0]);
  }
  if (!sheets.length || new Set(sheets.map(sheet => sheet.id)).size !== sheets.length) return null;
  return sheets;
}

export function relinkMatchingPdfSource(register, sheets, filePath, fingerprint) {
  let next = register;
  for (const sheet of sheets) next = relinkSheet(next, sheet.id, filePath, sheet.page, fingerprint);
  return next;
}

export function addPdfPages(register, filePath, pageCount, pageLabels = null, fingerprint) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('The PDF has no pages.');
  if (fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid PDF fingerprint.');
  assertRecordedContentUnchanged(register, filePath, fingerprint);
  let next = register;
  const added = [];
  let alreadyPresent = 0;
  let contentMatches = 0;
  for (let page = 1; page <= pageCount; page++) {
    const existing = next.sheets.find(sheet => sourceRecords(sheet).some(item => samePage(item, filePath, page)));
    if (existing) {
      next = recordFingerprint(next, existing.id, filePath, page, fingerprint);
      alreadyPresent++;
      continue;
    }
    const fingerprintMatches = fingerprint
      ? next.sheets.filter(sheet => sourceRecords(sheet).some(item => item.page === page && item.sourceSha256 === fingerprint))
      : [];
    if (fingerprintMatches.length === 1) {
      alreadyPresent++;
      contentMatches++;
      continue;
    }
    const preferred = labelForPage(filePath, page, pageCount, pageLabels?.[page - 1]);
    const result = addSheet(next, { filePath, page, label: uniqueLabel(next, preferred), sourceSha256: fingerprint });
    next = result.register;
    added.push(result.sheet);
  }
  return { register: next, added, alreadyPresent, contentMatches };
}

export async function inspectPdfPages(bytes) {
  if (!bytes?.length) throw new Error('The PDF is empty or could not be read.');
  // PDF.js transfers its input buffer to a worker; preserve the browser file cache.
  const task = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    cMapUrl: '/pdfjs/web/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/',
    wasmUrl: '/pdfjs/web/wasm/', isEvalSupported: false, verbosity: 0,
  });
  try {
    const document = await task.promise;
    let pageLabels = null;
    try { pageLabels = await document.getPageLabels(); } catch { /* A broken label tree should not hide valid pages. */ }
    return { pageCount: document.numPages, pageLabels };
  } finally {
    await task.destroy();
  }
}
