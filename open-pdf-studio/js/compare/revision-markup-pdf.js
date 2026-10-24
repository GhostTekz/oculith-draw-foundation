import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { pdfTextString } from '../pdf/saver/pdf-text.js';
import { comparePdfContentIdentity } from './compare-snapshots.js';
import { cleanRevisionRing, pageViewOutlineToPdfRing, visualChangeToPdfReviewRegion } from './revision-geometry.js';

function bytes(value) {
  return value instanceof Uint8Array && value.byteLength > 0;
}

/** Compare the exact parsed, cached, and current on-disk bytes for both revisions. */
export async function verifyComparisonSourceBytes({ oldPath, newPath, oldDoc, newDoc, getCachedBytes, readCurrentBytes }) {
  if (!oldPath || !newPath || typeof oldDoc?.getData !== 'function' || typeof newDoc?.getData !== 'function'
      || typeof getCachedBytes !== 'function' || typeof readCurrentBytes !== 'function') {
    throw new Error('Both opened comparison documents and their source paths are required.');
  }
  const [loadedOld, loadedNew] = await Promise.all([oldDoc.getData(), newDoc.getData()]);
  const cachedOld = getCachedBytes(oldPath);
  const cachedNew = getCachedBytes(newPath);
  if (![loadedOld, loadedNew, cachedOld, cachedNew].every(bytes)) {
    throw new Error('One of the opened comparison PDFs is no longer available. Reload both PDFs.');
  }
  const [diskOld, diskNew] = await Promise.all([readCurrentBytes(oldPath), readCurrentBytes(newPath)]);
  if (![diskOld, diskNew].every(bytes)) throw new Error('Could not read both current source PDFs.');
  const [loaded, cached, disk] = await Promise.all([
    comparePdfContentIdentity(loadedOld, loadedNew),
    comparePdfContentIdentity(cachedOld, cachedNew),
    comparePdfContentIdentity(diskOld, diskNew),
  ]);
  if (loaded.old !== cached.old || loaded.new !== cached.new
      || loaded.old !== disk.old || loaded.new !== disk.new) {
    throw new Error('A source PDF changed since comparison. Reload both PDFs and detect changes again.');
  }
  return { oldBytes: loadedOld.slice(), newBytes: loadedNew.slice(), identity: loaded };
}

export function suggestedRevisionMarkupName(newPath, newPage, changeNumber) {
  const base = String(newPath || 'revised').split(/[\\/]/u).pop()
    .replace(/\.pdf$/iu, '').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 48) || 'revised';
  return `${base}-p${newPage}-change-${changeNumber}-review.pdf`;
}

export function suggestedRevisionMarkupsName(newPath, newPage) {
  return suggestedRevisionMarkupName(newPath, newPage, 'all').replace('-change-all-', '-changes-');
}

// Save dialogs may return a different slash/case spelling for the same source
// file, especially on Windows. Refuse obvious aliases before writing a copy.
export function outputPathMatchesSource(outputPath, ...sourcePaths) {
  const normalized = value => {
    const path = String(value || '').replaceAll('\\', '/');
    const parts = [];
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/').toLocaleLowerCase('en-US');
  };
  const output = normalized(outputPath);
  return !!output && sourcePaths.some(path => normalized(path) === output);
}

function provenanceText(region, id) {
  const align = region.alignment || {};
  return [
    'UNREVIEWED OcuDraw comparison difference',
    `Reference: ${id}`,
    `Change: ${region.changeNumber} (${region.changeType}, visual)`,
    `Old source: ${region.oldPath} — page ${region.oldPage}`,
    `New source: ${region.targetPath} — page ${region.targetPage}`,
    `Pairing: ${region.pairingStatus}${region.confirmedAt ? ` at ${region.confirmedAt}` : ''}`,
    `Alignment: dx ${align.dx ?? 0} display px; dy ${align.dy ?? 0} display px; rotation ${align.rotation ?? 0} deg`,
    region.clippedToPage ? 'Region clipped to visible new page.' : 'Region within visible new page.',
    'Review state: UNREVIEWED. Verify against both source drawings.',
  ].join('\n');
}

/**
 * Add distinct editable PDF Square annotations to a COPY of the new revision.
 * Reopen the output and verify every page, bound, and provenance entry.
 * Source bytes must already have passed verifyComparisonSourceBytes.
 */
export async function buildRevisionMarkupsPdf({ newBytes, report, changes, pdfPage, targetPath, markupIds }) {
  if (!bytes(newBytes)) throw new Error('The new revision PDF bytes are required.');
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('At least one visual change is required.');
  if (markupIds && (!Array.isArray(markupIds) || markupIds.length !== changes.length)) {
    throw new Error('One markup reference is required per change.');
  }
  const entries = changes.map((change, index) => {
    const region = visualChangeToPdfReviewRegion({ report, change, pdfPage, targetPath });
    const id = markupIds?.[index] || globalThis.crypto?.randomUUID?.();
    if (!id || !/^[A-Za-z0-9._-]{1,128}$/u.test(id)) throw new Error('A safe markup reference is required.');
    return { region, markupId: id, content: provenanceText(region, id) };
  });
  if (new Set(entries.map(entry => entry.markupId)).size !== entries.length) {
    throw new Error('Each revision markup needs a distinct reference.');
  }
  const pdf = await PDFDocument.load(newBytes);
  if (report.newPage > pdf.getPageCount()) throw new Error('The new PDF has no selected target page.');
  const page = pdf.getPage(report.newPage - 1);
  const context = pdf.context;
  const existingValue = page.node.get(PDFName.of('Annots'));
  const existing = existingValue ? context.lookup(existingValue) : null;
  if (existing && !(existing instanceof PDFArray)) throw new Error('The target page has an invalid annotation list.');
  const existingRefs = existing ? [...existing.asArray()] : [];
  const addedRefs = entries.map(({ region, markupId, content }) => {
    const color = region.changeType === 'added' ? [0.09, 0.64, 0.29]
      : region.changeType === 'removed' ? [0.85, 0.15, 0.15] : [0.79, 0.54, 0.03];
    const annotation = context.obj({
      Type: 'Annot', Subtype: 'Square', Rect: region.pdfRect, C: color,
      BS: context.obj({ W: 2, S: PDFName.of('S') }),
      T: pdfTextString('OcuDraw comparison'),
      Subj: pdfTextString('Unreviewed revision difference'),
      Contents: pdfTextString(content), NM: pdfTextString(markupId),
      F: 4, // printable; deliberately editable (no Locked or ReadOnly flags)
    });
    // A standard Square can be drawn by a reader without /AP, but an explicit
    // vector Form XObject keeps the outline visible in readers that do not
    // synthesize annotation appearances. Coordinates are local to /Rect; the
    // page's CropBox and /Rotate are applied by the PDF viewer.
    const width = region.pdfRect[2] - region.pdfRect[0];
    const height = region.pdfRect[3] - region.pdfRect[1];
    const stroke = Math.min(2, width / 3, height / 3);
    const inset = stroke / 2;
    const appearance = context.stream([
      'q', `${color.join(' ')} RG`, `${stroke} w`,
      `${inset} ${inset} ${width - stroke} ${height - stroke} re S`, 'Q',
    ].join('\n'), {
      Type: 'XObject', Subtype: 'Form', FormType: 1,
      BBox: [0, 0, width, height], Matrix: [1, 0, 0, 1, 0, 0],
      Resources: context.obj({}),
    });
    annotation.set(PDFName.of('AP'), context.obj({ N: context.register(appearance) }));
    return context.register(annotation);
  });
  page.node.set(PDFName.of('Annots'), context.obj([...existingRefs, ...addedRefs]));
  const output = await pdf.save();

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: output.slice(), useSystemFonts: false, isEvalSupported: false });
  try {
    const reopened = await task.promise;
    const reopenedPage = await reopened.getPage(report.newPage);
    const annotations = await reopenedPage.getAnnotations();
    for (const { region, content } of entries) {
      const annotationFound = annotations.find(item =>
        item.subtype === 'Square' && item.contentsObj?.str === content);
      if (!annotationFound || annotationFound.annotationFlags & (64 | 128)
          || region.pdfRect.some((value, index) => Math.abs(value - annotationFound.rect[index]) > 0.01)) {
        throw new Error('A revision markup did not reopen with its expected bounds and provenance.');
      }
    }
  } finally {
    await task.destroy();
  }
  return { bytes: output, entries };
}

export async function buildRevisionMarkupPdf({ change, markupId, ...options }) {
  const result = await buildRevisionMarkupsPdf({ ...options, changes: [change], markupIds: markupId ? [markupId] : undefined });
  return { bytes: result.bytes, ...result.entries[0] };
}

function polygonBounds(ring) {
  const xs = ring.map(point => point[0]);
  const ys = ring.map(point => point[1]);
  const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (!(rect[2] > rect[0] && rect[3] > rect[1])) throw new Error('The mapped PDF region has no area.');
  return rect;
}

/**
 * Add one editable PDF Polygon annotation to a COPY of the new revision.
 * `points` is one scale-one page-view outline. geos_simplify runs once when
 * invoke is present; a missing invoke still writes the mapped ring.
 * This does not change the Square export.
 */
export async function buildRevisionPolygonPdf({ newBytes, report, change, pdfPage, targetPath, markupId, points, invoke }) {
  if (!bytes(newBytes)) throw new Error('The new revision PDF bytes are required.');
  const review = visualChangeToPdfReviewRegion({ report, change, pdfPage, targetPath });
  const mapped = pageViewOutlineToPdfRing(pdfPage, points);
  const ring = await cleanRevisionRing(mapped.ring, invoke);
  if (!Array.isArray(ring) || ring.length < 3) throw new Error('A PDF polygon ring is required.');
  const id = markupId || globalThis.crypto?.randomUUID?.();
  if (!id || !/^[A-Za-z0-9._-]{1,128}$/u.test(id)) throw new Error('A safe markup reference is required.');
  const pdfRect = polygonBounds(ring);
  const region = { ...review, pdfRect, pdfRing: ring, clippedToPage: mapped.clippedToPage };
  const content = provenanceText(region, id);
  const pdf = await PDFDocument.load(newBytes);
  if (report.newPage > pdf.getPageCount()) throw new Error('The new PDF has no selected target page.');
  const page = pdf.getPage(report.newPage - 1);
  const context = pdf.context;
  const existingValue = page.node.get(PDFName.of('Annots'));
  const existing = existingValue ? context.lookup(existingValue) : null;
  if (existing && !(existing instanceof PDFArray)) throw new Error('The target page has an invalid annotation list.');
  const existingRefs = existing ? [...existing.asArray()] : [];
  const color = region.changeType === 'added' ? [0.09, 0.64, 0.29]
    : region.changeType === 'removed' ? [0.85, 0.15, 0.15] : [0.79, 0.54, 0.03];
  const vertices = [];
  for (const point of ring) vertices.push(point[0], point[1]);
  const annotation = context.obj({
    Type: 'Annot', Subtype: 'Polygon', Rect: pdfRect, Vertices: vertices, C: color,
    BS: context.obj({ W: 2, S: PDFName.of('S') }),
    T: pdfTextString('OcuDraw comparison'),
    Subj: pdfTextString('Unreviewed revision difference'),
    Contents: pdfTextString(content), NM: pdfTextString(id),
    F: 4, // printable; deliberately editable (no Locked or ReadOnly flags)
  });
  page.node.set(PDFName.of('Annots'), context.obj([...existingRefs, context.register(annotation)]));
  const output = await pdf.save();

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: output.slice(), useSystemFonts: false, isEvalSupported: false });
  try {
    const reopened = await task.promise;
    const reopenedPage = await reopened.getPage(report.newPage);
    const annotations = await reopenedPage.getAnnotations();
    const annotationFound = annotations.find(item =>
      item.subtype === 'Polygon' && item.contentsObj?.str === content);
    const opened = annotationFound?.vertices;
    const mismatch = !annotationFound || annotationFound.annotationFlags & (64 | 128)
      || !opened || opened.length !== vertices.length
      || vertices.some((value, index) => Math.abs(value - opened[index]) > 0.01);
    if (mismatch) throw new Error('A revision polygon did not reopen with its expected vertices and provenance.');
  } finally {
    await task.destroy();
  }
  return { bytes: output, region, markupId: id, content };
}
