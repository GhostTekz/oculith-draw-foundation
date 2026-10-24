import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDocument, PDFName, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const target = fixture.addPage([612, 792]);
target.setCropBox(36, 40, 540, 720);
target.setRotation(degrees(90));
const input = Array.from(await fixture.save());
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-tool-update-'));
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
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
    const { index } = createTab('tool-update-sources.pdf');
    await loadPDF('tool-update-sources.pdf', index, Uint8Array.from(bytes));
    const doc = state.documents[index];
    const original = createAnnotation({ type: 'box', page: 1, x: 50, y: 60, width: 80, height: 45,
      strokeColor: '#123456', lineWidth: 2, subject: 'OLD SOURCE COMMENT' });
    const mismatch = createAnnotation({ type: 'line', page: 1, startX: 20, startY: 20,
      endX: 55, endY: 40, strokeColor: '#123456' });
    const revised = createAnnotation({ type: 'box', page: 1, x: 200, y: 160, width: 140, height: 70,
      strokeColor: '#cc3344', lineWidth: 4, subject: 'REVISED SOURCE COMMENT', locked: true });
    doc.annotations.push(original, mismatch, revised);
    doc.selectedAnnotations = [original]; doc.selectedAnnotation = original;
  }, input);

  await page.getByRole('button', { name: 'My Tools options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Selected Markup…' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Updated outline');
  await page.locator('.sp-my-tools-form button[type="submit"]').click();
  await page.getByRole('button', { name: /Updated outline · Rectangle · Properties Mode/ }).click({ button: 'right', delay: 40 });
  await page.getByRole('menuitem', { name: 'Drawing Mode' }).click();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('oculith-tool-chest-presets-v1')));
  const originalPreset = (await stored())[0];
  assert.equal(originalPreset.mode, 'drawing');
  assert.deepEqual(originalPreset.geometry, { kind: 'box', width: 80, height: 45, rotation: 0 });
  await page.getByRole('button', { name: /Updated outline · Rectangle · Drawing Mode/ }).click({ button: 'right', delay: 40 });
  await page.getByRole('menuitem', { name: 'Edit…' }).click();
  const update = page.getByRole('button', { name: 'Update from selected markup' });
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    doc.selectedAnnotations = [doc.annotations[1]]; doc.selectedAnnotation = doc.annotations[1];
  });
  assert.equal(await update.isDisabled(), true, 'a different markup type cannot replace this tool');
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    doc.selectedAnnotations = [doc.annotations[2]]; doc.selectedAnnotation = doc.annotations[2];
  });
  assert.equal(await update.isDisabled(), true, 'a locked markup cannot replace this tool');
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    state.documents[state.activeDocumentIndex].annotations[2].locked = false;
  });
  await update.click();
  await page.getByRole('status').filter({ hasText: 'Updated outline updated from the selected box.' }).waitFor();
  const updated = (await stored())[0];
  assert.equal(updated.id, originalPreset.id);
  assert.equal(updated.name, originalPreset.name);
  assert.equal(updated.setId, originalPreset.setId);
  assert.equal(updated.mode, 'drawing');
  assert.deepEqual(updated.style, { strokeColor: '#cc3344', opacity: 1, lineWidth: 4 });
  assert.deepEqual(updated.geometry, { kind: 'box', width: 140, height: 70, rotation: 0 });
  assert.equal(JSON.stringify(updated).includes('SOURCE COMMENT'), false);
  assert.equal(Object.hasOwn(updated, 'page'), false);
  assert.equal(Object.hasOwn(updated, 'x'), false);

  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual((await stored())[0], updated, 'the updated preset survives app restart');
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('tool-update-output.pdf');
    await loadPDF('tool-update-output.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
  }, input);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 2);
  const sheet = await page.locator('#pdf-canvas').boundingBox();
  assert.ok(sheet && sheet.width > sheet.height, 'the target CropBox page renders rotated');
  const at = (horizontal, vertical) => ({ x: sheet.x + sheet.width * horizontal,
    y: sheet.y + sheet.height * vertical });
  await page.getByRole('button', { name: /Updated outline · Rectangle · Drawing Mode/ }).click();
  const anchor = at(0.48, 0.24);
  await page.mouse.click(anchor.x, anchor.y);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(annotation => annotation.page === 2 && annotation.type === 'box').length === 1);
  const drawing = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(annotation => annotation.page === 2 && annotation.type === 'box'));
  assert.deepEqual([drawing.width, drawing.height, drawing.strokeColor, drawing.lineWidth, drawing.subject],
    [140, 70, '#cc3344', 4, '']);
  await page.getByRole('button', { name: /Updated outline · Rectangle · Drawing Mode/ }).click({ button: 'right', delay: 40 });
  await page.getByRole('menuitem', { name: 'Properties Mode' }).click();
  await page.getByRole('button', { name: /Updated outline · Rectangle · Properties Mode/ }).click();
  const start = at(0.30, 0.44);
  const end = at(0.49, 0.60);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(annotation => annotation.page === 2 && annotation.type === 'box').length === 2);
  const properties = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(annotation => annotation.page === 2 && annotation.type === 'box').at(-1));
  assert.ok(Math.abs(properties.width - 140) > 10 || Math.abs(properties.height - 70) > 10,
    'Properties Mode uses the new drag size after a preset update');
  assert.equal(properties.strokeColor, '#cc3344');
  assert.equal(properties.subject, '');

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
  const download = await downloadPromise;
  const savedBytes = new Uint8Array(await readFile(await download.path()));
  const reopened = await PDFDocument.load(savedBytes.slice());
  assert.deepEqual(reopened.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
  assert.equal(reopened.getPage(1).getRotation().angle, 90);
  const refs = reopened.getPage(1).node.Annots();
  assert.ok(refs instanceof PDFArray && refs.size() === 2, 'both placed boxes remain editable PDF annotations');
  const squares = Array.from({ length: refs.size() }, (_, index) => reopened.context.lookup(refs.get(index)));
  const task = getDocument({ data: savedBytes.slice(), useSystemFonts: false });
  const reader = await task.promise;
  const viewport = (await reader.getPage(2)).getViewport({ scale: 1 });
  for (const model of [drawing, properties]) {
    const corners = [viewport.convertToPdfPoint(model.x, model.y),
      viewport.convertToPdfPoint(model.x + model.width, model.y + model.height)];
    const expected = [Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]),
      Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1])];
    assert.ok(squares.some(value => {
      if (value.get(PDFName.of('Subtype')).toString() !== '/Square') return false;
      const rect = value.lookup(PDFName.of('Rect'), PDFArray).asArray().map(part => part.asNumber());
      const color = value.lookup(PDFName.of('C'), PDFArray).asArray().map(part => part.asNumber());
      return rect.every((part, index) => Math.abs(part - expected[index]) < 1) &&
        color[0] > 0.75 && color[1] < 0.25 && color[2] > 0.2;
    }), 'updated color and exact page-view geometry survive PDF save');
  }
  await task.destroy();
  assert.equal(Buffer.from(savedBytes).toString('latin1').includes('SOURCE COMMENT'), false);
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('tool-update-reopened.pdf');
    await loadPDF('tool-update-reopened.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
  }, Array.from(savedBytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?._annotationPagesReady?.has(2));
  const appReopened = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(annotation => annotation.page === 2 && annotation.type === 'box'));
  assert.equal(appReopened.length, 2);
  assert.ok(appReopened.every(annotation => annotation.subject === '' && annotation.strokeColor === '#cc3344'));
  assert.deepEqual(errors, []);
  console.log('Tool Chest update smoke passed: guarded selection, persisted identity, rotated PDF save/reopen');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
