import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { degrees, PDFDocument } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.js');
const { calculateDistance, getMeasureScale } = await import('./measurement.js');
const {
  createFullPageScaleRegion, createScaleRegion, getScaleRegionAt,
  invalidateScaleRegionCache, pixelsPerUnitFor,
} = await import('./scale-region.js');
const { viewportNaarPagina, viewportNaarScherm } = await import('../pdf/weergave-rotatie.js');

const crop = { x: 81, y: 47, width: 360, height: 260 };

async function croppedRotatedPage() {
  const source = await PDFDocument.create();
  const page = source.addPage([700, 600]);
  page.setCropBox(crop.x, crop.y, crop.width, crop.height);
  page.setRotation(degrees(90));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await source.save()), isEvalSupported: false, verbosity: 0 });
  try {
    const readPage = await (await task.promise).getPage(1);
    const nativeViewport = readPage.getViewport({ scale: 1 });
    assert.deepEqual(readPage.view, [81, 47, 441, 307], 'CropBox origin is nonzero');
    assert.equal(readPage.rotate, 90);
    assert.deepEqual([nativeViewport.width, nativeViewport.height], [260, 360]);
    const doc = {
      id: 'scale-region-crop-test', currentPage: 1, annotations: [],
      measureScale: { pixelsPerUnit: 2, unit: 'm' },
      pageDims: { 1: {
        widthPt: readPage.view[2] - readPage.view[0],
        heightPt: readPage.view[3] - readPage.view[1],
        offsetXPt: readPage.view[0], offsetYPt: readPage.view[1],
        rotation: readPage.rotate,
      } },
    };
    state.documents = [doc];
    state.activeDocumentIndex = 0;
    state.preferences.measureScale = null;
    invalidateScaleRegionCache();
    return { doc, nativeViewport };
  } finally {
    await task.destroy();
  }
}

test('full-page region reaches the cropped page boundary after native and view rotation', async () => {
  const { doc, nativeViewport } = await croppedRotatedPage();
  const region = createFullPageScaleRegion({ scaleString: '1:100', units: 'cm' });
  assert.ok(region);
  invalidateScaleRegionCache();
  assert.deepEqual([region.x, region.y, region.width, region.height], [0, 0, 260, 360],
    'a full-page region uses the rotated CropBox dimensions in page space');

  // PDF coordinates near the right CropBox edge become the lower strip of the
  // rotated page. Pass the points through a further 270° view rotation too.
  const firstPdf = [crop.x + 300, crop.y + 100];
  const secondPdf = [crop.x + 340, crop.y + 100];
  const appView = { pageW: nativeViewport.width, pageH: nativeViewport.height,
    rotation: 0, viewRotation: 270, zoom: 1.25, offsetX: -75, offsetY: 35 };
  const pagePoint = ([x, y]) => {
    const [px, py] = nativeViewport.convertToViewportPoint(x, y);
    const screen = viewportNaarScherm(appView, px, py);
    return viewportNaarPagina(appView, screen.x, screen.y);
  };
  const first = pagePoint(firstPdf);
  const second = pagePoint(secondPdf);
  assert.deepEqual(first, { x: 100, y: 300 });
  assert.deepEqual(second, { x: 100, y: 340 });
  const distance = calculateDistance(first.x, first.y, second.x, second.y, 1);
  assert.equal(getMeasureScale(1, 100, 320).regionId, region.id);
  assert.equal(distance.unit, 'cm');
  assert.ok(Math.abs(distance.value - 40 / pixelsPerUnitFor('1:100', 'cm')) < 1e-9);
  assert.equal(getMeasureScale(1, 261, 320).unit, 'm', 'outside the page uses document scale');
});

test('innermost region wins at its edge; points outside regions use document scale', async () => {
  const { doc } = await croppedRotatedPage();
  const outer = createScaleRegion({ page: 1, x: 40, y: 280, width: 180, height: 70,
    scaleString: '1:100', units: 'mm' });
  const inner = createScaleRegion({ page: 1, x: 80, y: 300, width: 50, height: 40,
    scaleString: '1:50', units: 'cm' });
  doc.annotations.push(outer, inner);
  invalidateScaleRegionCache();
  assert.equal(getScaleRegionAt(1, 130, 340)?.id, inner.id, 'boundary is inclusive');
  assert.equal(getScaleRegionAt(1, 130.001, 340)?.id, outer.id);
  assert.equal(getScaleRegionAt(1, 230, 320), null);

  const innerDistance = calculateDistance(100, 310, 100, 330, 1);
  assert.equal(innerDistance.unit, 'cm');
  assert.ok(Math.abs(innerDistance.value - 20 / pixelsPerUnitFor('1:50', 'cm')) < 1e-9);
  const outerDistance = calculateDistance(180, 310, 180, 330, 1);
  assert.equal(outerDistance.unit, 'mm');
  assert.ok(Math.abs(outerDistance.value - 20 / pixelsPerUnitFor('1:100', 'mm')) < 1e-9);
  assert.deepEqual(calculateDistance(230, 310, 230, 330, 1),
    { value: 10, unit: 'm', pixels: 20, calibrated: true });
});

test('invalid region metadata cannot become a physical calibration or hide a valid outer region', async () => {
  const { doc } = await croppedRotatedPage();
  const outer = createScaleRegion({ page: 1, x: 20, y: 20, width: 180, height: 180,
    scaleString: '1:100', units: 'cm' });
  const invalidInner = { type: 'scaleRegion', id: 'bad-inner', page: 1,
    x: 40, y: 40, width: 50, height: 50, scaleString: 'not a scale', units: 'mm' };
  doc.annotations.push(outer, invalidInner);
  invalidateScaleRegionCache();
  assert.equal(pixelsPerUnitFor('not a scale', 'mm'), null);
  assert.equal(pixelsPerUnitFor('1:100garbage', 'mm'), null);
  assert.equal(pixelsPerUnitFor('drawing 1:100', 'mm'), null);
  assert.equal(pixelsPerUnitFor('1:100', 'unknown'), null);
  const extremeRatio = `1:0.${'0'.repeat(305)}1`;
  assert.equal(pixelsPerUnitFor(extremeRatio, 'm'), null,
    'a finite intermediate value can still overflow after unit conversion');
  invalidInner.scaleString = extremeRatio;
  invalidInner.units = 'm';
  assert.equal(getMeasureScale(1, 60, 60).regionId, outer.id,
    'an invalid inner region must not mask a valid outer calibration');

  doc.annotations = [invalidInner];
  doc.measureScale = null;
  invalidateScaleRegionCache();
  const distance = calculateDistance(50, 60, 70, 60, 1);
  assert.deepEqual(distance, { value: 20, unit: 'pt', pixels: 20, calibrated: false });
  assert.equal(getMeasureScale(1, 60, 60).calibrated, false);
});
