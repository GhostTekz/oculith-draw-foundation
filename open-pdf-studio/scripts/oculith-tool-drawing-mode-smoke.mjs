import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const rotatedPage = fixture.addPage([612, 792]);
rotatedPage.setCropBox(36, 40, 540, 720);
rotatedPage.setRotation(degrees(90));
const input = Array.from(await fixture.save());
const cacheDirectory = await mkdtemp(join(tmpdir(), 'ocudraw-tool-drawing-'));
const server = await createServer({
  cacheDir: join(cacheDirectory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { index } = createTab('drawing-mode-source.pdf');
    await loadPDF('drawing-mode-source.pdf', index, Uint8Array.from(bytes));
    const doc = state.documents[index];
    const line = createAnnotation({ type: 'line', page: 1, startX: 25, startY: 40, endX: 90, endY: 80,
      strokeColor: '#ea6715', lineWidth: 5, subject: 'SOURCE LINE NOTE' });
    const box = createAnnotation({ type: 'box', page: 1, x: 30, y: 50, width: 110, height: 65,
      strokeColor: '#12ab34', lineWidth: 3, subject: 'SOURCE BOX NOTE' });
    const cloud = createAnnotation({ type: 'cloud', page: 1, x: 800, y: 900, width: 120, height: 80,
      points: [{ x: 800, y: 900 }, { x: 920, y: 920 }, { x: 880, y: 980 }, { x: 810, y: 970 }],
      strokeColor: '#7352d6', lineWidth: 4, subject: 'SOURCE CLOUD NOTE' });
    doc.annotations.push(line, box, cloud);
    doc.selectedAnnotations = [line]; doc.selectedAnnotation = line;
  }, input);

  const saveSelected = page.getByRole('button', { name: 'Save selected' });
  await saveSelected.click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Revision line');
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    doc.selectedAnnotations = [doc.annotations[1]]; doc.selectedAnnotation = doc.annotations[1];
  });
  await saveSelected.click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Revision box');
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    doc.selectedAnnotations = [doc.annotations[2]]; doc.selectedAnnotation = doc.annotations[2];
  });
  await saveSelected.click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Revision cloud');
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  for (const name of ['Revision line', 'Revision box', 'Revision cloud']) {
    const mode = page.getByRole('button', { name: `Switch ${name} to Drawing Mode` });
    await mode.focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: `Switch ${name} to Properties Mode` }).waitFor();
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('oculith-tool-chest-presets-v1')));
  assert.equal(stored.length, 3);
  assert.ok(stored.every(tool => tool.mode === 'drawing' && tool.geometry));
  assert.equal(JSON.stringify(stored).includes('SOURCE'), false, 'saved tools exclude source notes');
  assert.deepEqual(stored.find(tool => tool.name === 'Revision cloud').geometry, { kind: 'points', points: [
    { x: 0, y: 0 }, { x: 120, y: 20 }, { x: 80, y: 80 }, { x: 10, y: 70 },
  ] }, 'point cloud stores only relative contour geometry');

  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('drawing-mode-output.pdf');
    await loadPDF('drawing-mode-output.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
  }, input);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 2);
  const sheet = await page.locator('#pdf-canvas').boundingBox();
  assert.ok(sheet && sheet.width > sheet.height && sheet.height > 300,
    'target sheet renders landscape after its native 90-degree rotation');
  const at = (horizontal, vertical) => ({ x: sheet.x + sheet.width * horizontal,
    y: sheet.y + sheet.height * vertical });

  await page.getByRole('button', { name: /Draw line with Revision line style \(Drawing Mode\)/ }).click();
  await page.mouse.click(at(0.25, 0.2).x, at(0.25, 0.2).y);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(annotation => annotation.page === 2 && annotation.type === 'line').length === 1);
  const line = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(annotation => annotation.page === 2 && annotation.type === 'line'));
  assert.equal(line.page, 2);
  assert.ok(line.startX > 0 && line.startY > 0);
  assert.equal(line.endX - line.startX, 65);
  assert.equal(line.endY - line.startY, 40);
  assert.equal(line.subject, '');

  await page.getByRole('button', { name: /Draw box with Revision box style \(Drawing Mode\)/ }).click();
  await page.mouse.click(at(0.51, 0.31).x, at(0.51, 0.31).y);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(annotation => annotation.page === 2 && annotation.type === 'box').length === 1);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(annotation => annotation.page === 2 && annotation.type === 'box').length), 1,
  'one Drawing Mode click creates one box');
  const box = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(annotation => annotation.page === 2 && annotation.type === 'box'));
  assert.equal(box.page, 2);
  assert.equal(box.width, 110);
  assert.equal(box.height, 65);
  assert.equal(box.subject, '');

  // The same saved preset in Properties Mode must honor a fresh drag, even on
  // the rotated CropBox sheet. Its appearance remains the saved green style.
  await page.getByRole('button', { name: 'Switch Revision box to Properties Mode' }).click();
  await page.getByRole('button', { name: /Draw box with Revision box style \(Properties Mode\)/ }).click();
  assert.equal(await page.evaluate(async () => (await import('/js/tools/tool-chest-presets.js')).activeToolPreset()?.mode),
    'properties', 'selected preset is in Properties Mode before dragging');
  const dragStart = at(0.30, 0.44);
  const dragEnd = at(0.49, 0.60);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(annotation => annotation.page === 2 && annotation.type === 'box').length === 2);
  const propertiesBox = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(annotation => annotation.page === 2 && annotation.type === 'box').at(-1));
  assert.ok(propertiesBox.width > 20 && propertiesBox.height > 20);
  assert.ok(Math.abs(propertiesBox.width - 110) > 10 && Math.abs(propertiesBox.height - 65) > 10,
    `Properties Mode keeps the new drag size instead of the saved dimensions: ${propertiesBox.width} × ${propertiesBox.height}`);
  assert.equal(propertiesBox.strokeColor, '#12ab34');
  assert.equal(propertiesBox.subject, '');

  await page.getByRole('button', { name: /Draw cloud with Revision cloud style \(Drawing Mode\)/ }).click();
  assert.equal(await page.evaluate(async () => (await import('/js/tools/tool-chest-presets.js')).activeToolPreset()?.mode),
    'drawing', 'cloud preset is in Drawing Mode before placing');
  const cloudAnchor = at(0.48, 0.19);
  await page.mouse.click(cloudAnchor.x, cloudAnchor.y);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(annotation => annotation.page === 2 && annotation.type === 'cloud').length === 1);
  const cloud = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(annotation => annotation.page === 2 && annotation.type === 'cloud'));
  assert.equal(cloud.width, 120);
  assert.equal(cloud.height, 80);
  assert.equal(cloud.subject, '');
  assert.equal(cloud.strokeColor, '#7352d6');
  for (const [index, [dx, dy]] of [[0, 0], [120, 20], [80, 80], [10, 70]].entries()) {
    assert.ok(Math.abs(cloud.points[index].x - cloud.x - dx) < 1e-6);
    assert.ok(Math.abs(cloud.points[index].y - cloud.y - dy) < 1e-6);
  }

  await page.getByRole('button', { name: 'Switch Revision cloud to Properties Mode' }).click();
  await page.getByRole('button', { name: /Draw cloud with Revision cloud style \(Properties Mode\)/ }).click();
  const cloudDragStart = at(0.30, 0.44);
  const cloudDragEnd = at(0.49, 0.60);
  await page.mouse.move(cloudDragStart.x, cloudDragStart.y);
  await page.mouse.down();
  await page.mouse.move(cloudDragEnd.x, cloudDragEnd.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(annotation => annotation.page === 2 && annotation.type === 'cloud').length === 2);
  const propertiesCloud = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(annotation => annotation.page === 2 && annotation.type === 'cloud').at(-1));
  assert.ok(propertiesCloud.width > 20 && propertiesCloud.height > 20);
  assert.ok(Math.abs(propertiesCloud.width - 120) > 10 || Math.abs(propertiesCloud.height - 80) > 10,
    `Properties cloud keeps a new drag size: ${propertiesCloud.width} × ${propertiesCloud.height}`);
  assert.equal(propertiesCloud.points, undefined, 'Properties Mode keeps a fresh rectangular drag');
  assert.equal(propertiesCloud.strokeColor, '#7352d6');
  assert.equal(propertiesCloud.subject, '');

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
  const download = await downloadPromise;
  const savedBytes = new Uint8Array(await readFile(await download.path()));
  const reopened = await PDFDocument.load(savedBytes.slice());
  assert.equal(reopened.getPageCount(), 2);
  assert.deepEqual(reopened.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
  assert.equal(reopened.getPage(1).getRotation().angle, 90);
  const refs = reopened.getPage(1).node.Annots();
  assert.ok(refs instanceof PDFArray && refs.size() === 5, 'rotated page contains five editable markups');
  const annotations = Array.from({ length: refs.size() }, (_, index) => reopened.context.lookup(refs.get(index)));
  const pdfLine = annotations.find(value => value.get(PDFName.of('Subtype')).toString() === '/Line');
  const pdfBoxes = annotations.filter(value => value.get(PDFName.of('Subtype')).toString() === '/Square');
  const pdfClouds = annotations.filter(value => value.get(PDFName.of('Subtype')).toString() === '/Polygon');
  assert.ok(pdfLine && pdfBoxes.length === 2 && pdfClouds.length === 2,
    'line, boxes, and clouds save as editable PDF annotations');
  const lineVector = pdfLine.lookup(PDFName.of('L'), PDFArray).asArray().map(value => value.asNumber());
  const task = getDocument({ data: savedBytes.slice(), useSystemFonts: false });
  const reader = await task.promise;
  const viewport = (await reader.getPage(2)).getViewport({ scale: 1 });
  const close = (actual, expected, label) => actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) < 1, `${label}[${index}]: ${value} vs ${expected[index]}`));
  close(lineVector, [viewport.convertToPdfPoint(line.startX, line.startY),
    viewport.convertToPdfPoint(line.endX, line.endY)].flat(), 'rotated line /L');
  for (const model of [box, propertiesBox]) {
    const corners = [viewport.convertToPdfPoint(model.x, model.y),
      viewport.convertToPdfPoint(model.x + model.width, model.y + model.height)];
    const expected = [Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]),
      Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1])];
    assert.ok(pdfBoxes.some(value => {
      const rect = value.lookup(PDFName.of('Rect'), PDFArray).asArray().map(part => part.asNumber());
      return rect.every((part, index) => Math.abs(part - expected[index]) < 1);
    }), `rotated box /Rect preserves ${model.width} × ${model.height} page-view geometry`);
  }
  const expectedCloudVertices = cloud.points.flatMap(point => viewport.convertToPdfPoint(point.x, point.y));
  assert.ok(pdfClouds.some(value => {
    const vertices = value.lookup(PDFName.of('Vertices'), PDFArray).asArray().map(part => part.asNumber());
    return vertices.length === expectedCloudVertices.length &&
      vertices.every((part, index) => Math.abs(part - expectedCloudVertices[index]) < 1);
  }), 'point cloud /Vertices preserve every offset on the rotated CropBox page');
  await task.destroy();
  assert.equal(Buffer.from(savedBytes).toString('latin1').includes('SOURCE LINE NOTE'), false);
  assert.equal(Buffer.from(savedBytes).toString('latin1').includes('SOURCE CLOUD NOTE'), false);
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('drawing-mode-reopened.pdf');
    await loadPDF('drawing-mode-reopened.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
  }, Array.from(savedBytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?._annotationPagesReady?.has(2));
  const appReopened = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(annotation => annotation.page === 2));
  assert.equal(appReopened.length, 5, 'the app reloads all five rotated-page markups');
  assert.ok(appReopened.every(annotation => annotation.subject === ''), 'source comments stay out of placed tools');
  const reopenedLine = appReopened.find(annotation => annotation.type === 'line');
  close([reopenedLine.startX, reopenedLine.startY, reopenedLine.endX, reopenedLine.endY],
    [line.startX, line.startY, line.endX, line.endY], 'app-reopened line');
  for (const model of [box, propertiesBox]) {
    assert.ok(appReopened.some(annotation => annotation.type === 'box' &&
      Math.abs(annotation.x - model.x) < 1 && Math.abs(annotation.y - model.y) < 1 &&
      Math.abs(annotation.width - model.width) < 1 && Math.abs(annotation.height - model.height) < 1),
    'app-reopened box keeps its placement and size');
  }
  assert.ok(appReopened.some(annotation => annotation.type === 'cloud' &&
    Array.isArray(annotation.points) && annotation.points.length === cloud.points.length &&
    annotation.points.every((point, index) =>
      Math.abs(point.x - cloud.points[index].x) < 1 && Math.abs(point.y - cloud.points[index].y) < 1)),
  'app-reopened cloud keeps its point contour');
  assert.ok(appReopened.some(annotation => annotation.type === 'cloud' && !annotation.points &&
    Math.abs(annotation.width - propertiesCloud.width) < 1 &&
    Math.abs(annotation.height - propertiesCloud.height) < 1),
  'app-reopened Properties cloud keeps its new drag size');
  assert.deepEqual(errors, []);
  console.log('Tool Chest Drawing Mode smoke passed: point cloud contour, rotated CropBox placement, Properties drag, PDF and app reopen');
} finally {
  await browser.close();
  await server.close();
  await rm(cacheDirectory, { recursive: true, force: true });
}
