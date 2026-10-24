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
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-count-toolchest-'));
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
  const sourceId = await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { index } = createTab('count-source.pdf');
    await loadPDF('count-source.pdf', index, Uint8Array.from(bytes));
    const source = createAnnotation({ type: 'count', page: 1, x: 104, y: 130,
      categoryId: 'SOURCE CATEGORY', number: 49, markerStyle: 'dot',
      color: '#a81d48', strokeColor: '#a81d48', opacity: 0.65,
      author: 'SOURCE AUTHOR', subject: 'SOURCE COMMENT', replies: [{ text: 'SOURCE REPLY' }] });
    const doc = state.documents[index];
    doc.annotations.push(source);
    doc.selectedAnnotations = [source]; doc.selectedAnnotation = source;
    return source.id;
  }, input);
  await page.getByRole('button', { name: 'Save selected' }).click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Door count');
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  const savedState = await page.evaluate(() => localStorage.getItem('oculith-tool-chest-presets-v1'));
  assert.ok(savedState, `count preset was not saved: ${await page.locator('.sp-tool-set-error').allTextContents()}`);
  assert.equal(JSON.parse(savedState)[0]?.tool, 'count');
  const use = page.getByRole('button', { name: /Draw count with Door count style \(Properties Mode\)/u });
  await use.waitFor();
  const stored = await page.evaluate(() => localStorage.getItem('oculith-tool-chest-presets-v1'));
  for (const secret of ['SOURCE CATEGORY', 'SOURCE AUTHOR', 'SOURCE COMMENT', 'SOURCE REPLY']) {
    assert.equal(stored.includes(secret), false, `${secret} must not enter the count preset`);
  }
  assert.equal(Object.hasOwn(JSON.parse(stored)[0], 'number'), false);
  assert.deepEqual(JSON.parse(stored)[0].style, { color: '#a81d48', strokeColor: '#a81d48',
    opacity: 0.65, markerStyle: 'dot' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { goToPage } = await import('/js/pdf/renderer.js');
    const { state } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { index } = createTab('count-target.pdf');
    await loadPDF('count-target.pdf', index, Uint8Array.from(bytes));
    await goToPage(2);
    state.documents[index].annotations.push(createAnnotation({ type: 'count', page: 2,
      x: 80, y: 80, categoryId: 'deuren', number: 1, markerStyle: 'dot', color: '#e11d48' }));
  }, input);
  await use.click();
  assert.equal(await use.getAttribute('aria-pressed'), 'true');
  const canvas = await page.locator('#pdf-canvas').boundingBox();
  assert.ok(canvas && canvas.width > canvas.height, 'rotated CropBox page is visible');
  await page.mouse.click(canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.54);
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()
    ?.annotations.filter(a => a.type === 'count' && a.page === 2).length === 2);
  const placed = await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc.annotations.filter(a => a.type === 'count' && a.page === 2)
      .map(a => ({ id: a.id, x: a.x, y: a.y, page: a.page, number: a.number,
        categoryId: a.categoryId, markerStyle: a.markerStyle, color: a.color, opacity: a.opacity,
        subject: a.subject, author: a.author }));
  });
  const fresh = placed.find(a => a.number === 2);
  assert.ok(fresh, `placement allocates the next target-category number: ${JSON.stringify(placed)}`);
  assert.equal(fresh.categoryId, 'deuren');
  assert.equal(fresh.color, '#a81d48');
  assert.equal(fresh.opacity, 0.65);
  assert.equal(fresh.markerStyle, 'dot');
  assert.equal(fresh.subject, '');
  assert.notEqual(fresh.id, sourceId);
  assert.notEqual(fresh.x, 104);
  assert.notEqual(fresh.y, 130);
  const save = async () => {
    const pending = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await pending).path()));
  };
  const inspect = async bytes => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const counts = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)))
      .filter(dict => dict.get(PDFName.of('OPS_Subtype'))?.decodeText() === 'count');
    assert.equal(counts.length, 2);
    assert.deepEqual(counts.map(dict => dict.get(PDFName.of('OPS_CountNumber')).asNumber()).sort(), [1, 2]);
    const savedFresh = counts.find(dict => dict.get(PDFName.of('OPS_CountNumber')).asNumber() === 2);
    assert.equal(savedFresh.get(PDFName.of('OPS_CountCategory')).decodeText(), 'deuren');
    assert.equal(savedFresh.get(PDFName.of('OPS_MarkerStyle')).decodeText(), 'dot');
    assert.equal(savedFresh.get(PDFName.of('CA')).asNumber(), 0.65);
    const color = savedFresh.lookup(PDFName.of('C'), PDFArray).asArray().map(value => value.asNumber());
    assert.ok(color[0] > 0.6 && color[0] < 0.7 && color[1] < 0.2 && color[2] > 0.2);
    assert.ok(savedFresh.get(PDFName.of('AP')));
  };
  const reopen = async (bytes, name) => {
    await page.evaluate(async ({ bytes, name }) => {
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const { goToPage } = await import('/js/pdf/renderer.js');
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(bytes));
      await goToPage(2);
    }, { bytes: Array.from(bytes), name });
    await page.waitForFunction(async () => {
      const doc = (await import('/js/core/state.ts')).getActiveDocument();
      return doc?._annotationPagesReady?.has(2) && doc.annotations.filter(a => a.type === 'count' && a.page === 2).length === 2;
    });
    const values = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
      .annotations.filter(a => a.type === 'count' && a.page === 2)
      .map(a => [a.number, a.categoryId, a.color, a.opacity, a.subject]).sort((a, b) => a[0] - b[0]));
    assert.deepEqual(values, [[1, 'deuren', '#e11d48', 1, ''], [2, 'deuren', '#a81d48', 0.65, '']]);
  };
  const first = await save();
  await inspect(first);
  await reopen(first, 'count-first.pdf');
  const second = await save();
  await inspect(second);
  await reopen(second, 'count-second.pdf');
  assert.deepEqual(errors, []);
  console.log('Count Tool Chest passed: local appearance, fresh target numbering, rotated CropBox two-save/reopen');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
