// Dynamic Fill on real PDF bytes: a vector floor plan (pdf-lib) is read by
// the snap extractor (PDF.js operator list → annotation space, so CropBox and
// /Rotate apply), a room is filled, the Area / Perimeter / Polygon markups are
// created at 1/4" = 1'-0", saved by the real saver and reopened.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { PDFDocument } = await import('pdf-lib');
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { nettoVlakOppervlak } = await import('../annotations/vlak-ringen.js');
const { extractPageGeometry } = await import('../tools/pdf-snap-extractor.js');
const { findFillRegion } = await import('../tools/dynamic-fill/fill-region.js');
const { createDynamicFillAnnotations } = await import('../tools/dynamic-fill/outputs.js');
const { floorPlanPdf, ROOM_A, PT_PER_FT, EXPECTED_FT2, HATCH_WIDTH } = await import('../tools/dynamic-fill/floor-plan.testhulp.mjs');
const { boundarySegments } = await import('../tools/dynamic-fill/fill-region.js');

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const QUARTER_INCH = { pixelsPerUnit: PT_PER_FT, unit: 'ft' }; // 1/4" = 1'-0"
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} != ${b}`);

function openDocument(pdfDoc, measureScale, annotations = []) {
  state.documents = [{ id: `df-rt-${Math.random()}`, filePath: null, pdfDoc, currentPage: 1, annotations,
    measureScale, pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [] }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function withPdf(bytes, fn) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try { return await fn(doc); } finally { await task.destroy(); }
}

async function save(bytes, annotations) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_p, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_p, data) => { saved = data; return true; },
  } };
  const doc = openDocument({}, QUARTER_INCH, annotations);
  doc.filePath = 'C:/df/input.pdf';
  assert.equal(await savePDF('C:/df/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

async function reopen(bytes) {
  return withPdf(bytes, async (doc) => {
    const page = await doc.getPage(1);
    const colors = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
    const models = [];
    for (const a of await page.getAnnotations()) {
      const m = await convertPdfAnnotation(a, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (m) models.push(m);
    }
    return models;
  });
}

/** Fill room A on the PDF's own page geometry; returns the region. */
async function fillRoomA(bytes) {
  return withPdf(bytes, async (doc) => {
    openDocument(doc, QUARTER_INCH);
    const geometry = await extractPageGeometry(1, { document: state.documents[0] });
    assert.ok(geometry.edges.length >= 20, `vector edges read: ${geometry.edges.length}`);
    const page = await doc.getPage(1);
    const [x, y] = page.getViewport({ scale: 1 }).convertToViewportPoint(ROOM_A.x + 60, ROOM_A.y + 200);
    const region = findFillRegion(geometry.edges, { x, y }, { gap: 60 });
    assert.equal(region.status, 'ok');
    return region;
  });
}

for (const [name, opts] of [
  ['an unrotated sheet', {}],
  ['a sheet with /Rotate 90 and an offset CropBox', { rotate: 90, cropBox: [20, 30, 740, 560] }],
]) {
  test(`Dynamic Fill Area, Perimeter, Volume and Polygon save and reopen on ${name}`, async () => {
    const source = await floorPlanPdf(opts);
    const region = await fillRoomA(source);
    near(region.area / PT_PER_FT ** 2, EXPECTED_FT2.A, 1e-6, 'filled ft²');
    assert.equal(region.holes.length, 1, 'the column is a cut-out');

    openDocument({}, QUARTER_INCH);
    state.preferences.measureVolumeDepth = 9;
    state.preferences.measureVolumeDepthUnit = 'ft';
    const [area, perimeter, volume, polygon] = createDynamicFillAnnotations([region], ['polygon', 'volume', 'perimeter', 'area'], 1);
    state.preferences.measureVolumeDepth = undefined;
    assert.equal(volume.measureKind, 'volume');
    near(volume.measureVolumeValue, EXPECTED_FT2.A * 9, 1e-6, 'ft³');
    assert.equal(area.type, 'measureArea');
    near(area.measureValue, EXPECTED_FT2.A, 1e-6);
    assert.equal(area.measureUnit, 'ft²');
    assert.equal(perimeter.type, 'measurePerimeter');
    near(perimeter.measureValue, 70, 1e-6, 'perimeter ft');
    assert.equal(polygon.type, 'filledArea');

    const saved = await save(source, [area, perimeter, volume, polygon]);
    const models = await reopen(saved);
    const reVolume = models.find((m) => m.type === 'measureArea' && m.measureKind === 'volume');
    assert.ok(reVolume, 'the Volume reopens');
    near(reVolume.measureVolumeValue, EXPECTED_FT2.A * 9, 0.05, 'reopened ft³');
    const reArea = models.find((m) => m.type === 'measureArea' && m.measureKind !== 'volume');
    const rePerim = models.find((m) => m.type === 'measurePerimeter');
    const rePoly = models.find((m) => m.type === 'filledArea');
    assert.ok(reArea && rePerim && rePoly, `reopened: ${models.map((m) => m.type).join(', ')}`);
    assert.equal(reArea.holes?.length, 1, 'the cut-out survives');
    near(nettoVlakOppervlak(reArea.points, reArea.holes) / PT_PER_FT ** 2, EXPECTED_FT2.A, 0.01, 'reopened geometry ft²');
    near(reArea.measureValue, EXPECTED_FT2.A, 0.01, 'reopened value');
    assert.equal(reArea.measureUnit, 'ft²');
    near(rePerim.measureValue, 70, 0.01, 'reopened perimeter');
    for (const p of area.points) {
      assert.ok(reArea.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.01), `corner ${JSON.stringify(p)} kept`);
    }
    assert.equal(rePoly.holes?.length, 1);
    near(nettoVlakOppervlak(rePoly.points, rePoly.holes), region.area, 0.5);
  });
}

test('without a calibration the fill stays in page units, never feet', async () => {
  const region = await fillRoomA(await floorPlanPdf());
  openDocument({}, null);
  const [area] = createDynamicFillAnnotations([region], 'area', 1);
  assert.equal(area.measureUnit, 'pt²');
  near(area.measureValue, region.area, 1e-6);
  assert.match(area.measureText, /Scale not set/u);
});

test('line weight: thin hatching stops the fill only until it is ignored; clip paths never do', async () => {
  const bytes = await floorPlanPdf({ hatch: true });
  await withPdf(bytes, async (doc) => {
    openDocument(doc, QUARTER_INCH);
    const { edges } = await extractPageGeometry(1, { document: state.documents[0] });
    const walls = edges.filter((e) => e.paint === 's' && Math.abs(e.w - 0.7) < 1e-6);
    const hatch = edges.filter((e) => e.paint === 's' && Math.abs(e.w - HATCH_WIDTH) < 1e-6);
    const clips = edges.filter((e) => e.paint === 'n');
    assert.ok(walls.length >= 20, `walls at 0.7 pt: ${walls.length}`);
    assert.equal(hatch.length, 4, 'hatch lines at their page width under the 2x transform');
    assert.equal(clips.length, 4, 'the clip rectangle is marked unpainted');
    const page = await doc.getPage(1);
    const [x, y] = page.getViewport({ scale: 1 }).convertToViewportPoint(ROOM_A.x + 10, ROOM_A.y + 135);
    // Every drawn line counts: the hatch cuts room A into strips.
    const strip = findFillRegion(boundarySegments(edges, 0), { x, y }, { gap: 60 });
    assert.equal(strip.status, 'ok');
    assert.ok(strip.area / PT_PER_FT ** 2 < EXPECTED_FT2.A / 2, `a strip: ${strip.area / PT_PER_FT ** 2} ft²`);
    // Ignoring lines under 0.25 pt: the whole room again, column cut out.
    const room = findFillRegion(boundarySegments(edges, 0.25), { x, y }, { gap: 60 });
    near(room.area / PT_PER_FT ** 2, EXPECTED_FT2.A, 1e-6, 'room A with the hatch ignored');
    assert.equal(room.holes.length, 1);
    // Without the paint filter the clip rectangle would split the room too.
    const withClip = findFillRegion(edges.filter((e) => e.paint !== 's' || e.w >= 0.25), { x, y }, { gap: 60 });
    assert.ok(withClip.area < room.area, 'the clip path alone would cut the room');
  });
});

test('a Space (room + tag) from Dynamic Fill saves and reopens as a room, on a rotated cropped sheet', async () => {
  const { isRuimteVlak, ruimteVanTag, tagWeergaveParams } = await import('../plattegrond/ruimte-koppeling.js');
  const source = await floorPlanPdf({ rotate: 90, cropBox: [20, 30, 740, 560] });
  const region = await fillRoomA(source);
  openDocument({}, QUARTER_INCH);
  const [room, tag] = createDynamicFillAnnotations([region], ['space'], 1, { spaceName: 'Office' });
  assert.equal(tag.symbolId, 'room-tag');
  const models = await reopen(await save(source, [room, tag]));
  const reRoom = models.find((m) => isRuimteVlak(m));
  const reTag = models.find((m) => m.type === 'parametricSymbol');
  assert.ok(reRoom && reTag, `reopened: ${models.map((m) => m.type).join(', ')}`);
  assert.equal(reRoom.opsRuimteNaam, 'Office');
  assert.equal(reRoom.opsRuimteNummer, '1');
  near(reRoom.opsRuimteZaad.x, room.opsRuimteZaad.x, 0.01, 'seed x');
  near(reRoom.opsRuimteZaad.y, room.opsRuimteZaad.y, 0.01, 'seed y');
  near(reRoom.measureValue, EXPECTED_FT2.A, 0.01, 'room ft²');
  assert.equal(reRoom.holes?.length, 1);
  assert.equal(ruimteVanTag(reTag, models)?.id, reRoom.id, 'the tag finds its room again');
  assert.match(tagWeergaveParams(reTag, models).oppervlakteTekst, /^296\.00 ft²$/u);
});
