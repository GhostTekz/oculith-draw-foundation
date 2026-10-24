import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const sourceBytes = Array.from(await fixture.save());
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async content => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { index } = createTab('private-source.pdf');
    await loadPDF('private-source.pdf', index, Uint8Array.from(content));
    const source = createAnnotation({ type: 'line', page: 1, startX: 21, startY: 34, endX: 95, endY: 42,
      color: '#ea6715', strokeColor: '#ea6715', lineWidth: 5, subject: 'Private plan note' });
    const doc = state.documents[index];
    doc.annotations.push(source);
    doc.selectedAnnotations = [source];
    doc.selectedAnnotation = source;
  }, sourceBytes);

  await page.getByRole('button', { name: 'Create tool set' }).click();
  const name = page.getByRole('textbox', { name: 'New tool set name' });
  await name.fill('Electrical review');
  await name.press('Enter');
  await page.getByRole('button', { name: 'Save selected' }).click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Orange line');
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  await page.getByRole('button', { name: 'Draw line with Orange line style' }).waitFor();

  const exportedPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export set' }).click();
  const exported = await exportedPromise;
  assert.equal(exported.suggestedFilename(), 'Electrical_review.ocudraw-tools.json');
  const jsonBytes = await readFile(await exported.path());
  const document = JSON.parse(jsonBytes.toString('utf8'));
  assert.deepEqual(Object.keys(document), ['format', 'version', 'name', 'tools']);
  assert.deepEqual(Object.keys(document.tools[0]), ['name', 'tool', 'style']);
  assert.equal(document.tools[0].style.strokeColor, '#ea6715');
  assert.equal(jsonBytes.includes(Buffer.from('Private plan note')), false);
  assert.equal(jsonBytes.includes(Buffer.from('private-source.pdf')), false);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import set' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'electrical.ocudraw-tools.json', mimeType: 'application/json', buffer: jsonBytes });
  await page.getByRole('status').getByText(/Electrical review \(2\) imported with 1 tools/u).waitFor();
  const selector = page.getByRole('combobox', { name: 'Tool set', exact: true });
  assert.equal(await selector.locator('option').count(), 3);
  await page.evaluate(async content => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('review-output.pdf');
    await loadPDF('review-output.pdf', index, Uint8Array.from(content));
  }, sourceBytes);
  await page.getByRole('button', { name: 'Draw line with Orange line style' }).click();
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { createAnnotationFromTool } = await import('/js/tools/annotation-creators.js');
    const index = state.activeDocumentIndex;
    const annotation = createAnnotationFromTool('line', 150, 200, 260, 200, null);
    state.documents[index].annotations.push(annotation);
  });
  const outputPromise = page.waitForEvent('download');
  await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
  const output = await outputPromise;
  const saved = await PDFDocument.load(await readFile(await output.path()));
  const annots = saved.getPage(0).node.Annots();
  assert.ok(annots instanceof PDFArray && annots.size() === 1);
  const line = saved.context.lookup(annots.get(0));
  assert.equal(line.get(PDFName.of('Subtype')).toString(), '/Line');
  const color = line.lookup(PDFName.of('C'), PDFArray).asArray().map(value => value.asNumber());
  assert.ok(color[0] > 0.85 && color[1] > 0.35 && color[1] < 0.45, 'imported style survives a real PDF save');

  const invalid = Buffer.from(JSON.stringify({ ...document, sourcePdf: 'private-source.pdf' }));
  const badChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import set' }).click();
  await (await badChooserPromise).setFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: invalid });
  await page.locator('.sp-tool-set-error').getByText(/extra fields/u).waitFor();
  assert.equal(await selector.locator('option').count(), 3, 'invalid import cannot create a partial set');
  const largeChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import set' }).click();
  await (await largeChooserPromise).setFiles({ name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(65537) });
  await page.locator('.sp-tool-set-error').getByText(/exceeds the 65536-byte limit/u).waitFor();
  assert.equal(await selector.locator('option').count(), 3);
  assert.deepEqual(errors, []);
  console.log('Portable Tool Chest smoke passed: export, validated import, duplicate name, real PDF save, invalid and oversized files rejected');
} finally {
  await browser.close();
  await server.close();
}
