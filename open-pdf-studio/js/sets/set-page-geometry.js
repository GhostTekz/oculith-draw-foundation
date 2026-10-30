import * as pdfjs from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { fingerprintPdfBytes } from './pdf-fingerprint.js';
import { sortSheetsByLabel } from './sheet-register.js';

const BOXES = ['Media', 'Crop', 'Bleed', 'Trim', 'Art'];

function boxOf(page, name) {
  const box = page[`get${name}Box`]();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function differs(first, second) {
  return ['x', 'y', 'width', 'height'].some(key => Math.abs(first[key] - second[key]) > 0.01);
}

/** Read current saved PDFs only. Geometry is exposed only for exact recorded-byte matches. */
export async function buildSetPageGeometryAudit(register, readSource) {
  const sheets = sortSheetsByLabel(register.sheets);
  const rows = new Map(sheets.map(sheet => [sheet.id, {
    sheetId: sheet.id, label: sheet.label, filePath: sheet.filePath,
    page: sheet.page, recordedSha256: sheet.sourceSha256 || null,
  }]));
  const grouped = new Map();
  for (const sheet of sheets) {
    if (!grouped.has(sheet.filePath)) grouped.set(sheet.filePath, []);
    grouped.get(sheet.filePath).push(sheet);
  }

  for (const [path, group] of grouped) {
    let bytes;
    try { bytes = await readSource(path); } catch { /* A missing or inaccessible file is a review result. */ }
    if (!bytes?.length) {
      for (const sheet of group) rows.get(sheet.id).status = 'missing';
      continue;
    }
    let observedSha256;
    try { observedSha256 = await fingerprintPdfBytes(bytes); }
    catch {
      for (const sheet of group) rows.get(sheet.id).status = 'unreadable';
      continue;
    }
    const verified = [];
    for (const sheet of group) {
      const row = rows.get(sheet.id);
      row.observedSha256 = observedSha256;
      row.status = !sheet.sourceSha256 ? 'unverified'
        : sheet.sourceSha256 !== observedSha256 ? 'changed' : 'verified';
      if (row.status === 'verified') verified.push(sheet);
    }
    if (!verified.length) continue;

    let task;
    try {
      const pdf = await PDFDocument.load(bytes);
      // PDF.js applies the effective CropBox, inherited rotation and UserUnit
      // to the displayed viewport. Preserve the source bytes for other readers.
      task = pdfjs.getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, verbosity: 0 });
      const document = await task.promise;
      const geometries = new Map();
      for (const pageNumber of new Set(verified.map(sheet => sheet.page))) {
        if (!Number.isSafeInteger(pageNumber) || pageNumber < 1
          || pageNumber > pdf.getPageCount() || pageNumber > document.numPages) continue;
        const page = pdf.getPage(pageNumber - 1);
        const rendered = await document.getPage(pageNumber);
        const viewport = rendered.getViewport({ scale: 1 });
        const boxes = Object.fromEntries(BOXES.map(name => [name.toLowerCase(), boxOf(page, name)]));
        geometries.set(pageNumber, {
          widthInches: viewport.width / 72,
          heightInches: viewport.height / 72,
          rotation: rendered.rotate,
          boxes,
          differingBoxes: BOXES.slice(1).filter(name => differs(boxes.media, boxes[name.toLowerCase()])),
        });
      }
      for (const sheet of verified) {
        const row = rows.get(sheet.id);
        row.geometry = geometries.get(sheet.page);
        if (!row.geometry) row.status = 'missing-page';
      }
    } catch {
      for (const sheet of verified) rows.get(sheet.id).status = 'unreadable';
    } finally { await task?.destroy(); }
  }
  return { register, rows: sheets.map(sheet => rows.get(sheet.id)) };
}
