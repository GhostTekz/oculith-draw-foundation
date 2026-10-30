// Linux installed-app acceptance. Launch with run-native-markup-smoke.mjs and
// OCUDRAW_REQUIRE_PACKAGED_FRONTEND=1, OCULITH_REPLAY_SCRATCH=<main-disk-path>.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { unzip } from '../js/bcf/bcf-zip.js';

const port = Number(process.argv[2]);
const scratchRoot = process.env.OCULITH_REPLAY_SCRATCH;
assert.ok(Number.isInteger(port) && port > 0 && scratchRoot && process.env.DISPLAY);
const scratch = await mkdtemp(path.join(scratchRoot, 'issue-package-'));
let id = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(name, args = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(response.status, 200, name);
  const body = await response.json();
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  const result = JSON.parse(body.result.content.find(item => item.type === 'text').text);
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}
const ui = selector => call('app_ui_state', { selector, searchTabs: false });
const click = selector => call('app_click_element', { selector, searchTabs: false });
async function until(fn, label, count = 100) {
  let value;
  for (let i = 0; i < count; i++) {
    value = await fn();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(value)}`);
}
function xd(...args) {
  const result = spawnSync('xdotool', args, { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) throw new Error(`xdotool ${args[0]}: ${result.stderr || result.error}`);
  return result.stdout.trim();
}
function windows() {
  const result = spawnSync('xdotool', ['search', '--onlyvisible', '--name', '.'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim().split(/\s+/).filter(Boolean) : [];
}
async function nativeFileDialog(previous, target) {
  const chooser = await until(() => windows().find(window => !previous.includes(window)), `dialog for ${target}`);
  xd('windowfocus', '--sync', chooser);
  xd('key', '--clearmodifiers', 'ctrl+l');
  xd('type', '--clearmodifiers', '--delay', '1', target);
  xd('key', 'Return');
  await sleep(400);
  if (windows().includes(chooser)) xd('key', 'Return');
  await until(() => !windows().includes(chooser), `dialog close for ${target}`);
}

const fixture = path.join(scratch, 'installed-issue-source.pdf');
const output = path.join(scratch, 'installed-issue-package.zip');
const document = await PDFDocument.create();
for (let page = 1; page <= 3; page++) {
  document.addPage([612, 792]).drawText(`Installed drawing ${page}`, { x: 80, y: 700, size: 22 });
}
const fixtureBytes = await document.save();
await writeFile(fixture, fixtureBytes);
const fixtureSha = createHash('sha256').update(fixtureBytes).digest('hex');
await call('app_set_window_size', { width: 1500, height: 950 }).catch(() => {});
assert.equal((await call('app_open_pdf', { path: fixture })).page_count, 3);
await until(async () => (await ui('.ws-access-tab[data-panel="sheets"]')).visible, 'drawing-set tab');
await click('.ws-access-tab[data-panel="sheets"]');
await until(async () => (await ui('#sheets-panel')).visible, 'drawing-set panel');
const addWindows = windows();
await click('#sheets-panel .sheets-actions button:first-child');
await nativeFileDialog(addWindows, fixture);
await until(async () => (await ui('#sheets-panel .sheets-count')).text?.includes('3 of 3'), 'three registered sheets');
await click('.sheets-revision-summary[aria-label="Transmittal readiness review"] > button.sheets-wide-action');
await until(async () => (await ui('[aria-label="Transmittal readiness review"]')).text?.includes('3 of 3 ready'), 'three verified source pages');
const first = await ui('.sheets-package-select input');
assert.equal(first.found, true, 'ready rows provide package selection');
await click('.sheets-package-select input:first-child');
await click('[aria-label="Transmittal readiness review"] > button.sheets-wide-action:last-of-type');
const preview = await until(async () => {
  const state = await ui('[data-set-package-preview]');
  return state.visible ? state : null;
}, 'one-page package preview');
assert.match(preview.text, /1 selected pages · 1 verified source PDFs/);
const saveWindows = windows();
await click('[data-set-package-preview] .sheets-actions button:first-child');
await nativeFileDialog(saveWindows, output.slice(0, -4));
await until(async () => {
  try { return (await stat(output)).size > 100; } catch { return false; }
}, 'written issue ZIP');
const files = await unzip(new Uint8Array(await readFile(output)));
assert.deepEqual([...files.keys()], ['manifest.json', 'current-sheets.pdf']);
const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
assert.equal(manifest.sheets.length, 1);
assert.equal(manifest.sheets[0].sourcePage, 1);
assert.equal(manifest.sheets[0].packagePage, 1);
assert.equal(manifest.sources[0].sha256, fixtureSha);
assert.ok(!JSON.stringify(manifest).includes(scratch), 'manifest excludes absolute source path');
const selectedPdf = await PDFDocument.load(files.get('current-sheets.pdf').slice());
assert.equal(selectedPdf.getPageCount(), 1);
assert.equal((await ui('#sheets-panel .sheets-count')).text?.includes('3 of 3'), true);
assert.equal(createHash('sha256').update(await readFile(fixture)).digest('hex'), fixtureSha);
console.log(`INSTALLED ISSUE PASS: three registered pages, one selected verified page, native ZIP ${output}, unchanged source/register.`);
