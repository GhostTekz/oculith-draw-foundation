// Run while a debug desktop app listens with --mcp-server --mcp-port 9323.
// This uses the same generated four-sheet drawing as the browser checkpoint.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { constructionReviewFixture } from './oculith-integration-fixture.mjs';

const port = Number(process.argv[2] || 9323);
const endpoint = `http://127.0.0.1:${port}/mcp`;
let requestId = 0;
async function call(name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call',
      params: { name, arguments: args } }),
    signal: AbortSignal.timeout(90000),
  });
  assert.equal(response.status, 200, `${name}: HTTP status`);
  const body = await response.json();
  assert.equal(body.error, undefined, `${name}: ${JSON.stringify(body.error)}`);
  const result = JSON.parse(body.result.content.find(item => item.type === 'text').text);
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-native-integration-'));
const source = join(directory, 'issued-four-sheets.pdf');
const saved = join(directory, 'reviewed-four-sheets.pdf');
await writeFile(source, await constructionReviewFixture());
try {
  await call('app_list_tabs');
  const opened = await call('app_open_pdf', { path: source });
  assert.equal(opened.page_count, 4);
  await call('app_go_to_page', { page: 2 });
  const page = await call('app_get_page_count');
  assert.equal(page.currentPage, 2);
  const text = await call('app_get_page_text', { page: 2 });
  assert.match(JSON.stringify(text), /A-102 First floor/);
  const screenshot = await call('app_screenshot_view', { width: 800 });
  assert.ok(screenshot.width > 300 && screenshot.height > 300);
  const image = Buffer.from(screenshot.png_base64, 'base64');
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  if (process.env.OCUDRAW_KEEP_ACCEPTANCE_ARTIFACTS) await writeFile(join(directory, 'native-page-2.png'), image);

  const scale = await call('app_create_annotation', { type: 'scaleRegion', page: 2,
    props: { x: 0, y: 0, width: 612, height: 792, scaleString: '1:100', units: 'mm' } });
  assert.ok(scale.id);
  const count = await call('app_create_annotation', { type: 'count', page: 2,
    props: { x: 260, y: 280 } });
  assert.ok(count.id);
  const length = await call('app_create_annotation', { type: 'measureDistance', page: 2,
    props: { startX: 200, startY: 360, endX: 320, endY: 360 } });
  assert.ok(length.id);
  // Page 1 has no scale. The shoelace of this bowtie is 0. The desktop
  // engine repairs it to area 0.5. This binary is built with `--features geos`.
  const bowtie = await call('app_create_annotation', { type: 'measureArea', page: 1,
    props: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
  assert.ok(bowtie.id);
  let engineArea;
  let lastArea;
  const areaDeadline = Date.now() + 8000;
  while (Date.now() < areaDeadline) {
    const detail = await call('app_get_annotation', { id: bowtie.id });
    lastArea = detail.annotation;
    if (Math.abs(lastArea.measureValue - 0.5) < 1e-6) {
      engineArea = lastArea;
      break;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }
  assert.ok(engineArea, `geometry engine did not replace the bowtie shoelace of 0 with area 0.5: ${JSON.stringify({
    measureValue: lastArea?.measureValue,
    measureUnit: lastArea?.measureUnit,
    measureText: lastArea?.measureText,
    pointCount: lastArea?.points?.length,
  })}`);
  assert.match(engineArea.measureText, /0\.5/);
  await call('app_save_pdf', { path: saved });
  assert.ok((await stat(saved)).size > (await stat(source)).size);
  const savedBytes = new Uint8Array(await readFile(saved));
  const task = getDocument({ data: savedBytes.slice(), useSystemFonts: false });
  const independent = await task.promise;
  assert.equal(independent.numPages, 4);
  // The scale region is an /OPS_Viewport entry, not a third annotation.
  const pdfAnnots = await (await independent.getPage(2)).getAnnotations();
  assert.deepEqual(pdfAnnots.map(item => item.subtype).sort(), ['Line', 'Square']);
  await task.destroy();
  const raw = await PDFDocument.load(savedBytes);
  const vp = raw.getPage(1).node.lookup(PDFName.of('VP'));
  const regions = (vp ? vp.asArray().map(ref => raw.context.lookup(ref)) : [])
    .filter(dict => dict.get(PDFName.of('OPS_Viewport'))?.asBoolean?.() === true);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].get(PDFName.of('OPS_ScaleString')).decodeText(), '1:100');
  assert.equal(regions[0].get(PDFName.of('OPS_Units')).decodeText(), 'mm');
  const reopened = await call('app_open_pdf', { path: saved });
  assert.equal(reopened.page_count, 4);
  await call('app_go_to_page', { page: 2 });
  const annotations = await call('app_list_annotations', { page: 2 });
  for (const type of ['count', 'scaleRegion', 'measureDistance']) {
    assert.ok(annotations.annotations.some(item => item.type === type), `${type} missing after native reopen`);
  }
  const dimension = annotations.annotations.find(item => item.type === 'measureDistance');
  const detail = await call('app_get_annotation', { id: dimension.id });
  assert.equal(detail.annotation.measureUnit, 'mm');
  assert.ok(detail.annotation.measureValue > 0);
  console.log('Native integration smoke passed: four-page PDF, page-2 pixels/text, count and length annotations, 1:100 mm viewport');
} finally {
  if (!process.env.OCUDRAW_KEEP_ACCEPTANCE_ARTIFACTS) await rm(directory, { recursive: true, force: true });
  else console.log(`Native acceptance artifacts: ${directory}`);
}
