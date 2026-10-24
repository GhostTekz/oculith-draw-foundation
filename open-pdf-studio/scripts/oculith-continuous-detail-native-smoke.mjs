// Run through run-native-markup-smoke.mjs against the debug desktop binary.
// Checks that the live WebView receives one sharp region after zoom and that
// scrolling/page changes replace it rather than multiplying compositor layers.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';

const port = Number(process.argv[2]);
const endpoint = `http://127.0.0.1:${port}/mcp`;
let serial = 0;

async function call(name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++serial, method: 'tools/call',
      params: { name, arguments: args } }),
  });
  assert.equal(response.status, 200, `${name} HTTP`);
  const body = await response.json();
  assert.equal(body.error, undefined, `${name} JSON-RPC`);
  const result = JSON.parse(body.result.content.find(item => item.type === 'text').text);
  assert.notEqual(result.ok, false, `${name}: ${JSON.stringify(result)}`);
  return result;
}

async function waitFor(label, predicate, timeout = 30_000) {
  const until = Date.now() + timeout;
  let state;
  while (Date.now() < until) {
    state = await call('app_get_viewport_state');
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  throw new Error(`${label} did not settle: ${JSON.stringify(state?.continuousDetail)}`);
}

const dir = await mkdtemp(join(tmpdir(), 'oculith-continuous-detail-'));
try {
  const pdf = await PDFDocument.create();
  for (let sheet = 1; sheet <= 2; sheet++) {
    const page = pdf.addPage([612, 792]);
    for (let x = 12; x <= 600; x += 8) {
      page.drawLine({ start: { x, y: 8 }, end: { x, y: 784 }, thickness: 0.3, color: rgb(0, 0, 0) });
    }
    for (let y = 8; y <= 784; y += 8) {
      page.drawLine({ start: { x: 8, y }, end: { x: 604, y }, thickness: 0.3, color: rgb(0, 0, 0) });
    }
    page.drawText(`SHEET ${sheet}`, { x: 36, y: 740, size: 28, color: rgb(0.8, 0, 0) });
  }
  const path = join(dir, 'two-sharp-sheets.pdf');
  await writeFile(path, await pdf.save());
  await call('app_open_pdf', { path });
  await call('app_set_view_mode', { mode: 'continuous' });
  await call('app_set_zoom', { scale: 8 });
  const first = await waitFor('first sharp tile', state => state.doc.viewMode === 'continuous'
    && state.continuousDetail?.visible && state.continuousDetail.page === 1);
  assert.equal(first.continuousDetail.count, 1);
  assert.ok(first.continuousDetail.width >= first.continuousDetail.cssWidth * first.devicePixelRatio * 0.9);
  const scroll = first.container;
  await call('app_scroll', {
    x: Math.round(scroll.left + scroll.width / 2), y: Math.round(scroll.top + scroll.height / 2),
    dy: 1800,
  });
  const moved = await waitFor('scroll and sharp tile', state => state.container.scrollTop > scroll.scrollTop + 100
    && state.continuousDetail?.visible && state.continuousDetail.count === 1
    && Math.abs(state.continuousDetail.pageY - first.continuousDetail.pageY) > 100);
  assert.ok(moved.continuousDetail.width > 0);
  await call('app_go_to_page', { page: 2 });
  const second = await waitFor('second page sharp tile', state => state.continuousDetail?.visible
    && state.continuousDetail.page === 2);
  assert.equal(second.continuousDetail.count, 1);
  await call('app_set_zoom', { scale: 1 });
  await waitFor('low zoom removes sharp tile', state => !state.continuousDetail?.visible);
  console.log('Continuous detail native smoke passed: high zoom, pan, page switch, low zoom; one detail canvas.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
