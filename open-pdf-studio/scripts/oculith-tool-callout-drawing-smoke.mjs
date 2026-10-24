import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDocument, PDFName, degrees } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const target = fixture.addPage([612, 792]);
target.setCropBox(36, 40, 540, 720);
target.setRotation(degrees(90));
const input = Array.from(await fixture.save());
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-callout-drawing-'));
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
    const { index } = createTab('callout-source.pdf');
    await loadPDF('callout-source.pdf', index, Uint8Array.from(bytes));
    const doc = state.documents[index];
    const source = createAnnotation({ type: 'callout', page: 1, x: 210, y: 330,
      width: 170, height: 70, arrowX: 100, arrowY: 380, kneeX: 185, kneeY: 365,
      armOriginX: 210, armOriginY: 365, text: 'PRIVATE SOURCE TEXT',
      fontSize: 15, fontFamily: 'Arial', fontBold: true, textColor: '#153558',
      strokeColor: '#b84216', fillColor: '#fff2db', lineWidth: 2.5,
      borderStyle: 'dashed', opacity: 0.8, leaderStyle: 'curved',
      borderEffect: 'cloudy', cloudIntensity: 1, textPadding: 4,
      subject: 'PRIVATE SOURCE SUBJECT', author: 'PRIVATE SOURCE AUTHOR',
      replies: [{ text: 'PRIVATE SOURCE REPLY' }] });
    doc.annotations.push(source);
    doc.selectedAnnotations = [source]; doc.selectedAnnotation = source;
  }, input);
  await page.getByRole('button', { name: 'Create tool set' }).click();
  await page.getByRole('textbox', { name: 'New tool set name' }).fill('Portable leaders');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Save selected' }).click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Review callout');
  assert.equal(await page.getByRole('checkbox', { name: /Include text and size for Drawing Mode/u }).count(), 0,
    'callout content capture is unavailable');
  const captureGeometry = page.getByRole('checkbox', { name: /Include box and leader shape for Drawing Mode and tool set export/u });
  assert.equal(await captureGeometry.isChecked(), false, 'relative geometry requires explicit opt-in');
  await captureGeometry.check();
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('oculith-tool-chest-presets-v1'))[0]);
  assert.equal(stored.tool, 'callout');
  assert.equal(stored.mode, 'properties');
  assert.deepEqual(stored.geometry, { kind: 'callout', boxDx: 110, boxDy: -50,
    width: 170, height: 70, kneeDx: 85, kneeDy: -15, armDx: 110, armDy: -15 });
  assert.equal(stored.text, undefined);
  for (const sourceOnly of ['PRIVATE SOURCE TEXT', 'PRIVATE SOURCE SUBJECT', 'PRIVATE SOURCE AUTHOR',
    'PRIVATE SOURCE REPLY', '"page":1', '"arrowX":100', '"x":210']) {
    assert.equal(JSON.stringify(stored).includes(sourceOnly), false, `${sourceOnly} is not reusable appearance`);
  }
  await page.getByRole('button', { name: 'Switch Review callout to Drawing Mode' }).click();
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export set' }).click();
  const portableBytes = await readFile(await (await exportDownload).path());
  const portable = JSON.parse(portableBytes.toString('utf8'));
  assert.deepEqual(Object.keys(portable), ['format', 'version', 'name', 'tools']);
  assert.equal(portable.version, 2);
  assert.equal(portable.name, 'Portable leaders');
  assert.deepEqual(portable.tools[0], { name: 'Review callout', tool: 'callout',
    style: stored.style, mode: 'drawing', geometry: stored.geometry });
  for (const sourceOnly of ['PRIVATE SOURCE', '"page"', '"arrowX"', '"x"',
    '"author"', '"subject"', '"replies"', '"text"']) {
    assert.equal(portableBytes.includes(Buffer.from(sourceOnly)), false,
      `${sourceOnly} must not enter portable JSON`);
  }
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import set' }).click();
  await (await chooser).setFiles({ name: 'portable-leaders.ocudraw-tools.json',
    mimeType: 'application/json', buffer: portableBytes });
  await page.getByRole('status').getByText(/Portable leaders \(2\) imported with 1 tools/u).waitFor();

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Tool set', exact: true }).selectOption({ label: 'Portable leaders (2)' });
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('callout-target.pdf');
    await loadPDF('callout-target.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
  }, input);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 2);
  const bounds = await page.locator('#pdf-canvas').boundingBox();
  assert.ok(bounds && bounds.width > bounds.height && bounds.height > 300,
    'rotated nonzero-CropBox page is visible');
  const at = (u, v) => ({ x: bounds.x + bounds.width * u, y: bounds.y + bounds.height * v });
  await page.getByRole('button', { name: /Draw callout with Review callout style \(Drawing Mode\)/u }).click();
  const arrow = at(0.28, 0.59);
  await page.mouse.click(arrow.x, arrow.y);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(annotation => annotation.page === 2 && annotation.type === 'callout').length === 1);
  await page.locator('.inline-text-editor').waitFor();
  assert.equal((await page.locator('.inline-text-editor').innerText()).trim(), '',
    'a new callout opens a blank editor');
  await page.locator('.inline-text-editor').fill('FIELD NOTE 42');
  await page.keyboard.press('Tab');
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.find(annotation => annotation.page === 2 && annotation.type === 'callout')?.text === 'FIELD NOTE 42');
  const placed = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.find(annotation => annotation.page === 2 && annotation.type === 'callout'));
  assert.equal(placed.subject, '');
  assert.equal(placed.strokeColor, '#b84216');
  assert.equal(placed.fillColor, '#fff2db');
  assert.equal(placed.textColor, '#153558');
  assert.equal(placed.fontSize, 15);
  assert.equal(placed.leaderStyle, 'curved');
  assert.equal(placed.borderEffect, 'cloudy');
  assert.equal(placed.cloudIntensity, 1);
  assert.equal(placed.textPadding, 4);
  assert.notEqual(placed.arrowX, 100);
  assert.notEqual(placed.x, 210);
  assert.equal(placed.width, 170, 'Drawing Mode reuses the saved box width');
  assert.equal(placed.height, 70);
  assert.ok(Math.abs((placed.x - placed.arrowX) - 110) < 0.01);
  assert.ok(Math.abs((placed.y - placed.arrowY) + 50) < 0.01);
  assert.ok(Math.abs((placed.kneeX - placed.arrowX) - 85) < 0.01);
  assert.ok(Math.abs((placed.kneeY - placed.arrowY) + 15) < 0.01);
  assert.ok(Math.abs((placed.armOriginX - placed.arrowX) - 110) < 0.01);
  assert.ok(Math.abs((placed.armOriginY - placed.arrowY) + 15) < 0.01);

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
  const download = await downloadPromise;
  const savedBytes = new Uint8Array(await readFile(await download.path()));
  const saved = await PDFDocument.load(savedBytes.slice());
  assert.deepEqual(saved.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
  assert.equal(saved.getPage(1).getRotation().angle, 90);
  const refs = saved.getPage(1).node.Annots();
  assert.ok(refs instanceof PDFArray && refs.size() === 1);
  const markup = saved.context.lookup(refs.get(0));
  assert.equal(markup.get(PDFName.of('Subtype')).toString(), '/FreeText');
  assert.equal(markup.get(PDFName.of('IT')).toString(), '/FreeTextCallout');
  assert.equal(markup.get(PDFName.of('Contents')).decodeText(), 'FIELD NOTE 42');
  assert.equal(markup.get(PDFName.of('OPS_LeaderStyle')).toString(), '/curved');
  const firstCl = markup.lookup(PDFName.of('CL'), PDFArray).asArray().map(value => value.asNumber());
  assert.equal(firstCl.length, 6);
  const firstRd = markup.lookup(PDFName.of('RD'), PDFArray).asArray().map(value => value.asNumber());
  assert.equal(firstRd.length, 4);
  assert.equal(Buffer.from(savedBytes).toString('latin1').includes('PRIVATE SOURCE'), false);

  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('callout-reopened.pdf');
    await loadPDF('callout-reopened.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
  }, Array.from(savedBytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?._annotationPagesReady?.has(2));
  const reopened = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(annotation => annotation.page === 2 && annotation.type === 'callout'));
  assert.equal(reopened.length, 1);
  const recaptured = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { captureToolGeometry } = await import('/js/tools/tool-preset-geometry.js');
    return captureToolGeometry(getActiveDocument().annotations.find(annotation =>
      annotation.page === 2 && annotation.type === 'callout'));
  });
  assert.ok(recaptured, 'a reopened saved callout remains eligible for Drawing Mode capture/update');
  assert.equal(reopened[0].text, 'FIELD NOTE 42');
  assert.equal(reopened[0].strokeColor, '#b84216');
  assert.equal(reopened[0].textColor, '#153558');
  assert.equal(reopened[0].leaderStyle, 'curved');
  assert.equal(reopened[0].borderEffect, 'cloudy');
  assert.equal(reopened[0].cloudIntensity, 1);
  assert.equal(reopened[0].textPadding, 4);
  assert.ok(Math.abs(reopened[0].arrowX - placed.arrowX) < 1 &&
    Math.abs(reopened[0].arrowY - placed.arrowY) < 1,
  'new leader geometry survives PDF save and app reopen on a rotated cropped page');
  for (const key of ['x', 'y', 'width', 'height', 'kneeX', 'kneeY', 'armOriginX', 'armOriginY']) {
    assert.ok(Math.abs(reopened[0][key] - placed[key]) < 1, `${key} survives first reopen`);
  }

  const secondDownload = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
  const secondBytes = new Uint8Array(await readFile(await (await secondDownload).path()));
  const second = await PDFDocument.load(secondBytes.slice());
  assert.deepEqual(second.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
  assert.equal(second.getPage(1).getRotation().angle, 90);
  const secondRefs = second.getPage(1).node.Annots();
  assert.ok(secondRefs instanceof PDFArray && secondRefs.size() === 1,
    'second save replaces the original callout without duplication');
  const secondMarkup = second.context.lookup(secondRefs.get(0));
  assert.equal(secondMarkup.get(PDFName.of('IT')).toString(), '/FreeTextCallout');
  assert.equal(secondMarkup.get(PDFName.of('Contents')).decodeText(), 'FIELD NOTE 42');
  const secondCl = secondMarkup.lookup(PDFName.of('CL'), PDFArray).asArray().map(value => value.asNumber());
  const secondRd = secondMarkup.lookup(PDFName.of('RD'), PDFArray).asArray().map(value => value.asNumber());
  assert.ok(secondCl.every((value, index) => Math.abs(value - firstCl[index]) < 1),
    'leader PDF coordinates stay stable on the second save');
  assert.ok(secondRd.every((value, index) => Math.abs(value - firstRd[index]) < 1),
    'box-to-annotation inset stays stable on the second save');
  assert.equal(Buffer.from(secondBytes).toString('latin1').includes('PRIVATE SOURCE'), false);

  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { index } = createTab('callout-second-reopen.pdf');
    await loadPDF('callout-second-reopen.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
  }, Array.from(secondBytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?._annotationPagesReady?.has(2));
  const secondReopened = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(annotation => annotation.page === 2 && annotation.type === 'callout'));
  assert.equal(secondReopened.length, 1);
  assert.equal(secondReopened[0].text, 'FIELD NOTE 42');
  for (const key of ['x', 'y', 'width', 'height', 'arrowX', 'arrowY', 'kneeX', 'kneeY',
    'armOriginX', 'armOriginY']) {
    assert.ok(Math.abs(secondReopened[0][key] - placed[key]) < 1, `${key} survives second reopen`);
  }
  assert.deepEqual(errors, []);
  console.log('Callout Drawing Mode smoke passed: fresh anchor and text, rotated CropBox PDF, second save/reopen');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
