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
const sheet = fixture.addPage([612, 792]);
sheet.setCropBox(36, 40, 540, 720);
sheet.setRotation(degrees(90));
const input = new Uint8Array(await fixture.save());
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-formula-second-number-'));
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const load = async (bytes, name, add = false) => page.evaluate(async ({ bytes, name, add }) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { state } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { index } = createTab(name);
    await loadPDF(name, index, Uint8Array.from(bytes));
    await goToPage(2);
    const doc = state.documents[index];
    if (add) {
      const annotations = ['A', 'B', 'C'].map((label, index) => createAnnotation({
        id: `number-${label}`, page: 2, type: 'box', x: 100, y: 100, width: 80, height: 40,
        color: ['#e87524', '#123abc', '#00aabb'][index],
        strokeColor: ['#e87524', '#123abc', '#00aabb'][index], lineWidth: 2,
        subject: `Source comment ${label}`, author: `Source author ${label}`,
      }));
      doc.annotations.push(...annotations);
      doc.selectedAnnotation = annotations[0];
      doc.selectedAnnotations = [annotations[0]];
    }
    const { switchLeftPanelTab } = await import('/js/ui/panels/left-panel.js');
    switchLeftPanelTab('annotations');
    const { updateAnnotationsList } = await import('/js/ui/panels/annotations-list.js');
    updateAnnotationsList();
  }, { bytes: Array.from(bytes), name, add });
  await load(input, 'second-number-source.pdf', true);
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.locator('#annotations-second-number-column-name').fill('Unit cost');
  await page.locator('form:has(#annotations-second-number-column-name) button[type="submit"]').click();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Unit cost · selected markup' }).fill('-7.25');
  await page.locator('form:has(#annotations-second-number-value) button[type="submit"]').click();
  await page.locator('.annotation-list-item[data-annotation-id="number-A"] .annotation-cell-customNumber2')
    .filter({ hasText: '-7.25' }).waitFor();
  await page.locator('.annotation-list-item[data-annotation-id="number-B"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.selectedAnnotation?.id === 'number-B');
  await page.getByRole('textbox', { name: 'Unit cost · selected markup' }).fill('0');
  await page.locator('form:has(#annotations-second-number-value) button[type="submit"]').click();
  await page.locator('.annotation-list-item[data-annotation-id="number-B"] .annotation-cell-customNumber2')
    .filter({ hasText: '0' }).waitFor();

  await page.locator('.annotation-list-item[data-annotation-id="number-A"]').click();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Number column name', exact: true }).fill('Quantity');
  await page.locator('form:has(#annotations-number-column-name) button[type="submit"]').click();
  await page.getByRole('textbox', { name: 'Formula column name' }).fill('Extended cost');
  await page.locator('#annotations-formula-source').selectOption('customNumber2');
  await page.getByRole('textbox', { name: 'Multiplier' }).fill('12.5');
  await page.getByRole('textbox', { name: 'Offset' }).fill('2');
  await page.locator('form:has(#annotations-formula-column-name) button[type="submit"]').click();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Quantity · selected markup' }).fill('5');
  await page.locator('form:has(#annotations-number-value) button[type="submit"]').click();
  await page.locator('.annotation-list-item[data-annotation-id="number-A"] .annotation-cell-customFormula')
    .filter({ hasText: '-88.625' }).waitFor();
  await page.locator('.annotation-list-item[data-annotation-id="number-B"] .annotation-cell-customFormula')
    .filter({ hasText: '2' }).waitFor();

  const save = async () => {
    const promise = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await promise).path()));
  };
  const inspect = async bytes => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupNumberColumnV1')).decodeText()),
      { version: 1, name: 'Quantity' });
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupNumberColumn2V1')).decodeText()),
      { version: 1, name: 'Unit cost' });
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupFormulaColumnV3')).decodeText()),
      { version: 3, name: 'Extended cost', source: 'customNumber2', multiplier: '12.5', offset: '2' });
    assert.equal(pdf.catalog.get(PDFName.of('OPS_MarkupFormulaColumnV1')), undefined);
    assert.equal(pdf.catalog.get(PDFName.of('OPS_MarkupFormulaColumnV2')), undefined);
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const dicts = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)));
    assert.deepEqual(dicts.filter(dict => dict.get(PDFName.of('OPS_MarkupNumberValue')))
      .map(dict => dict.get(PDFName.of('OPS_MarkupNumberValue')).decodeText()), ['5']);
    assert.deepEqual(dicts.filter(dict => dict.get(PDFName.of('OPS_MarkupNumberValue2V1')))
      .map(dict => dict.get(PDFName.of('OPS_MarkupNumberValue2V1')).decodeText()).sort(),
    ['-7.25', '0']);
  };
  const assertLoaded = async () => {
    await page.waitForFunction(async () => {
      const doc = (await import('/js/core/state.ts')).getActiveDocument();
      return doc?.markupNumberColumn2?.name === 'Unit cost'
        && doc?.markupFormulaColumn?.source === 'customNumber2' && doc?._annotationPagesReady?.has(2)
        && doc.annotations.filter(ann => ann.page === 2).length === 3;
    });
    const rows = await page.evaluate(async () => {
      const doc = (await import('/js/core/state.ts')).getActiveDocument();
      return doc.annotations.filter(ann => ann.page === 2)
        .map(ann => [ann.subject, ann.markupNumberValue ?? null, ann.markupNumberValue2 ?? null])
        .sort((a, b) => a[0].localeCompare(b[0]));
    });
    assert.deepEqual(rows, [
      ['Source comment A', 5, -7.25],
      ['Source comment B', null, 0],
      ['Source comment C', null, null],
    ]);
    const formulaCells = await page.locator('.annotation-list-item[data-annotation-id] .annotation-cell-customFormula')
      .allTextContents();
    assert.deepEqual(formulaCells.sort(), ['', '-88.625', '2']);
  };
  await assertLoaded();
  const first = await save();
  await inspect(first);
  await load(first, 'second-number-first.pdf');
  await assertLoaded();
  await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    doc.markupNumberColumn2 = null;
    doc.markupFormulaColumn = null;
  });
  const second = await save();
  await inspect(second);
  await load(second, 'second-number-second.pdf');
  await assertLoaded();

  await page.getByRole('button', { name: /Sort Extended cost ascending/u }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll(
    '.annotation-list-item[data-annotation-id] .annotation-cell-customFormula'))
    .map(node => node.textContent).join('|') === '|-88.625|2');
  await page.getByRole('button', { name: /Sort Unit cost ascending/u }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll(
    '.annotation-list-item[data-annotation-id] .annotation-cell-customNumber2'))
    .map(node => node.textContent).join('|') === '|-7.25|0');
  await page.locator('.annotations-search').fill('-7.25');
  await page.waitForFunction(() => document.querySelectorAll('.annotation-list-item[data-annotation-id]').length === 1);
  assert.equal(await page.locator('.annotation-list-item[data-annotation-id] .annotation-cell-customNumber2')
    .first().textContent(), '-7.25');
  await page.locator('.annotations-search').fill('');
  await page.locator('#annotations-panel .annotations-toolbar-btn').first().click();
  const csvPromise = page.waitForEvent('download');
  await page.getByText('Export Comments to Data File... (CSV)').click();
  const csv = (await readFile(await (await csvPromise).path())).toString('utf8');
  assert.match(csv, /"Unit cost"/u);
  assert.match(csv, /"Quantity","Unit cost","Extended cost"/u);
  assert.match(csv, /"-7.25"/u);
  assert.match(csv, /"0"/u);
  assert.match(csv, /"5","-7.25","-88.625"/u);
  assert.doesNotMatch(csv, /"'-7.25"/u);
  await page.evaluate(async () => {
    const menu = await import('/js/solid/stores/appMenuStore.js');
    menu.openAppMenu();
    menu.setActivePanel('export');
  });
  const pdfPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Markups List summary/u }).click();
  const reportBytes = new Uint8Array(await readFile(await (await pdfPromise).path()));
  const task = getDocument({ data: reportBytes, useSystemFonts: false });
  const report = await task.promise;
  const content = await (await report.getPage(1)).getTextContent();
  const reportText = content.items.map(item => item.str).join(' ');
  assert.match(reportText, /Unit cost: -7.25/u);
  assert.match(reportText, /Unit cost: 0/u);
  assert.match(reportText, /Extended cost: -88.625/u);
  assert.match(reportText, /Extended cost: 2/u);
  await task.destroy();
  assert.deepEqual(errors, []);
  console.log('Second Number Formula passed: rotated CropBox two-save/reopen, overlap identity, list and CSV/PDF results');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
