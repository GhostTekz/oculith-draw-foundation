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
const input = Array.from(await fixture.save());
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-custom-number-'));
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
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
      const first = createAnnotation({ id: 'phase-a', page: 2, type: 'box', x: 100, y: 100,
        width: 80, height: 40, color: '#e87524', strokeColor: '#e87524', lineWidth: 2,
        subject: 'Source comment A', author: 'Source author A' });
      // Same geometry deliberately exercises per-annotation metadata identity.
      const second = createAnnotation({ id: 'phase-b', page: 2, type: 'box', x: 100, y: 100,
        width: 80, height: 40, color: '#123abc', strokeColor: '#123abc', lineWidth: 2,
        subject: 'Source comment B', author: 'Source author B' });
      doc.annotations.push(first, second);
      doc.selectedAnnotation = first;
      doc.selectedAnnotations = [first];
    }
    const { switchLeftPanelTab } = await import('/js/ui/panels/left-panel.js');
    switchLeftPanelTab('annotations');
    const { updateAnnotationsList } = await import('/js/ui/panels/annotations-list.js');
    updateAnnotationsList();
  }, { bytes: Array.from(bytes), name, add });
  await load(input, 'custom-source.pdf', true);
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Text column name', exact: true }).fill('Reviewer note');
  await page.locator('.annotations-custom-column-form').first().locator('button[type="submit"]').click();
  await page.getByRole('textbox', { name: 'Choice column name', exact: true }).fill('Disposition');
  await page.getByRole('textbox', { name: 'Options · one per line', exact: true }).fill('Review\nApproved\nHold');
  await page.locator('form:has(#annotations-choice-column-name) button[type="submit"]').click();
  await page.getByRole('combobox', { name: 'Disposition · selected markup' }).waitFor();
  await page.getByRole('textbox', { name: 'Number column name', exact: true }).fill('Quantity');
  await page.locator('form:has(#annotations-number-column-name) button[type="submit"]').click();
  await page.getByRole('textbox', { name: 'Quantity · selected markup' }).waitFor();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Reviewer note · selected markup' }).fill('Door α');
  await page.locator('.annotations-custom-value-form:has(#annotations-custom-value) button[type="submit"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-a')?.markupTextValue === 'Door α');
  await page.getByRole('combobox', { name: 'Disposition · selected markup' }).selectOption('Review');
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-a')?.markupChoiceValue === 'Review');
  await page.getByRole('textbox', { name: 'Quantity · selected markup' }).fill('-7.25');
  await page.locator('.annotations-custom-value-form:has(#annotations-number-value) button[type="submit"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-a')?.markupNumberValue === -7.25);
  await page.locator('.annotation-list-item[data-annotation-id="phase-b"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.selectedAnnotation?.id === 'phase-b');
  await page.getByRole('combobox', { name: 'Disposition · selected markup' }).selectOption('Approved');
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-b')?.markupChoiceValue === 'Approved');
  await page.getByRole('textbox', { name: 'Quantity · selected markup' }).fill('1e3');
  await page.locator('.annotations-custom-value-form:has(#annotations-number-value) button[type="submit"]').click();
  await page.locator('.annotations-custom-value-form:has(#annotations-number-value)').getByRole('alert').waitFor();
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(ann => ann.id === 'phase-b')?.markupNumberValue), undefined);
  await page.getByRole('textbox', { name: 'Quantity · selected markup' }).fill('-0');
  await page.locator('.annotations-custom-value-form:has(#annotations-number-value) button[type="submit"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-b')?.markupNumberValue === 0);
  assert.equal(await page.getByRole('textbox', { name: 'Quantity · selected markup' }).inputValue(), '0');

  const save = async () => {
    const promise = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await promise).path()));
  };
  const inspect = async (bytes, secondNumber) => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    assert.equal(pdf.catalog.lookup(PDFName.of('OPS_MarkupTextColumn')).decodeText(), 'Reviewer note');
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupChoiceColumnV1')).decodeText()),
      { version: 1, name: 'Disposition', options: ['Review', 'Approved', 'Hold'] });
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupNumberColumnV1')).decodeText()),
      { version: 1, name: 'Quantity' });
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const dicts = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)));
    assert.deepEqual(dicts.filter(dict => dict.get(PDFName.of('OPS_MarkupTextValue')))
      .map(dict => dict.get(PDFName.of('OPS_MarkupTextValue')).decodeText()), ['Door α']);
    assert.deepEqual(dicts.filter(dict => dict.get(PDFName.of('OPS_MarkupChoiceValue')))
      .map(dict => dict.get(PDFName.of('OPS_MarkupChoiceValue')).decodeText()).sort(), ['Approved', 'Review']);
    assert.deepEqual(dicts.filter(dict => dict.get(PDFName.of('OPS_MarkupNumberValue')))
      .map(dict => dict.get(PDFName.of('OPS_MarkupNumberValue')).decodeText()).sort(), ['-7.25', secondNumber].sort());
  };
  const first = await save();
  await inspect(first, '0');
  await load(first, 'custom-first.pdf');
  await page.waitForFunction(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc?.markupTextColumnName === 'Reviewer note' && doc?.markupChoiceColumn?.name === 'Disposition'
      && doc?.markupNumberColumn?.name === 'Quantity'
      && doc?._annotationPagesReady?.has(2)
      && doc.annotations.filter(ann => ann.page === 2 && ann.markupNumberValue !== undefined).length === 2;
  });
  assert.equal(await page.locator('.annotation-cell-customChoice').filter({ hasText: 'Review' }).count() > 0, true);
  await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    const selected = doc.annotations.find(ann => ann.markupNumberValue === 0);
    doc.selectedAnnotation = selected;
    doc.selectedAnnotations = [selected];
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  });
  await page.getByRole('textbox', { name: 'Quantity · selected markup' }).fill('12.5');
  await page.locator('.annotations-custom-value-form:has(#annotations-number-value) button[type="submit"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.some(ann => ann.markupNumberValue === 12.5));
  // Simulate a save while the asynchronous catalog callback has not yet
  // populated the document field. The saver must recover it from source PDF.
  await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    doc.markupTextColumnName = '';
    doc.markupChoiceColumn = null;
    doc.markupNumberColumn = null;
  });
  const second = await save();
  await inspect(second, '12.5');
  await load(second, 'custom-second.pdf');
  await page.waitForFunction(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc?.markupTextColumnName === 'Reviewer note' && doc?.markupChoiceColumn?.name === 'Disposition'
      && doc?.markupNumberColumn?.name === 'Quantity'
      && doc?._annotationPagesReady?.has(2)
      && doc.annotations.filter(ann => ann.page === 2 && ann.markupNumberValue !== undefined).length === 2;
  });
  const values = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(ann => ann.page === 2).map(ann => ({ text: ann.markupTextValue || '',
      choice: ann.markupChoiceValue || '', number: ann.markupNumberValue }))
    .sort((a, b) => a.choice.localeCompare(b.choice)));
  assert.deepEqual(values, [{ text: '', choice: 'Approved', number: 12.5 },
    { text: 'Door α', choice: 'Review', number: -7.25 }]);
  // Hold the source catalog while UI actions begin. This reproduces the gap
  // between annotation loading and the asynchronous catalog callback.
  const holdCatalog = async () => page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    const source = doc._sharedPdfLibDoc;
    if (!source) throw new Error('Expected parsed source PDF for the catalog race fixture.');
    doc.markupTextColumnName = '';
    doc.markupChoiceColumn = null;
    doc.markupNumberColumn = null;
    doc._sharedPdfLibDoc = null;
    doc._sharedPdfLibDocPromise = new Promise(resolve => {
      globalThis.__releaseMarkupCatalog = () => {
        doc._sharedPdfLibDoc = source;
        doc._sharedPdfLibDocPromise = null;
        resolve(source);
      };
    });
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  });
  const releaseCatalog = async () => page.evaluate(async () => {
    globalThis.__releaseMarkupCatalog();
    delete globalThis.__releaseMarkupCatalog;
    await Promise.resolve();
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  });
  await holdCatalog();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Text column name', exact: true }).fill('Disposition');
  await page.locator('.annotations-custom-column-form').first().locator('button[type="submit"]').click();
  await releaseCatalog();
  await page.locator('.annotations-custom-column-form').first().getByRole('alert').filter({ hasText: 'different names' }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .markupTextColumnName), 'Reviewer note');
  await holdCatalog();
  await page.getByRole('textbox', { name: 'Choice column name', exact: true }).fill('Reviewer note');
  await page.getByRole('textbox', { name: 'Options · one per line', exact: true }).fill('Review\nApproved\nHold');
  await page.locator('form:has(#annotations-choice-column-name) button[type="submit"]').click();
  await releaseCatalog();
  await page.locator('form:has(#annotations-choice-column-name)').getByRole('alert').filter({ hasText: 'distinct options' }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .markupChoiceColumn.name), 'Disposition');
  await holdCatalog();
  await page.getByRole('textbox', { name: 'Number column name', exact: true }).fill('Disposition');
  await page.locator('form:has(#annotations-number-column-name) button[type="submit"]').click();
  await releaseCatalog();
  await page.locator('form:has(#annotations-number-column-name)').getByRole('alert').filter({ hasText: 'names must differ' }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .markupNumberColumn.name), 'Quantity');
  await page.getByRole('button', { name: 'Columns' }).click();

  await holdCatalog();
  const menu = page.locator('#annotations-panel .annotations-toolbar-btn').first();
  await menu.click();
  const csvPromise = page.waitForEvent('download');
  await page.getByText('Export Comments to Data File... (CSV)').click();
  await releaseCatalog();
  const csv = (await readFile(await (await csvPromise).path())).toString('utf8');
  assert.match(csv, /"Reviewer note","Disposition","Quantity"/u);
  assert.match(csv, /"Door α","Review","-7\.25"/u);
  assert.match(csv, /"Approved","12\.5"/u);
  assert.doesNotMatch(csv, /"'-7\.25"/u);
  await page.evaluate(async () => {
    const menu = await import('/js/solid/stores/appMenuStore.js');
    menu.openAppMenu();
    menu.setActivePanel('export');
  });
  await holdCatalog();
  const pdfPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Markups List summary/u }).click();
  await releaseCatalog();
  const reportBytes = new Uint8Array(await readFile(await (await pdfPromise).path()));
  const task = getDocument({ data: reportBytes, useSystemFonts: false });
  const report = await task.promise;
  const content = await (await report.getPage(1)).getTextContent();
  const reportText = content.items.map(item => item.str).join(' ');
  assert.match(reportText, /Reviewer note: Door α/u);
  assert.match(reportText, /Disposition: Review/u);
  assert.match(reportText, /Disposition: Approved/u);
  assert.match(reportText, /Quantity: -7\.25/u);
  assert.match(reportText, /Quantity: 12\.5/u);
  await task.destroy();
  await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    const selected = doc.annotations.find(ann => ann.markupNumberValue === -7.25);
    doc.selectedAnnotation = selected;
    doc.selectedAnnotations = [selected];
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  });
  await menu.click();
  const selectedCsvPromise = page.waitForEvent('download');
  await page.getByText('Export Selected Comments to Data File... (CSV)').click();
  const selectedCsv = (await readFile(await (await selectedCsvPromise).path())).toString('utf8');
  assert.match(selectedCsv, /"-7\.25"/u);
  assert.doesNotMatch(selectedCsv, /"12\.5"/u);
  await page.evaluate(async () => {
    const app = await import('/js/solid/stores/appMenuStore.js');
    app.openAppMenu();
    app.setActivePanel('export');
  });
  const selectedPdfPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Selected markups summary/u }).click();
  const selectedPdf = getDocument({ data: new Uint8Array(await readFile(await (await selectedPdfPromise).path())),
    useSystemFonts: false });
  const selectedReport = await selectedPdf.promise;
  const selectedContent = await (await selectedReport.getPage(1)).getTextContent();
  const selectedText = selectedContent.items.map(item => item.str).join(' ');
  assert.match(selectedText, /Quantity: -7\.25/u);
  assert.doesNotMatch(selectedText, /Quantity: 12\.5/u);
  await selectedPdf.destroy();
  await page.getByRole('button', { name: /Sort Quantity ascending/u }).click();
  assert.deepEqual((await page.locator('.annotation-list-item .annotation-cell-customNumber').allTextContents())
    .map(value => value.trim()), ['-7.25', '12.5']);
  await page.getByRole('button', { name: /Sort Quantity descending/u }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.annotation-list-item .annotation-cell-customNumber')]
    .map(cell => cell.textContent.trim()).join(',') === '12.5,-7.25');
  assert.deepEqual((await page.locator('.annotation-list-item .annotation-cell-customNumber').allTextContents())
    .map(value => value.trim()), ['12.5', '-7.25']);
  await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    doc.annotations.find(ann => ann.markupChoiceValue === 'Review').markupChoiceValue = 'Unlisted';
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  });
  await page.getByRole('button', { name: /Sort Disposition ascending/u }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.annotation-list-item .annotation-cell-customChoice')]
    .map(cell => cell.textContent.trim()).join(',') === ',Approved');
  assert.deepEqual((await page.locator('.annotation-list-item .annotation-cell-customChoice').allTextContents())
    .map(value => value.trim()), ['', 'Approved'], 'sorting uses the blank shown for an invalid PDF value');
  assert.deepEqual(errors, []);
  console.log('Custom Number column smoke passed: two rotated CropBox PDF save/reopen cycles, all/selected CSV and PDF summaries');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
