import { PDFDocument, rgb } from 'pdf-lib';
import { edition } from '../editions/active.js';
import { createBatchCompareReportModel, createCompareChangeReportModel } from './change-report.js';
import { drawBrandMark } from '../pdf/brand-mark-pdf.js';

// fontkit (about 0.5 MB) loads with the first report, not with the editor.
const loadFontkit = () => import('@pdf-lib/fontkit').then((m) => m.default);

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const BODY_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 60;
const ink = rgb(0.12, 0.16, 0.2);
const muted = rgb(0.38, 0.43, 0.48);
const accent = rgb(0.83, 0.43, 0.17);

function printableText(value, fontFace, fallback) {
  return Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' '), character => {
    const codePoint = character.codePointAt(0);
    if (fontFace.hasGlyphForCodePoint(codePoint)) return character;
    fallback.used = true;
    return `[U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}]`;
  }).join('');
}

function wrapText(font, text, size, width) {
  const lines = [];
  let current = '';
  for (const word of text.split(/(\s+)/u)) {
    if (!word) continue;
    const candidate = current + word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current.trim()) lines.push(current.trimEnd());
    current = '';
    for (const character of word) {
      if (font.widthOfTextAtSize(current + character, size) > width && current) {
        lines.push(current);
        current = '';
      }
      current += character;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.length ? lines : [''];
}

function displayNumber(value) {
  return value === '' ? 'not recorded' : String(value);
}

function createReportLayout(document, font, face) {
  const fallback = { used: false };
  let page;
  let y;
  const pages = [];
  const addPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - MARGIN;
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8, color: accent });
  };
  const ensure = height => { if (y - height < BOTTOM) addPage(); };
  const line = (value, { size = 10, color = ink, gap = 4, indent = 0 } = {}) => {
    const text = printableText(value, face, fallback);
    for (const part of wrapText(font, text, size, BODY_WIDTH - indent)) {
      ensure(size + gap);
      page.drawText(part, { x: MARGIN + indent, y: y - size, font, size, color });
      y -= size + gap;
    }
  };
  const separator = () => {
    ensure(15);
    y -= 7;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.6, color: rgb(0.78, 0.8, 0.82) });
    y -= 8;
  };
  const finish = async () => {
    if (fallback.used) {
      line('Some source characters are shown as [U+XXXX] because the bundled report font cannot render them. The CSV report retains the original text.', { size: 9, color: muted });
    }
    for (const [index, sheet] of pages.entries()) {
      sheet.drawLine({ start: { x: MARGIN, y: 43 }, end: { x: PAGE_WIDTH - MARGIN, y: 43 }, thickness: 0.5, color: rgb(0.78, 0.8, 0.82) });
      const mark = drawBrandMark(sheet, MARGIN, 26, 10);
      sheet.drawText(`${edition.productName} | UNREVIEWED | Page ${index + 1} of ${pages.length}`, {
        x: MARGIN + mark + 5, y: 28, font, size: 8, color: muted,
      });
    }
    return document.save();
  };
  addPage();
  return { line, separator, ensure, finish };
}

export async function buildCompareChangeReportPdf(options, fontBytes) {
  const fontkit = await loadFontkit();
  if (!fontBytes?.byteLength) throw new Error('The bundled report font is unavailable.');
  const report = createCompareChangeReportModel(options);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const face = fontkit.create(fontBytes);
  // PDF.js already bundles this Liberation Sans TTF and its license. Embed
  // the full face so PDF readers can reliably extract the report text.
  const font = await document.embedFont(fontBytes, { subset: false });
  document.setTitle(`${edition.productName} comparison change report`);
  document.setSubject('Unreviewed comparison detection results');
  document.setCreator(edition.productName);
  document.setCreationDate(new Date(report.generatedAt));

  const { line, separator, ensure, finish } = createReportLayout(document, font, face);
  line('COMPARISON CHANGE REPORT', { size: 17, color: ink, gap: 8 });
  line(`Generated (UTC): ${report.generatedAt}`, { size: 9, color: muted, gap: 10 });
  line('UNREVIEWED - Detection results require human verification.', { size: 11, color: accent, gap: 12 });

  line(`Old source - page ${report.oldPage}`, { size: 10, color: muted });
  line(report.oldPath, { size: 10, gap: 9 });
  line(`New source - page ${report.newPage}`, { size: 10, color: muted });
  line(report.newPath, { size: 10, gap: 11 });
  line(`Page pairing: ${report.pairingStatus}${report.confirmedAt ? ` at ${report.confirmedAt}` : ''}`, { size: 10 });
  line(`Alignment: dx ${displayNumber(report.alignment.dx)} display px; dy ${displayNumber(report.alignment.dy)} display px; rotation ${displayNumber(report.alignment.rotation)} deg`, { size: 10, gap: 11 });
  line('Page-view bounds use the top-left of the displayed PDF page at scale 1. Visual regions include compare alignment; these are not raw PDF user-space coordinates.', { size: 9, color: muted, gap: 9 });
  separator();
  line(`Detected changes: ${report.changes.length}`, { size: 13, gap: 9 });
  if (!report.changes.length) {
    line('No changes detected for this page pair. Review state: UNREVIEWED.', { size: 10 });
  }
  for (const change of report.changes) {
    ensure(78);
    line(`Change ${change.number} - ${change.type.toUpperCase()} (${change.source})`, { size: 11, color: accent, gap: 6 });
    line('Review state: UNREVIEWED', { size: 9, color: muted, gap: 5, indent: 12 });
    if (change.description) line(`Description: ${change.description}`, { size: 9, gap: 5, indent: 12 });
    line(`Bounds (${change.coordinateUnit}): x ${displayNumber(change.x)}, y ${displayNumber(change.y)}, width ${displayNumber(change.width)}, height ${displayNumber(change.height)}`, { size: 9, gap: 5, indent: 12 });
    if (change.pageView.frame) line(`Page-view bounds (${change.pageView.frame}): x ${displayNumber(change.pageView.x)}, y ${displayNumber(change.pageView.y)}, width ${displayNumber(change.pageView.width)}, height ${displayNumber(change.pageView.height)}`, { size: 9, gap: 5, indent: 12 });
    if (change.source === 'visual') {
      line(`Detection scale: ${displayNumber(change.detectScale)}; changed pixels: ${displayNumber(change.pixelCount)}`, { size: 9, gap: 6, indent: 12 });
    }
    separator();
  }
  return finish();
}

export async function buildBatchCompareChangeReportPdf(batch, fontBytes, generatedAt) {
  const fontkit = await loadFontkit();
  if (!fontBytes?.byteLength) throw new Error('The bundled report font is unavailable.');
  const report = createBatchCompareReportModel(batch, generatedAt);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const face = fontkit.create(fontBytes);
  const font = await document.embedFont(fontBytes, { subset: false });
  document.setTitle(`${edition.productName} batch comparison report`);
  document.setSubject('Unreviewed batch comparison detection results');
  document.setCreator(edition.productName);
  document.setCreationDate(new Date(report.generatedAt));

  const { line, separator, ensure, finish } = createReportLayout(document, font, face);
  const completed = report.pairs.filter(pair => pair.status === 'completed');
  const failed = report.pairs.filter(pair => pair.status === 'failed');
  const unprocessed = report.pairs.filter(pair => pair.status === 'unprocessed');
  const changeCount = completed.reduce((sum, pair) => sum + pair.report.changes.length, 0);
  line('BATCH COMPARISON REPORT', { size: 17, gap: 8 });
  line(`Generated (UTC): ${report.generatedAt}`, { size: 9, color: muted, gap: 10 });
  line('UNREVIEWED - Detection results require human verification.', { size: 11, color: accent, gap: 12 });
  line('Old source document', { size: 10, color: muted });
  line(report.oldPath, { size: 10, gap: 9 });
  line('New source document', { size: 10, color: muted });
  line(report.newPath, { size: 10, gap: 11 });
  line(`Alignment: dx ${displayNumber(report.pairs[0]?.report.alignment.dx ?? '')} display px; dy ${displayNumber(report.pairs[0]?.report.alignment.dy ?? '')} display px; rotation ${displayNumber(report.pairs[0]?.report.alignment.rotation ?? '')} deg`, { size: 10, gap: 10 });
  line('Page-view bounds use the top-left of the displayed PDF page at scale 1. Visual regions include compare alignment; these are not raw PDF user-space coordinates.', { size: 9, color: muted, gap: 9 });
  line(`Pairs: ${report.pairs.length} total; ${completed.length} completed; ${failed.length} failed; ${unprocessed.length} not processed`, { size: 10 });
  line(`Detected changes in completed pairs: ${changeCount}`, { size: 10, gap: 10 });
  if (report.canceled) line('Batch stopped before every pair completed. Unprocessed pairs have no detection result.', { size: 10, color: accent, gap: 9 });
  separator();

  for (const [index, pair] of report.pairs.entries()) {
    ensure(80);
    const item = pair.report;
    line(`Pair ${index + 1} - old page ${item.oldPage} / new page ${item.newPage}`, { size: 12, color: ink, gap: 7 });
    line(`Page pairing: ${item.pairingStatus}${item.confirmedAt ? ` at ${item.confirmedAt}` : ''}`, { size: 9, color: muted, gap: 6, indent: 12 });
    if (pair.status === 'failed') {
      line('FAILED - Detection did not complete; no zero-change conclusion.', { size: 10, color: rgb(0.67, 0.2, 0.18), gap: 5, indent: 12 });
      line('Review state: UNREVIEWED', { size: 9, color: muted, gap: 5, indent: 12 });
      if (pair.error) line(`Error: ${pair.error}`, { size: 9, gap: 7, indent: 12 });
    } else if (pair.status === 'unprocessed') {
      line('NOT PROCESSED - No detection result. Review state: UNREVIEWED.', { size: 10, color: muted, gap: 8, indent: 12 });
    } else {
      const count = item.changes.length;
      line(`COMPLETED DETECTION - ${count} ${count === 1 ? 'change' : 'changes'} found. Review state: UNREVIEWED.`, { size: 10, color: accent, gap: 7, indent: 12 });
      if (!count) line('No changes detected for this pair.', { size: 9, color: muted, gap: 7, indent: 12 });
      for (const change of item.changes) {
        ensure(76);
        line(`Change ${change.number} - ${change.type.toUpperCase()} (${change.source})`, { size: 10, color: ink, gap: 5, indent: 12 });
        if (change.description) line(`Description: ${change.description}`, { size: 9, gap: 5, indent: 22 });
        line(`Bounds (${change.coordinateUnit}): x ${displayNumber(change.x)}, y ${displayNumber(change.y)}, width ${displayNumber(change.width)}, height ${displayNumber(change.height)}`, { size: 9, gap: 5, indent: 22 });
        if (change.pageView.frame) line(`Page-view bounds (${change.pageView.frame}): x ${displayNumber(change.pageView.x)}, y ${displayNumber(change.pageView.y)}, width ${displayNumber(change.pageView.width)}, height ${displayNumber(change.pageView.height)}`, { size: 9, gap: 5, indent: 22 });
        if (change.source === 'visual') line(`Detection scale: ${displayNumber(change.detectScale)}; changed pixels: ${displayNumber(change.pixelCount)}`, { size: 9, gap: 7, indent: 22 });
      }
    }
    separator();
  }
  return finish();
}
