// Repeated saves of one document that uses the newer savers together: the
// orphan cleanup of fix/ocudraw-save-growth (saver/vervangen-opruimen.js)
// must keep what those savers write beside the markup dictionaries, and the
// file must not grow. Covered: stored Spaces (/OPS_Spaces), Formula columns
// and Custom Captions (catalog + /OPS_CaptionTemplateV1), a dynamic stamp and
// a user stamp with an image, capture photos (/Names /EmbeddedFiles) and a
// File Attachment, a user line style, a count symbol, a slip-sheet carried
// markup (carriedFrom), a Set Batch Link /GoToR link and measurement
// Subjects. Real saver, real pdf.js reopen, as the app does between saves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { loadFileAttachmentContents } = await import('./loader/capture-load.js');
const { recalculateAllMeasurements } = await import('../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { makePhoto, makeAttachedFile, FILE_ATTACHMENT_ICON } = await import('../annotations/capture.js');
const { exifJpeg, tinyPng } = await import('../annotations/capture.testhulp.mjs');
const { CONTRACTOR_STAMPS, instantiateStampTemplate, stampDesignText } = await import('../annotations/stamp-templates.js');
const { stampDesignSize } = await import('../annotations/stamp-layout.js');
const { listCountSymbols } = await import('../symbols/count-symbols.js');
const { readSpaces } = await import('../spaces/pdf-spaces.js');
const { takeOverSpaces, collectSpaces } = await import('../spaces/model.js');
const { readFormulaCaptions } = await import('./formula-captions-pdf.js');

const FT = { pixelsPerUnit: 1, unit: 'ft' };
const SAVES = 4;
const FIELDS = { now: new Date(2026, 9, 14, 9, 5), user: 'Reviewer', page: 1, pageLabel: 'A-101',
  fileName: 'C:/jobs/Tower/A-101.pdf' };
const USER_STYLE = { id: 'user-fibre', name: 'Fibre duct', scaleWithWidth: false,
  lines: [{ offset: -2, dash: [], width: 1 }, { offset: 2, dash: [6, -3], width: 1 }],
  marks: [{ kind: 'text', text: 'FO', size: 6, interval: 60, start: null, gap: 2, offset: 0 }] };
const FORMULAS = { v: 1, columns: [
  { name: 'Cost', expression: 'Area × {Cost/sf}', unit: '$', decimals: 2, lengthUnit: '' }],
captions: { measureArea: '{Subject} {Area} {Cost}' } };
const COST = { version: 1, name: 'Cost/sf' };
const SPACES = [{ id: 'office', page: 1, name: 'Office', color: '#27ae60', parentId: null,
  points: [{ x: 20, y: 20 }, { x: 560, y: 20 }, { x: 560, y: 760 }, { x: 20, y: 760 }] }];

function openDocument(annotations, extra = {}) {
  state.documents = [{ id: `growth-features-${Math.random()}`, filePath: 'C:/set/arch/A.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations, measureScale: FT, pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [], undoStack: [], redoStack: [], savedUndoStackLength: 0,
    selectedAnnotations: [], markupNumberColumn: COST, ...extra }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function save(bytes, annotations, extra) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_p, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_p, data) => { saved = data; return true; },
  } };
  openDocument(annotations, extra);
  recalculateAllMeasurements();
  assert.equal(await savePDF('C:/set/arch/A.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return new Uint8Array(saved);
}

async function reopen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  try {
    const lib = await PDFDocument.load(bytes.slice());
    const page = await reader.getPage(1);
    const colors = await extractAnnotationColors(1, lib);
    const annots = await page.getAnnotations();
    await loadFileAttachmentContents(annots, reader);
    const models = [];
    for (const a of annots) {
      const m = await convertPdfAnnotation(a, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (m && !m.__textboxLeader) models.push(m);
    }
    const doc = { annotations: models, spaces: [] };
    takeOverSpaces(doc, readSpaces(lib));
    return { models, spaces: doc.spaces, formulaCaptions: readFormulaCaptions(lib) };
  } finally {
    await task.destroy();
  }
}

function logoDataUrl() {
  const c = createCanvas(8, 4);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 8, 4);
  return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`;
}

async function buildModels() {
  const base = { page: 1, author: 'Reviewer' };
  const stampOf = (design, x, y) => {
    const size = stampDesignSize(design);
    return createAnnotation({ ...base, type: 'stamp', x, y, width: size.width, height: size.height, rotation: 0,
      opacity: 1, stampName: design.name, stampText: stampDesignText(design), stampTemplateId: design.templateId,
      stampDesign: design, stampColor: design.color, color: design.color });
  };
  const dynamic = stampOf(instantiateStampTemplate(CONTRACTOR_STAMPS.find(t => t.id === 'ct:approvedAsNoted'), FIELDS), 40, 40);
  const logo = stampOf(instantiateStampTemplate({ version: 1, id: 'user:logo', name: 'Site Check', color: '#334455',
    border: 'rectangle', dateFormat: 'iso', status: 'OK', image: { dataUrl: logoDataUrl(), width: 8, height: 4 },
    lines: [{ text: 'SITE CHECK {status}', size: 14, bold: true }] }, FIELDS), 300, 40);
  const cloud = createAnnotation({ ...base, type: 'cloud', x: 120, y: 150, width: 200, height: 120,
    color: '#ff0000', strokeColor: '#ff0000', lineWidth: 2, subject: 'Leak at riser' });
  cloud.capturePhotos = [
    makePhoto(exifJpeg('2026:10:01 09:15:30'), { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', width: 4032,
      height: 3024, date: '2026-10-01T09:15:30' }),
    makePhoto(await tinyPng(), { name: 'sketch.png', mimeType: 'image/png', width: 2, height: 2 }),
  ];
  const pin = createAnnotation({ ...base, type: 'comment', x: 400, y: 300, width: 24, height: 24,
    icon: FILE_ATTACHMENT_ICON, color: '#2563EB', text: '' });
  pin.attachedFile = makeAttachedFile(new TextEncoder().encode('%PDF-1.4 spec sheet'), 'Valve spec.pdf');
  const styled = createAnnotation({ ...base, type: 'line', startX: 50, startY: 600, endX: 450, endY: 650,
    strokeColor: '#0055aa', lineWidth: 1, lineStyleId: USER_STYLE.id });
  const symbol = listCountSymbols()[3];
  const count = createAnnotation({ ...base, type: 'count', x: 500, y: 500, categoryId: 'fixtures', number: 1,
    markerStyle: 'symbol', symbolId: symbol.id, symbolSize: 30, color: '#1d4ed8', opacity: 1 });
  const carried = createAnnotation({ ...base, type: 'box', x: 80, y: 420, width: 80, height: 40,
    color: '#e11d48', strokeColor: '#e11d48', subject: 'Carried',
    carriedFrom: { sheet: 'A-101', revision: 'A', file: 'C:/set/old/A.pdf', page: 1, markupId: 'old-1' } });
  const area = createAnnotation({ ...base, type: 'measureArea', strokeColor: '#ff0000', subject: 'Slab A',
    markupNumberValue: 12.5, points: [{ x: 300, y: 400 }, { x: 320, y: 400 }, { x: 320, y: 410 }, { x: 300, y: 410 }] });
  area.captionTemplate = '{Cost} for {Subject}';
  const remote = createAnnotation({ ...base, type: 'hyperlink', x: 60, y: 700, width: 60, height: 14,
    linkFile: '../struct/S.pdf', linkPage: 2, color: '#e11d48', lineWidth: 1, linkBorder: 1, batchLink: true });
  return [dynamic, logo, cloud, pin, styled, count, carried, area, remote];
}

// Every indirect object reachable from the trailer.
function orphans(doc) {
  const ctx = doc.context;
  const seen = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
  while (stack.length) {
    let o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      o = ctx.lookup(o);
    }
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v);
    else if (o instanceof PDFArray) stack.push(...o.asArray());
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stack.push(v);
  }
  return ctx.enumerateIndirectObjects().filter(([ref]) => !seen.has(ref.tag)).length;
}

async function inspect(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const annotsArr = doc.getPages()[0].node.lookup(PDFName.of('Annots'));
  const dicts = annotsArr instanceof PDFArray ? annotsArr.asArray().map(r => ctx.lookup(r)) : [];
  const names = doc.catalog.lookup(PDFName.of('Names'))?.lookup(PDFName.of('EmbeddedFiles'))?.lookup(PDFName.of('Names'));
  const goToR = dicts.filter(d => d.lookup(PDFName.of('A'))?.get?.(PDFName.of('S'))?.toString() === '/GoToR');
  return {
    size: bytes.length,
    objects: ctx.enumerateIndirectObjects().length,
    orphans: orphans(doc),
    annots: dicts.length,
    embedded: names instanceof PDFArray ? names.size() / 2 : 0,
    goToR: goToR.length,
    spaces: doc.getPages()[0].node.lookup(PDFName.of('OPS_Spaces'))?.size?.() ?? 0,
  };
}

// What every round must reopen, independent of ids and appearances.
function features(round) {
  const { models, spaces, formulaCaptions } = round;
  const by = (type) => models.filter(m => m.type === type);
  return {
    stamps: by('stamp').map(m => [m.stampTemplateId, m.stampDesign?.lines?.map(l => l.text).join('|'),
      !!m.stampDesign?.image?.dataUrl, m.subject || '']).sort(),
    photos: models.flatMap(m => (m.capturePhotos || []).map(p => `${p.name} ${p.mimeType} ${p.dataUrl?.length}`)).sort(),
    attachment: models.filter(m => m.attachedFile).map(m => `${m.attachedFile.name} ${m.attachedFile.dataUrl?.length}`),
    lineStyle: models.filter(m => m.lineStyleId).map(m => `${m.type} ${m.lineStyleId} ${m.lineStyleDef?.name}`),
    count: by('count').map(m => `${m.symbolId} ${m.markerStyle} ${m.symbolSize}`),
    carried: models.filter(m => m.carriedFrom).map(m => `${m.carriedFrom.file} ${m.carriedFrom.revision} ${m.carriedFrom.markupId}`),
    caption: by('measureArea').map(m => `${m.subject} ${m.captionTemplate}`),
    remote: by('hyperlink').map(m => `${m.linkFile} ${m.linkPage} ${!!m.batchLink}`),
    spaces: collectSpaces({ annotations: models, spaces }).map(s => `${s.name} ${s.color}`),
    formulas: JSON.stringify(formulaCaptions),
  };
}

test(`${SAVES} saves of a document using spaces, captions, stamps, capture, line styles, counts, carried markups and remote links keep everything and do not grow`, async () => {
  state.preferences.lineStyles = [USER_STYLE];
  try {
    const src = await PDFDocument.create();
    src.addPage([595, 842]);
    const source = await src.save();
    const sourceOrphans = (await inspect(source)).orphans;
    let bytes = await save(source, await buildModels(), { spaces: SPACES, formulaCaptions: FORMULAS });
    const rounds = [await inspect(bytes)];
    let round = await reopen(bytes);
    // The embedded copy of the user style must be enough from here on.
    state.preferences.lineStyles = [];
    const want = features(round);
    assert.equal(want.stamps.length, 2);
    assert.ok(want.stamps.some(s => s[0] === 'user:logo' && s[2]), 'the user stamp keeps its image');
    assert.equal(want.photos.length, 2);
    assert.equal(want.attachment.length, 1);
    assert.deepEqual(want.lineStyle, ['line user-fibre Fibre duct']);
    assert.equal(want.count.length, 1);
    assert.deepEqual(want.carried, ['C:/set/old/A.pdf A old-1']);
    assert.deepEqual(want.caption, ['Slab A {Cost} for {Subject}']);
    assert.deepEqual(want.remote, ['../struct/S.pdf 2 true']);
    assert.deepEqual(want.spaces, ['Office #27ae60']);
    assert.equal(want.formulas, JSON.stringify(FORMULAS));
    for (let i = 1; i < SAVES; i++) {
      bytes = await save(bytes, round.models, { spaces: round.spaces, _spacesRead: true,
        formulaCaptions: round.formulaCaptions });
      rounds.push(await inspect(bytes));
      round = await reopen(bytes);
      assert.deepEqual(features(round), want, `save ${i + 1}: every feature reopens the same`);
    }
    console.log('sizes', rounds.map(r => r.size).join(' '), 'objects', rounds.map(r => r.objects).join(' '));
    for (const [i, r] of rounds.entries()) {
      assert.equal(r.orphans, sourceOrphans, `save ${i + 1}: no unreferenced objects`);
      assert.equal(r.annots, rounds[0].annots, `save ${i + 1}: same annotations`);
      assert.equal(r.embedded, 2, `save ${i + 1}: the two photos are listed as embedded files`);
      assert.equal(r.goToR, 1, `save ${i + 1}: the /GoToR link stays`);
      assert.equal(r.spaces, 1, `save ${i + 1}: the stored space stays`);
      if (i < 1) continue;
      assert.equal(r.objects, rounds[1].objects, `save ${i + 1}: object count stable`);
      assert.ok(Math.abs(r.size - rounds[1].size) <= 64, `save ${i + 1}: ${r.size} bytes vs ${rounds[1].size}`);
    }
  } finally {
    state.preferences.lineStyles = [];
  }
});
