import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const sheet = fixture.addPage([612, 792]);
sheet.setCropBox(36, 40, 540, 720);
sheet.setRotation(degrees(90));
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-choice-formula-'));
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
      const a = createAnnotation({ id: 'choice-a', page: 2, type: 'box', x: 100, y: 100,
        width: 80, height: 40, color: '#e87524', strokeColor: '#e87524', lineWidth: 2 });
      const b = createAnnotation({ id: 'choice-b', page: 2, type: 'box', x: 100, y: 100,
        width: 80, height: 40, color: '#123abc', strokeColor: '#123abc', lineWidth: 2 });
      doc.annotations.push(a, b);
      doc.selectedAnnotation = a;
      doc.selectedAnnotations = [a];
    }
    (await import('/js/ui/panels/left-panel.js')).switchLeftPanelTab('annotations');
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  }, { bytes: Array.from(bytes), name, add });
  await load(new Uint8Array(await fixture.save()), 'choice-source.pdf', true);
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Choice column name', exact: true }).fill('Rate');
  await page.getByRole('textbox', { name: 'Options · one per line', exact: true }).fill('Standard\nUnpriced');
  await page.getByRole('textbox', { name: 'Optional numeric values · one line per option, blank for none', exact: true }).fill('12.5\n');
  await page.locator('form:has(#annotations-choice-column-name) button[type="submit"]').click();
  await page.getByRole('textbox', { name: 'Formula column name' }).fill('Adjusted rate');
  assert.equal(await page.getByLabel('Formula source').inputValue(), 'customChoice');
  await page.getByRole('textbox', { name: 'Multiplier' }).fill('2');
  await page.getByRole('textbox', { name: 'Offset' }).fill('0.199466');
  await page.locator('form:has(#annotations-formula-column-name) button[type="submit"]').click();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('combobox', { name: 'Rate · selected markup' }).selectOption('Standard');
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.some(ann => ann.markupChoiceValue === 'Standard'));
  await page.locator('.annotation-list-item[data-annotation-id="choice-b"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.selectedAnnotation?.id === 'choice-b');
  await page.getByRole('combobox', { name: 'Rate · selected markup' }).selectOption('Unpriced');
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.some(ann => ann.markupChoiceValue === 'Unpriced'));
  const save = async () => {
    const pending = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await pending).path()));
  };
  const inspect = async (bytes, rate) => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupChoiceColumnV1')).decodeText()),
      { version: 1, name: 'Rate', options: ['Standard', 'Unpriced'] });
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupChoiceColumnV2')).decodeText()),
      { version: 2, name: 'Rate', options: ['Standard', 'Unpriced'], numericValues: [rate, null] });
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupFormulaColumnV2')).decodeText()),
      { version: 2, name: 'Adjusted rate', source: 'customChoice', multiplier: '2', offset: '0.199466' });
  };
  const first = await save();
  await inspect(first, '12.5');
  await load(first, 'choice-first.pdf');
  await page.waitForFunction(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc?.markupFormulaColumn?.source === 'customChoice' && doc?._annotationPagesReady?.has(2)
      && doc.annotations.filter(ann => ann.page === 2 && ann.markupChoiceValue).length === 2;
  });
  assert.match(await page.locator('.annotation-cell-customFormula').allTextContents().then(v => v.join(' ')), /25\.199466/u);
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Optional numeric values · one line per option, blank for none', exact: true }).fill('13.25\n');
  await page.locator('form:has(#annotations-choice-column-name) button[type="submit"]').click();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.annotation-cell-customFormula')]
    .some(cell => cell.textContent.includes('26.699466')));
  const second = await save();
  await inspect(second, '13.25');
  await load(second, 'choice-second.pdf');
  await page.waitForFunction(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc?.markupFormulaColumn?.source === 'customChoice' && doc?._annotationPagesReady?.has(2)
      && doc.annotations.filter(ann => ann.page === 2 && ann.markupChoiceValue).length === 2;
  });
  const csv = await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return (await import('/js/annotations/markup-csv.js')).markupCsv(doc.annotations, null,
      doc.markupTextColumnName, doc.markupChoiceColumn, doc.markupNumberColumn,
      doc.markupCheckmarkColumn, doc.markupFormulaColumn);
  });
  assert.match(csv, /"Rate","Adjusted rate"/u);
  assert.match(csv, /"Standard","26\.699466"/u);
  assert.match(csv, /"Unpriced",""/u);
  const reportBytes = await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    const { markupSummaryRows } = await import('/js/annotations/markup-csv.js');
    const { buildMarkupSummaryPdf } = await import('/js/annotations/markup-pdf.js');
    const font = new Uint8Array(await (await fetch('/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf')).arrayBuffer());
    return Array.from(await buildMarkupSummaryPdf({ sourcePath: 'choice-second.pdf',
      rows: markupSummaryRows(doc.annotations, null, doc.markupChoiceColumn,
        doc.markupNumberColumn, doc.markupCheckmarkColumn, doc.markupFormulaColumn),
      customChoiceColumn: doc.markupChoiceColumn, customFormulaColumn: doc.markupFormulaColumn }, font));
  });
  const task = getDocument({ data: Uint8Array.from(reportBytes), useSystemFonts: false });
  const report = await task.promise;
  const content = await (await report.getPage(1)).getTextContent();
  assert.match(content.items.map(item => item.str).join(' '), /Adjusted rate: 26\.699466/u);
  await task.destroy();
  assert.deepEqual(errors, []);
  console.log('Numeric Choice Formula UI, rotated CropBox two-save PDF, CSV/PDF summary smoke passed.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
