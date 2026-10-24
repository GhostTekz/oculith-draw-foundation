import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDocument, PDFName, degrees } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const sheet = fixture.addPage([612, 792]);
sheet.setCropBox(36, 40, 540, 720);
sheet.setRotation(degrees(90));
const input = Array.from(await fixture.save());
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-tool-textbox-'));
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
    const { index } = createTab('textbox-source.pdf');
    await loadPDF('textbox-source.pdf', index, Uint8Array.from(bytes));
    const doc = state.documents[index];
    const source = createAnnotation({ type: 'textbox', page: 1, x: 210, y: 330,
      width: 130, height: 48, rotation: 0, text: 'ISSUED FOR REVIEW', fontSize: 14,
      fontFamily: 'Arial', fontBold: true, textColor: '#123abc', strokeColor: '#e87524',
      fillColor: '#ffffff', lineWidth: 2, subject: 'PRIVATE SOURCE NOTE',
      author: 'PRIVATE AUTHOR', replies: [{ text: 'PRIVATE REPLY' }] });
    doc.annotations.push(source);
    doc.selectedAnnotations = [source]; doc.selectedAnnotation = source;
  }, input);

  await page.getByRole('button', { name: 'Save selected' }).click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Review label');
  const optIn = page.getByRole('checkbox', { name: /Include text and size for Drawing Mode/u });
  assert.equal(await optIn.isChecked(), false);
  await optIn.check();
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  const preset = await page.evaluate(() => JSON.parse(localStorage.getItem('oculith-tool-chest-presets-v1'))[0]);
  assert.equal(preset.text, 'ISSUED FOR REVIEW');
  assert.deepEqual(preset.geometry, { kind: 'box', width: 130, height: 48, rotation: 0 });
  const stored = JSON.stringify(preset);
  for (const privateValue of ['PRIVATE SOURCE NOTE', 'PRIVATE AUTHOR', 'PRIVATE REPLY',
    '"page":1', '"x":210', '"y":330']) assert.equal(stored.includes(privateValue), false);
  await page.getByRole('button', { name: 'Switch Review label to Drawing Mode' }).click();

  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('textbox-output.pdf');
    await loadPDF('textbox-output.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
  }, input);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 2);
  const bounds = await page.locator('#pdf-canvas').boundingBox();
  assert.ok(bounds && bounds.width > bounds.height && bounds.height > 300,
    'the rotated nonzero-CropBox page is visible');
  const at = (u, v) => ({ x: bounds.x + bounds.width * u, y: bounds.y + bounds.height * v });

  await page.getByRole('button', { name: /Draw textbox with Review label style \(Drawing Mode\)/u }).click();
  const anchor = at(0.40, 0.28);
  await page.mouse.click(anchor.x, anchor.y);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(ann => ann.page === 2 && ann.type === 'textbox').length === 1);
  assert.equal(await page.locator('.inline-text-editor').count(), 0,
    'Drawing Mode places retained text without opening the editor');
  const drawing = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(ann => ann.page === 2 && ann.type === 'textbox'));
  assert.deepEqual([drawing.width, drawing.height, drawing.text, drawing.textColor, drawing.fontSize],
    [130, 48, 'ISSUED FOR REVIEW', '#123abc', 14]);
  assert.equal(drawing.subject, '');
  assert.notEqual(drawing.x, 210);
  assert.notEqual(drawing.y, 330);

  await page.getByRole('button', { name: 'Switch Review label to Properties Mode' }).click();
  await page.getByRole('button', { name: /Draw textbox with Review label style \(Properties Mode\)/u }).click();
  const start = at(0.28, 0.55);
  const end = at(0.51, 0.70);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(ann => ann.page === 2 && ann.type === 'textbox').length === 2);
  await page.locator('.inline-text-editor').waitFor();
  assert.equal((await page.locator('.inline-text-editor').innerText()).trim(), '',
    'Properties Mode opens a blank editor for newly entered text');
  await page.locator('.inline-text-editor').fill('FIELD NOTE 42');
  await page.keyboard.press('Tab');
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(ann => ann.page === 2 && ann.type === 'textbox').at(-1)?.text === 'FIELD NOTE 42');
  const properties = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(ann => ann.page === 2 && ann.type === 'textbox').at(-1));
  assert.ok(Math.abs(properties.width - 130) > 10 || Math.abs(properties.height - 48) > 10,
    'Properties Mode keeps the newly drawn size');
  assert.equal(properties.textColor, '#123abc');
  assert.equal(properties.subject, '');

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
  const download = await downloadPromise;
  const bytes = new Uint8Array(await readFile(await download.path()));
  const raw = await PDFDocument.load(bytes.slice());
  assert.deepEqual(raw.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
  assert.equal(raw.getPage(1).getRotation().angle, 90);
  const refs = raw.getPage(1).node.Annots();
  assert.ok(refs instanceof PDFArray && refs.size() === 2, 'both textboxes remain editable PDF annotations');
  const freeText = Array.from({ length: refs.size() }, (_, index) => raw.context.lookup(refs.get(index)));
  assert.ok(freeText.every(dict => dict.get(PDFName.of('Subtype')).toString() === '/FreeText'));
  assert.deepEqual(freeText.map(dict => dict.get(PDFName.of('Contents')).decodeText()).sort(),
    ['FIELD NOTE 42', 'ISSUED FOR REVIEW']);
  assert.equal(Buffer.from(bytes).toString('latin1').includes('PRIVATE SOURCE NOTE'), false);

  await page.evaluate(async pdfBytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('textbox-reopened.pdf');
    await loadPDF('textbox-reopened.pdf', index, Uint8Array.from(pdfBytes));
    await goToPage(2);
  }, Array.from(bytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?._annotationPagesReady?.has(2));
  const reopened = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(ann => ann.page === 2 && ann.type === 'textbox'));
  assert.equal(reopened.length, 2);
  for (const original of [drawing, properties]) {
    const loaded = reopened.find(ann => ann.text === original.text);
    assert.ok(loaded, `${original.text} survives reopen`);
    assert.ok(Math.abs(loaded.width - original.width) < 1 && Math.abs(loaded.height - original.height) < 1,
      `${original.text} page geometry survives rotated CropBox PDF save/reopen`);
    assert.equal(loaded.subject, '');
  }
  await page.getByRole('button', { name: 'Create tool set' }).click();
  await page.getByRole('textbox', { name: 'New tool set name' }).fill('Portable labels');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tool set', exact: true }).selectOption('my-tools');
  await page.getByRole('combobox', { name: 'Move Review label to tool set' }).selectOption({ label: 'Portable labels' });
  await page.getByRole('combobox', { name: 'Tool set', exact: true }).selectOption({ label: 'Portable labels' });
  await page.getByRole('button', { name: 'Switch Review label to Drawing Mode' }).click();
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const doc = getActiveDocument();
    const source = doc.annotations.find(ann => ann.type === 'textbox' && ann.text === 'FIELD NOTE 42');
    doc.selectedAnnotations = [source]; doc.selectedAnnotation = source;
  });
  await page.getByRole('button', { name: 'Save selected' }).click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Blank label');
  assert.equal(await page.getByRole('checkbox', { name: /Include text and size for Drawing Mode/u }).isChecked(), false);
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  const exportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export set' }).click();
  const portableBytes = await readFile(await (await exportPromise).path());
  const portable = JSON.parse(portableBytes.toString('utf8'));
  assert.deepEqual(Object.keys(portable), ['format', 'version', 'name', 'tools']);
  assert.equal(portable.version, 1);
  assert.deepEqual(portable.tools.map(tool => tool.name), ['Review label', 'Blank label']);
  assert.deepEqual(Object.keys(portable.tools[1]), ['name', 'tool', 'style'],
    'appearance-only textbox exports no size or text');
  assert.deepEqual([portable.tools[0].mode, portable.tools[0].text, portable.tools[0].geometry.width],
    ['drawing', 'ISSUED FOR REVIEW', 130]);
  for (const privateValue of ['PRIVATE SOURCE NOTE', 'PRIVATE AUTHOR', 'PRIVATE REPLY',
    '"page"', '"x"', '"y"', '"author"', '"subject"', '"replies"']) {
    assert.equal(portableBytes.includes(Buffer.from(privateValue)), false, privateValue);
  }
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import set' }).click();
  await (await chooserPromise).setFiles({ name: 'portable-labels.ocudraw-tools.json',
    mimeType: 'application/json', buffer: portableBytes });
  await page.getByRole('status').getByText(/Portable labels \(2\) imported with 2 tools/u).waitFor();
  await page.evaluate(async pdfBytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('portable-textbox-output.pdf');
    await loadPDF('portable-textbox-output.pdf', index, Uint8Array.from(pdfBytes));
    await goToPage(2);
  }, input);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?._annotationPagesReady?.has(2));
  await page.getByRole('button', { name: /Draw textbox with Review label style \(Drawing Mode\)/u }).click();
  const portableBounds = await page.locator('#pdf-canvas').boundingBox();
  await page.mouse.click(portableBounds.x + portableBounds.width * 0.38,
    portableBounds.y + portableBounds.height * 0.28);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.some(ann => ann.page === 2 && ann.text === 'ISSUED FOR REVIEW'));
  const importedPlacement = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(ann => ann.page === 2 && ann.text === 'ISSUED FOR REVIEW'));
  assert.deepEqual([importedPlacement.width, importedPlacement.height, importedPlacement.textColor],
    [130, 48, '#123abc']);
  assert.equal(importedPlacement.subject, '');
  const portableSave = page.waitForEvent('download');
  await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
  const portablePdfBytes = new Uint8Array(await readFile(await (await portableSave).path()));
  const portablePdf = await PDFDocument.load(portablePdfBytes.slice());
  assert.deepEqual(portablePdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
  assert.equal(portablePdf.getPage(1).getRotation().angle, 90);
  const portableRefs = portablePdf.getPage(1).node.Annots();
  assert.ok(portableRefs instanceof PDFArray && portableRefs.size() === 1);
  assert.equal(portablePdf.context.lookup(portableRefs.get(0)).get(PDFName.of('Contents')).decodeText(),
    'ISSUED FOR REVIEW');
  await page.evaluate(async pdfBytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('portable-textbox-reopened.pdf');
    await loadPDF('portable-textbox-reopened.pdf', index, Uint8Array.from(pdfBytes));
    await goToPage(2);
  }, Array.from(portablePdfBytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?._annotationPagesReady?.has(2));
  const portableReopened = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(ann => ann.page === 2 && ann.text === 'ISSUED FOR REVIEW'));
  assert.ok(portableReopened && Math.abs(portableReopened.width - 130) < 1 &&
    Math.abs(portableReopened.height - 48) < 1);
  // Defense in depth: even a malformed local annotation must not turn its
  // font name into XHTML markup or another /DS CSS declaration.
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    getActiveDocument().annotations.push(createAnnotation({ type: 'textbox', page: 2,
      x: 80, y: 100, width: 150, height: 42, text: 'SAFE MIXED',
      textRuns: [[{ text: 'SAFE ', bold: true }, { text: 'MIXED' }]],
      fontFamily: 'Arial"/><x foo="bar', fontSize: 12, textColor: '#123abc' }));
  });
  const unsafeSave = page.waitForEvent('download');
  await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
  const unsafeBytes = new Uint8Array(await readFile(await (await unsafeSave).path()));
  const unsafePdf = await PDFDocument.load(unsafeBytes.slice());
  const unsafeRefs = unsafePdf.getPage(1).node.Annots();
  const unsafeTextbox = Array.from({ length: unsafeRefs.size() }, (_, index) =>
    unsafePdf.context.lookup(unsafeRefs.get(index))).find(dict =>
    dict.get(PDFName.of('Contents'))?.decodeText() === 'SAFE MIXED');
  assert.ok(unsafeTextbox);
  assert.match(unsafeTextbox.get(PDFName.of('DS')).decodeText(), /font-family:Arial;/u);
  const rich = unsafeTextbox.get(PDFName.of('RC')).decodeText();
  assert.match(rich, /style="font:12pt Arial;color:#123abc"/u);
  assert.match(rich, /xfa:APIVersion="OcuDraw"/u);
  assert.equal(rich.includes('<x'), false);
  assert.equal(rich.includes('foo='), false);
  await page.evaluate(async pdfBytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('portable-textbox-richtext-reopened.pdf');
    await loadPDF('portable-textbox-richtext-reopened.pdf', index, Uint8Array.from(pdfBytes));
    await goToPage(2);
  }, Array.from(unsafeBytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?._annotationPagesReady?.has(2));
  const richReopened = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(ann => ann.page === 2 && ann.text === 'SAFE MIXED'));
  assert.ok(richReopened, 'the OcuDraw /RC rich text reopens as an editable textbox');
  assert.deepEqual(errors, []);
  console.log('Textbox Tool Chest smoke passed: portable JSON, rotated PDF roundtrip, and safe rich-text font family');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
