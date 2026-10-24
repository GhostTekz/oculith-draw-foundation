// Run against a local debug app launched with --mcp-server --mcp-port 9323.
// Creates only temporary PDFs; verifies a real native open, line markup,
// save and reopen through the live WebView bridge.
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const port = Number(process.argv[2] || 9323);
const endpoint = `http://127.0.0.1:${port}/mcp`;
let requestId = 0;

async function call(name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      jsonrpc: '2.0', id: ++requestId, method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  assert.equal(response.status, 200, `${name}: HTTP status`);
  const body = await response.json();
  assert.equal(body.error, undefined, `${name}: ${JSON.stringify(body.error)}`);
  const result = JSON.parse(body.result.content.find(item => item.type === 'text').text);
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}

const directory = await mkdtemp(join(tmpdir(), 'oculith-native-markup-'));
const source = join(directory, 'source.pdf');
const saved = join(directory, 'saved.pdf');
const document = await PDFDocument.create();
document.addPage([420, 300]);
await writeFile(source, await document.save());

const opened = await call('app_open_pdf', { path: source });
assert.equal(opened.page_count, 1);
const created = await call('app_create_annotation', {
  type: 'line', page: 1,
  props: { startX: 70, startY: 180, endX: 240, endY: 140,
    color: '#ff0000', lineWidth: 2 },
});
assert.ok(created.id);
const before = await call('app_list_annotations', { page: 1 });
assert.ok(before.annotations.some(item => item.id === created.id));

await call('app_save_pdf', { path: saved });
assert.ok((await stat(saved)).size > 0);
const reopened = await call('app_open_pdf', { path: saved });
assert.equal(reopened.page_count, 1);
const after = await call('app_list_annotations', { page: 1 });
assert.ok(after.annotations.some(item => item.type === 'line'
  && item.startX === 70 && item.endX === 240),
`line markup missing after reopen: ${JSON.stringify(after.annotations)}`);

console.log(JSON.stringify({ ok: true, source, saved,
  annotationsAfterReopen: after.annotations.length }));
