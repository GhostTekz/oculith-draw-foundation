import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { bewaar, leegmaken as wisBronnen } from './vector-snippet-store.js';
import { bereidKnipselsVoorUitvoer, bitmapVoor, leegmaken } from './vector-snippet-preview.js';

let calls = [], grants = [], removed = [], closed = 0, fail = false, writeFail = false;
let nextBacking = 0;
// Zoals Tauri: schrijven mag alleen naar het exact gereserveerde bestand.
const scope = new Set();
globalThis.window = { devicePixelRatio: 1, __TAURI__: {
  fs: {
    writeFile: async (pad) => {
      if (!scope.has(pad)) throw new Error(`forbidden path: ${pad}`);
      if (writeFail) throw new Error('disk full');
    },
    remove: async (pad) => { removed.push(pad); scope.delete(pad); },
  },
  core: { invoke: async (name, args) => {
    if (name === 'create_vector_snippet_backing') {
      assert.equal(args, undefined);
      const pad = `/app-cache/snippets/opds-snippet-${++nextBacking}.pdf`;
      scope.add(pad); grants.push(pad);
      return pad;
    }
    assert.equal(name, 'render_pdf_page_region');
    calls.push(args);
    if (fail) throw new Error('render failed');
    const w = Math.ceil(args.regionWPt * args.scale), h = Math.ceil(args.regionHPt * args.scale);
    const data = new Uint8Array(8 + w * h * 4); const view = new DataView(data.buffer);
    view.setUint32(0, w, true); view.setUint32(4, h, true); return data;
  } },
} };
globalThis.ImageData = class { constructor(rgba, width, height) { Object.assign(this, { rgba, width, height }); } };
globalThis.createImageBitmap = async i => ({ width: i.width, height: i.height, close() { closed++; } });
globalThis.requestAnimationFrame = () => 1; // achtergrondvenster: RAF wordt niet uitgevoerd
async function annotation() {
  leegmaken(); wisBronnen(); scope.clear(); calls = []; grants = []; removed = [];
  closed = 0; fail = false; writeFail = false; nextBacking = 0;
  const pdf = await PDFDocument.create(); pdf.addPage([1000, 1000]);
  return { type: 'vectorSnippet', snippetKey: bewaar(await pdf.save()), srcBox: { left: 0, bottom: 0, right: 1000, top: 1000 }, width: 100, height: 100 };
}
test('uitvoer wacht zonder animation frame op juiste schaal en geeft geen placeholder', async () => {
  const ann = await annotation();
  const result = await bereidKnipselsVoorUitvoer([ann], 3);
  assert.ok(Math.abs(result.get(ann).width - 300) <= 1);
  assert.ok(Math.abs(calls[0].scale - 0.3) < 1e-12);
  assert.deepEqual(grants, [calls[0].path]);
  assert.match(calls[0].path, /^\/app-cache\/snippets\/opds-snippet-\d+\.pdf$/);
  assert.equal(scope.has('/app-cache/snippets/neighbor.pdf'), false);
  for (const b of result.values()) b.close();
});
test('mislukte uitvoer werpt fout in plaats van stil een placeholder te drukken', async () => {
  const ann = await annotation(); fail = true;
  await assert.rejects(bereidKnipselsVoorUitvoer([ann], 1), /render failed/);
});
test('mislukte schrijfactie verwijdert het gereserveerde mini-PDF', async () => {
  const ann = await annotation();
  writeFail = true;
  await assert.rejects(bereidKnipselsVoorUitvoer([ann], 1), /disk full/);
  assert.deepEqual(removed, grants);
  assert.equal(calls.length, 0);
});
test('schermpreview volgt plaatsingsmaat en gebruikt scherpere cache bij uitzoomen', async () => {
  const ann = await annotation();
  assert.equal(bitmapVoor(ann, 2), null);
  await new Promise(r => setTimeout(r, 40));
  const bitmap = bitmapVoor(ann, 2);
  assert.equal(bitmap.width, 250);
  assert.equal(bitmapVoor(ann, 1), bitmap);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(grants.length, 1);
});
