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
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-custom-checkmark-'));
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
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
      for (const [id, color] of [['phase-a', '#e87524'], ['phase-b', '#123abc'], ['phase-c', '#17a565']]) {
        // All three share geometry: custom values must follow PDF annotation references.
        doc.annotations.push(createAnnotation({ id, page: 2, type: 'box', x: 100, y: 100,
          width: 80, height: 40, color, strokeColor: color, lineWidth: 2 }));
      }
      doc.selectedAnnotation = doc.annotations.find(ann => ann.id === 'phase-a');
      doc.selectedAnnotations = [doc.selectedAnnotation];
    }
    (await import('/js/ui/panels/left-panel.js')).switchLeftPanelTab('annotations');
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  }, { bytes: Array.from(bytes), name, add });
  const save = async () => {
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await download).path()));
  };
  const inspect = async bytes => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupCheckmarkColumnV1')).decodeText()),
      { version: 1, name: 'Verified' });
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const dicts = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)));
    assert.equal(dicts.length, 3);
    assert.deepEqual(dicts.map(dict => dict.get(PDFName.of('OPS_MarkupCheckmarkValue'))?.decodeText() || null).sort(),
      ['checked', 'unchecked', null].sort());
  };
  const reportText = async bytes => {
    const task = getDocument({ data: bytes, useSystemFonts: false });
    const report = await task.promise;
    const pages = [];
    for (let i = 1; i <= report.numPages; i++) {
      const content = await (await report.getPage(i)).getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    await task.destroy();
    return pages.join(' ');
  };
  const holdCatalog = async () => page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    const source = doc._sharedPdfLibDoc;
    if (!source) throw new Error('Expected parsed source PDF.');
    doc.markupTextColumnName = '';
    doc.markupChoiceColumn = null;
    doc.markupNumberColumn = null;
    doc.markupCheckmarkColumn = null;
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

  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await load(new Uint8Array(await fixture.save()), 'custom-source.pdf', true);
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Checkmark column name' }).fill('Verified');
  await page.locator('form:has(#annotations-checkmark-column-name) button[type="submit"]').click();
  await page.getByRole('button', { name: 'Columns' }).click();
  const valueSelect = page.getByRole('combobox', { name: 'Verified · selected markup' });
  await valueSelect.selectOption('checked');
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-a')?.markupCheckmarkValue === 'checked');
  await page.locator('.annotation-list-item[data-annotation-id="phase-b"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.selectedAnnotation?.id === 'phase-b');
  await valueSelect.selectOption('unchecked');
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-b')?.markupCheckmarkValue === 'unchecked');
  await page.locator('.annotation-list-item[data-annotation-id="phase-c"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.selectedAnnotation?.id === 'phase-c');
  assert.equal(await valueSelect.inputValue(), '');
  assert.deepEqual(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.map(ann => [ann.id, ann.markupCheckmarkValue || null])),
  [['phase-a', 'checked'], ['phase-b', 'unchecked'], ['phase-c', null]]);
  const first = await save();
  await inspect(first);
  await load(first, 'custom-first.pdf');
  await page.waitForFunction(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc?.markupCheckmarkColumn?.name === 'Verified' && doc?._annotationPagesReady?.has(2)
      && doc.annotations.filter(ann => ann.page === 2).length === 3;
  });
  assert.deepEqual((await page.locator('.annotation-list-item .annotation-cell-customCheckmark').allTextContents())
    .map(value => value.trim()).sort(), ['', 'Checked', 'Unchecked'].sort());
  // Recreate the catalog callback gap before a second save. The source definition must survive.
  await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    doc.markupCheckmarkColumn = null;
  });
  const second = await save();
  await inspect(second);
  await load(second, 'custom-second.pdf');
  await page.waitForFunction(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc?.markupCheckmarkColumn?.name === 'Verified' && doc?._annotationPagesReady?.has(2)
      && doc.annotations.filter(ann => ann.page === 2).length === 3;
  });
  assert.deepEqual((await page.locator('.annotation-list-item .annotation-cell-customCheckmark').allTextContents())
    .map(value => value.trim()).sort(), ['', 'Checked', 'Unchecked'].sort());

  // A source-backed Checkmark name must block an early Text-column collision.
  await holdCatalog();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Text column name', exact: true }).fill('Verified');
  await page.locator('.annotations-custom-column-form').first().locator('button[type="submit"]').click();
  await releaseCatalog();
  await page.locator('.annotations-custom-column-form').first().getByRole('alert')
    .filter({ hasText: 'different names' }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .markupTextColumnName), '');
  await page.getByRole('button', { name: 'Columns' }).click();

  // Both export routes must wait for catalog hydration before choosing columns.
  await holdCatalog();
  const menu = page.locator('#annotations-panel .annotations-toolbar-btn').first();
  await menu.click();
  const csvDownload = page.waitForEvent('download');
  await page.getByText('Export Comments to Data File... (CSV)').click();
  await releaseCatalog();
  const csv = (await readFile(await (await csvDownload).path())).toString('utf8');
  assert.match(csv, /"Verified"/u);
  assert.match(csv, /"Checked"/u);
  assert.match(csv, /"Unchecked"/u);
  await page.evaluate(async () => {
    const app = await import('/js/solid/stores/appMenuStore.js');
    app.openAppMenu(); app.setActivePanel('export');
  });
  await holdCatalog();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Markups List summary/u }).click();
  await releaseCatalog();
  const pdfText = await reportText(new Uint8Array(await readFile(await (await pdfDownload).path())));
  assert.match(pdfText, /Verified: Checked/u);
  assert.match(pdfText, /Verified: Unchecked/u);

  await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    const selected = doc.annotations.find(ann => ann.markupCheckmarkValue === 'checked');
    doc.selectedAnnotation = selected;
    doc.selectedAnnotations = [selected];
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  });
  await menu.click();
  const selectedCsvDownload = page.waitForEvent('download');
  await page.getByText('Export Selected Comments to Data File... (CSV)').click();
  const selectedCsv = (await readFile(await (await selectedCsvDownload).path())).toString('utf8');
  assert.match(selectedCsv, /"Checked"/u);
  assert.doesNotMatch(selectedCsv, /"Unchecked"/u);
  await page.evaluate(async () => {
    const app = await import('/js/solid/stores/appMenuStore.js');
    app.openAppMenu(); app.setActivePanel('export');
  });
  const selectedPdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Selected markups summary/u }).click();
  const selectedPdfText = await reportText(new Uint8Array(await readFile(await (await selectedPdfDownload).path())));
  assert.match(selectedPdfText, /Verified: Checked/u);
  assert.doesNotMatch(selectedPdfText, /Verified: Unchecked/u);
  await page.getByRole('button', { name: /Sort Verified ascending/u }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.annotation-list-item .annotation-cell-customCheckmark')]
    .map(cell => cell.textContent.trim()).join(',') === ',Unchecked,Checked');
  assert.deepEqual((await page.locator('.annotation-list-item .annotation-cell-customCheckmark').allTextContents())
    .map(value => value.trim()), ['', 'Unchecked', 'Checked']);
  await page.getByRole('button', { name: /Sort Verified descending/u }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.annotation-list-item .annotation-cell-customCheckmark')]
    .map(cell => cell.textContent.trim()).join(',') === 'Checked,Unchecked,');
  assert.deepEqual(errors, []);
  console.log('Custom Checkmark smoke passed: tri-state on rotated CropBox, two PDF saves/reopens, collision, all/selected summaries');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
