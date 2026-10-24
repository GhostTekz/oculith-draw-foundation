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
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-custom-text-'));
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
  await page.getByRole('textbox', { name: 'Text column name', exact: true }).fill('Review phase');
  await page.locator('form:has(#annotations-custom-column-name) button[type="submit"]').click();
  await page.getByRole('textbox', { name: 'Second Text column name' }).fill('Inspector note');
  await page.locator('form:has(#annotations-second-text-column-name) button[type="submit"]').click();
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('textbox', { name: 'Review phase · selected markup' }).fill('Phase α');
  await page.locator('form:has(#annotations-custom-value) button[type="submit"]').click();
  await page.locator('.annotation-list-item[data-annotation-id="phase-a"] .annotation-cell-customText')
    .filter({ hasText: 'Phase α' }).waitFor();
  await page.getByRole('textbox', { name: 'Inspector note · selected markup' }).fill('Inspected A');
  await page.locator('form:has(#annotations-second-text-value) button[type="submit"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-a')?.markupTextValue === 'Phase α');
  await page.locator('.annotation-list-item[data-annotation-id="phase-b"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.selectedAnnotation?.id === 'phase-b');
  await page.getByRole('textbox', { name: 'Review phase · selected markup' }).fill('Phase B');
  await page.locator('form:has(#annotations-custom-value) button[type="submit"]').click();
  await page.locator('.annotation-list-item[data-annotation-id="phase-b"] .annotation-cell-customText')
    .filter({ hasText: 'Phase B' }).waitFor();
  await page.getByRole('textbox', { name: 'Inspector note · selected markup' }).fill('Inspect B');
  await page.locator('form:has(#annotations-second-text-value) button[type="submit"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(ann => ann.id === 'phase-b')?.markupTextValue === 'Phase B');
  assert.deepEqual(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(ann => ann.page === 2).map(ann => ann.markupTextValue2).sort()),
  ['Inspect B', 'Inspected A']);

  const save = async () => {
    const promise = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await promise).path()));
  };
  const inspect = async bytes => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    assert.equal(pdf.catalog.lookup(PDFName.of('OPS_MarkupTextColumn')).decodeText(), 'Review phase');
    assert.equal(pdf.catalog.lookup(PDFName.of('OPS_MarkupTextColumn2V1')).decodeText(), 'Inspector note');
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const values = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)))
      .filter(dict => dict.get(PDFName.of('OPS_MarkupTextValue')))
      .map(dict => dict.get(PDFName.of('OPS_MarkupTextValue')).decodeText()).sort();
    assert.deepEqual(values, ['Phase B', 'Phase α']);
    const secondValues = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)))
      .filter(dict => dict.get(PDFName.of('OPS_MarkupTextValue2V1')))
      .map(dict => dict.get(PDFName.of('OPS_MarkupTextValue2V1')).decodeText()).sort();
    assert.deepEqual(secondValues, ['Inspect B', 'Inspected A']);
  };
  const first = await save();
  await inspect(first);
  await load(first, 'custom-first.pdf');
  await page.waitForFunction(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc?.markupTextColumnName === 'Review phase' && doc?.markupTextColumn2Name === 'Inspector note'
      && doc?._annotationPagesReady?.has(2)
      && doc.annotations.filter(ann => ann.page === 2 && ann.markupTextValue && ann.markupTextValue2).length === 2;
  });
  assert.equal(await page.locator('.annotation-cell-customText').filter({ hasText: 'Phase α' }).count() > 0, true);
  // Simulate a save while the asynchronous catalog callback has not yet
  // populated the document field. The saver must recover it from source PDF.
  await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    doc.markupTextColumnName = '';
    doc.markupTextColumn2Name = '';
  });
  const second = await save();
  await inspect(second);
  await load(second, 'custom-second.pdf');
  await page.waitForFunction(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc?.markupTextColumnName === 'Review phase' && doc?.markupTextColumn2Name === 'Inspector note'
      && doc?._annotationPagesReady?.has(2)
      && doc.annotations.filter(ann => ann.page === 2 && ann.markupTextValue && ann.markupTextValue2).length === 2;
  });
  const values = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(ann => ann.page === 2).map(ann => ann.markupTextValue).sort());
  assert.deepEqual(values, ['Phase B', 'Phase α']);
  await page.getByRole('button', { name: /Sort Inspector note ascending/u }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll(
    '.annotation-list-item[data-annotation-id] .annotation-cell-customText2'))
    .map(node => node.textContent).join('|') === 'Inspect B|Inspected A');
  const ordered = await page.locator('.annotation-list-item[data-annotation-id] .annotation-cell-customText2')
    .allTextContents();
  assert.deepEqual(ordered, ['Inspect B', 'Inspected A']);
  await page.locator('.annotations-search').fill('Inspected A');
  await page.waitForFunction(() => document.querySelectorAll('.annotation-list-item[data-annotation-id]').length === 1);
  assert.equal(await page.locator('.annotation-list-item[data-annotation-id] .annotation-cell-customText2')
    .first().textContent(), 'Inspected A');
  await page.locator('.annotations-search').fill('');
  const menu = page.locator('#annotations-panel .annotations-toolbar-btn').first();
  await menu.click();
  const csvPromise = page.waitForEvent('download');
  await page.getByText('Export Comments to Data File... (CSV)').click();
  const csv = (await readFile(await (await csvPromise).path())).toString('utf8');
  assert.match(csv, /"Review phase"/u);
  assert.match(csv, /"Phase α"/u);
  assert.match(csv, /"Phase B"/u);
  assert.match(csv, /"Inspector note"/u);
  assert.match(csv, /"Inspected A"/u);
  assert.match(csv, /"Inspect B"/u);
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
  assert.match(reportText, /Review phase: Phase α/u);
  assert.match(reportText, /Review phase: Phase B/u);
  assert.match(reportText, /Inspector note: Inspected A/u);
  assert.match(reportText, /Inspector note: Inspect B/u);
  await task.destroy();

  // A separate document has no first Text values at all. All three markups
  // share /Rect; the blank third value must never inherit a neighbour's value.
  await load(input, 'second-only-source.pdf', true);
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const doc = getActiveDocument();
    doc.markupTextColumn2Name = 'Inspector note';
    doc.annotations[0].markupTextValue2 = 'Only A';
    doc.annotations[1].markupTextValue2 = 'Only B';
    doc.annotations.push(createAnnotation({ id: 'phase-c', page: 2, type: 'box', x: 100, y: 100,
      width: 80, height: 40, color: '#00aabb', strokeColor: '#00aabb', lineWidth: 2,
      subject: 'Source comment C', author: 'Source author C' }));
  });
  const assertSecondOnly = async () => {
    await page.waitForFunction(async () => {
      const doc = (await import('/js/core/state.ts')).getActiveDocument();
      return doc?.markupTextColumn2Name === 'Inspector note' && doc?._annotationPagesReady?.has(2)
        && doc.annotations.filter(ann => ann.page === 2).length === 3;
    });
    const rows = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
      .annotations.filter(ann => ann.page === 2)
      .map(ann => [ann.subject, ann.markupTextValue || '', ann.markupTextValue2 || ''])
      .sort((a, b) => a[0].localeCompare(b[0])));
    assert.deepEqual(rows, [
      ['Source comment A', '', 'Only A'],
      ['Source comment B', '', 'Only B'],
      ['Source comment C', '', ''],
    ]);
  };
  await assertSecondOnly();
  const inspectSecondOnlyPdf = async bytes => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    assert.equal(pdf.catalog.get(PDFName.of('OPS_MarkupTextColumn')), undefined);
    assert.equal(pdf.catalog.lookup(PDFName.of('OPS_MarkupTextColumn2V1')).decodeText(), 'Inspector note');
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const dicts = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)));
    assert.equal(dicts.filter(dict => dict.get(PDFName.of('OPS_MarkupTextValue'))).length, 0);
    assert.deepEqual(dicts.filter(dict => dict.get(PDFName.of('OPS_MarkupTextValue2V1')))
      .map(dict => dict.get(PDFName.of('OPS_MarkupTextValue2V1')).decodeText()).sort(),
    ['Only A', 'Only B']);
  };
  const secondOnlyFirst = await save();
  await inspectSecondOnlyPdf(secondOnlyFirst);
  await load(secondOnlyFirst, 'second-only-first.pdf');
  await assertSecondOnly();
  const secondOnlySecond = await save();
  await inspectSecondOnlyPdf(secondOnlySecond);
  await load(secondOnlySecond, 'second-only-second.pdf');
  await assertSecondOnly();
  assert.deepEqual(errors, []);
  console.log('Two Text columns passed: rotated CropBox two-save/reopen, overlap identity, sort/filter, CSV/PDF summaries');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
