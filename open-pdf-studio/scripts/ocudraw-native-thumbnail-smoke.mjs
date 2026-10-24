// Native thumbnail retention check for a synthetic 120-sheet set. Run with
// OCUDRAW_REQUIRE_PACKAGED_FRONTEND=1 against an installed release binary.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const endpoint = `http://127.0.0.1:${Number(process.argv[2] || 9323)}/mcp`;
let requestId = 0;
async function call(name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId,
      method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(response.status, 200, name);
  const body = await response.json();
  assert.equal(body.error, undefined, `${name}: ${JSON.stringify(body.error)}`);
  const result = JSON.parse(body.result.content.find(item => item.type === 'text').text);
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let number = 1; number <= 120; number++) {
  const page = pdf.addPage([612, 792]);
  page.drawText(`SHEET ${number}`, { x: 70, y: 720, size: 36, font });
}
const dir = await mkdtemp(join(tmpdir(), 'ocudraw-thumb-smoke-'));
const path = join(dir, '120-sheets.pdf');
await writeFile(path, await pdf.save());
const opened = await call('app_open_pdf', { path });
assert.equal(opened.page_count, 120);

const panelSelector = '.thumbnails-container';
let panel = await call('app_ui_state', { selector: panelSelector, searchTabs: false });
if (!panel.found || !panel.visible) {
  await call('app_click_element', {
    selector: 'button.ws-access-tab[data-panel="thumbnails"]', searchTabs: false,
  });
  panel = await call('app_ui_state', { selector: panelSelector, searchTabs: false });
}
assert.ok(panel.found && panel.visible, 'thumbnail panel did not open');

const observations = [];
for (const page of [1, 100, 120, 1]) {
  const started = Date.now();
  await call('app_go_to_page', { page });
  let image = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    image = await call('app_ui_state', {
      selector: `.thumbnail-item[data-page="${page}"] img`, searchTabs: false,
    });
    if (image.found && image.visible) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(image?.found && image.visible,
    `sheet ${page} thumbnail did not become visible: ${JSON.stringify(image)}`);
  observations.push({ page, imageVisibleMs: Date.now() - started });
}
console.log(JSON.stringify({ ok: true, observations }));
