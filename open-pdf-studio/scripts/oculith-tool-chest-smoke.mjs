import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const bytes = Array.from(await fixture.save());
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async content => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { index } = createTab('tool-chest.pdf');
    await loadPDF('tool-chest.pdf', index, Uint8Array.from(content));
    const doc = state.documents[index];
    const source = createAnnotation({
      type: 'line', page: 1, startX: 25, startY: 40, endX: 90, endY: 80,
      color: '#ea6715', strokeColor: '#ea6715', lineWidth: 5,
      borderStyle: 'dashed', opacity: 0.65, startHead: 'none', endHead: 'open', headSize: 14,
      subject: 'source only',
    });
    doc.annotations.push(source);
    doc.selectedAnnotations = [source];
    doc.selectedAnnotation = source;
  }, bytes);

  const saveSelected = page.getByRole('button', { name: 'Save selected' });
  await saveSelected.waitFor();
  assert.equal(await saveSelected.isEnabled(), true, 'selected line enables Tool Chest capture');
  await page.getByRole('button', { name: 'Create tool set' }).click();
  const newSetName = page.getByRole('textbox', { name: 'New tool set name' });
  await newSetName.fill('Electrical review');
  await newSetName.press('Enter');
  const setSelector = page.getByRole('combobox', { name: 'Tool set', exact: true });
  assert.equal(await setSelector.inputValue(), await page.evaluate(async () =>
    (await import('/js/tools/tool-chest-presets.js')).getToolChestSets().find(set => set.name === 'Electrical review').id));
  await saveSelected.click();
  await page.getByRole('textbox', { name: 'Tool name' }).fill('Orange review line');
  await page.locator('.sp-docked .sp-my-tools-form button[type="submit"]').click();
  await page.getByRole('button', { name: /Draw line with Orange review line style/ }).waitFor();

  await page.reload({ waitUntil: 'networkidle' });
  const setSelectorAfterReload = page.getByRole('combobox', { name: 'Tool set', exact: true });
  await setSelectorAfterReload.waitFor();
  await setSelectorAfterReload.selectOption({ label: 'Electrical review' });
  const usePreset = page.getByRole('button', { name: /Draw line with Orange review line style/ });
  await usePreset.waitFor();
  await page.evaluate(async content => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('tool-chest-output.pdf');
    await loadPDF('tool-chest-output.pdf', index, Uint8Array.from(content));
  }, bytes);
  await usePreset.click();
  assert.equal(await usePreset.getAttribute('aria-pressed'), 'true', 'saved tool is active');

  const created = await page.evaluate(async () => {
    const { createAnnotationFromTool, buildAnnotationProps } = await import('/js/tools/annotation-creators.js');
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    const preview = buildAnnotationProps('line', 140, 150, 260, 150, null);
    const ann = createAnnotationFromTool('line', 140, 150, 260, 150, null);
    doc.annotations.push(ann);
    return { preview, ann, currentTool: state.currentTool };
  });
  assert.equal(created.currentTool, 'line');
  assert.equal(created.preview.strokeColor, '#ea6715', 'preview uses saved colour');
  assert.equal(created.ann.strokeColor, '#ea6715', 'new markup uses saved colour');
  assert.equal(created.ann.lineWidth, 5, 'new markup uses saved line width');
  assert.equal(created.ann.opacity, 0.65, 'new markup uses saved opacity');
  assert.equal(created.ann.startX, 140, 'new markup uses new geometry');
  assert.equal(created.ann.subject, '', 'source metadata does not leak into new markup');
  const recentTool = page.getByRole('button', { name: 'Use recent line style' });
  await recentTool.waitFor();
  assert.equal(await recentTool.count(), 1, 'drawing the saved style records one recent entry');
  await recentTool.click();
  const recentPreview = await page.evaluate(async () => {
    const { buildAnnotationProps } = await import('/js/tools/annotation-creators.js');
    return buildAnnotationProps('line', 10, 20, 60, 20, null);
  });
  assert.equal(recentPreview.strokeColor, '#ea6715', 'recent tool restores the drawn colour');
  assert.equal(recentPreview.lineWidth, 5, 'recent tool restores the drawn width');
  const storedPresets = await page.evaluate(() => JSON.parse(localStorage.getItem('oculith-tool-chest-presets-v1')));
  assert.equal(storedPresets.length, 1, 'recent tool stays separate from saved My Tools');

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(async () => {
    const { savePDF } = await import('/js/pdf/saver.js');
    await savePDF();
  });
  const downloaded = await downloadPromise;
  const saved = await PDFDocument.load(await readFile(await downloaded.path()));
  const annots = saved.getPage(0).node.Annots();
  assert.ok(annots instanceof PDFArray && annots.size() === 1, 'saved PDF contains one new markup');
  const line = saved.context.lookup(annots.get(0));
  assert.equal(line.get(PDFName.of('Subtype')).toString(), '/Line', 'new markup saves as a PDF Line annotation');
  const color = line.lookup(PDFName.of('C'), PDFArray)?.asArray().map(number => number.asNumber());
  assert.ok(color && color[0] > 0.85 && color[0] < 0.95 && color[1] > 0.35 && color[1] < 0.45,
    'saved PDF line retains the preset orange stroke');

  const movePreset = page.getByRole('combobox', { name: 'Move Orange review line to tool set' });
  await movePreset.selectOption({ label: 'My tools' });
  assert.equal(await usePreset.count(), 0, 'moving a tool removes it from the previous set');
  await setSelectorAfterReload.selectOption({ label: 'My tools' });
  await usePreset.waitFor();
  await movePreset.selectOption({ label: 'Electrical review' });
  await setSelectorAfterReload.selectOption({ label: 'Electrical review' });
  await usePreset.waitFor();
  await page.getByRole('button', { name: 'Delete current tool set' }).click();
  await usePreset.waitFor();
  assert.equal(await setSelectorAfterReload.locator('option').count(), 1,
    'deleting a named set returns its tools to My tools');

  await page.getByRole('button', { name: 'Delete Orange review line' }).click();
  assert.equal(await page.getByRole('button', { name: /Draw line with Orange review line style/ }).count(), 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(async () => {
    try { return (await import('/js/tools/tool-chest-presets.js')).getRecentTools().length === 0; }
    catch { return false; }
  });
  assert.equal(await page.getByRole('button', { name: 'Use recent line style' }).count(), 0,
    'Recent Tools clear when the app session reloads');
  assert.deepEqual(errors, []);
  console.log('Tool Chest smoke passed: create/move/delete named set, saved presets, Recent Tools, PDF save');
} finally {
  await browser.close();
  await server.close();
}
