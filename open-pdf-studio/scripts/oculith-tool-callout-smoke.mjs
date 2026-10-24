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
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-callout-preset-'));
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
  await page.getByRole('button', { name: 'Save selected' }).click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Review callout');
  assert.equal(await page.getByRole('checkbox', { name: /Include text and size for Drawing Mode/u }).count(), 0,
    'callout content capture is unavailable');
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('oculith-tool-chest-presets-v1'))[0]);
  assert.equal(stored.tool, 'callout');
  assert.equal(stored.mode, 'properties');
  assert.equal(stored.geometry, undefined);
  assert.equal(stored.text, undefined);
  for (const sourceOnly of ['PRIVATE SOURCE TEXT', 'PRIVATE SOURCE SUBJECT', 'PRIVATE SOURCE AUTHOR',
    'PRIVATE SOURCE REPLY', '"page":1', '"arrowX":100', '"x":210']) {
    assert.equal(JSON.stringify(stored).includes(sourceOnly), false, `${sourceOnly} is not reusable appearance`);
  }
  assert.equal(await page.getByRole('button', { name: 'Switch Review callout to Drawing Mode' }).isDisabled(), true);

  await page.reload({ waitUntil: 'networkidle' });
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
  await page.getByRole('button', { name: /Draw callout with Review callout style \(Properties Mode\)/u }).click();
  const arrow = at(0.28, 0.59);
  const box = at(0.57, 0.35);
  await page.mouse.move(arrow.x, arrow.y);
  await page.mouse.down();
  await page.mouse.move(box.x, box.y, { steps: 6 });
  await page.mouse.up();
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
  assert.equal(placed.width, 150, 'Properties Mode uses a fresh callout box');

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
  assert.equal(markup.lookup(PDFName.of('CL'), PDFArray).size(), 6);
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
  assert.deepEqual(errors, []);
  console.log('Callout Tool Chest smoke passed: local appearance, fresh text and geometry, rotated PDF save/reopen');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
