// Spaces survive save → reopen → save → reopen with real PDF bytes: the
// stored spaces in /OPS_Spaces, the floor-plan rooms as annotations (with
// their space colour), and the Space of every markup. Page 2 is a /Rotate 90
// sheet with an offset CropBox, so the outline goes through the same
// app ↔ user-space conversion as the markups.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { degrees, PDFArray, PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { savePDF } = await import('../pdf/saver.js');
const { convertPdfAnnotation } = await import('../pdf/loader/annotation-converter.js');
const { extractAnnotationColors } = await import('../pdf/loader/color-extraction.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { readSpaces, SPACES_KEY } = await import('./pdf-spaces.js');
const { collectSpaces, markupSpacePather, markupAnchor, takeOverSpaces } = await import('./model.js');
const { fixture } = await import('./spaces-fixture.testhulp.mjs');
const undoManager = await import('../core/undo-manager.js');
const actions = await import('./actions.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

// Page 2: MediaBox 900×700, CropBox [100 50 900 650] (800×600), /Rotate 90 →
// shown 600 wide and 800 high. Its fixture is page 1's, transposed.
const T = (p) => ({ x: p.y, y: p.x });
function transposed(obj, page) {
  const o = { ...obj, page };
  if (Array.isArray(o.points)) o.points = o.points.map(T);
  if (o.opsRuimteZaad) o.opsRuimteZaad = T(o.opsRuimteZaad);
  if (Number.isFinite(o.startX)) Object.assign(o, { startX: obj.startY, startY: obj.startX, endX: obj.endY, endY: obj.endX });
  if (Number.isFinite(o.x) && Number.isFinite(o.width)) Object.assign(o, { x: obj.y, y: obj.x, width: obj.height, height: obj.width });
  return o;
}

// Markup types that keep their geometry through the saver and loader.
const KEEP = new Set(['box', 'line', 'measureArea', 'polygon', 'circle', 'measureDistance', 'polyline', 'arrow']);
function sourceModel() {
  const f = fixture();
  // m3 (count), m5 (cloud), m6 (stamp), m8 (textbox), m10 (comment, page 2) as boxes, circles and
  // polygons with the same anchors, so every markup is one this harness can reopen and match.
  const swap = { m3: { type: 'box' }, m5: { type: 'polygon' }, m6: { type: 'circle' }, m8: { type: 'box' } };
  const page1 = f.annotations.filter(a => a.page === 1).map(a => ({ ...a, ...(swap[a.id] || {}) }));
  page1.find(a => a.id === 'kitchen').opsSpaceColor = '#d4a017';
  page1.find(a => a.id === 'living').opsSpaceHidden = true;
  const page2 = page1.map(a => transposed({ ...a, id: `${a.id}-p2` }, 2));
  const annotations = [...page1, ...page2].map(a => createAnnotation({
    ...a, ...(a.type === 'box' || a.type === 'circle' ? { strokeColor: '#ff0000', color: '#ff0000' } : {}),
  }));
  const spaces = [...f.spaces, ...f.spaces.map(s => ({ ...transposed(s, 2), id: `${s.id}-p2` }))];
  return { annotations, spaces };
}

function openDocument(annotations, spaces, extra = {}) {
  state.documents = [{ id: `spaces-rt-${Math.random()}`, filePath: 'C:/spaces/input.pdf', pdfDoc: { numPages: 2 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations, spaces, measureScale: null, pageRotations: {},
    _annotationPagesReady: new Set([1, 2]), textEdits: [], undoStack: [], redoStack: [], savedUndoStackLength: 0,
    selectedAnnotations: [], ...extra }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function save(bytes) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_p, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_p, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF('C:/spaces/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

async function reopen(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  try {
    const lib = await PDFDocument.load(bytes.slice());
    const annotations = [];
    for (const pageNum of [1, 2]) {
      const page = await reader.getPage(pageNum);
      const colors = await extractAnnotationColors(pageNum, lib);
      for (const a of await page.getAnnotations()) {
        const m = await convertPdfAnnotation(a, pageNum, page.getViewport({ scale: 1 }), new Map(), colors);
        if (m) annotations.push(m);
      }
    }
    const doc = { annotations, spaces: [] };
    takeOverSpaces(doc, readSpaces(lib));
    return { lib, doc };
  } finally {
    await task.destroy();
  }
}

async function sourcePdf() {
  const src = await PDFDocument.create();
  src.addPage([800, 600]);
  const p2 = src.addPage([900, 700]);
  p2.setCropBox(100, 50, 800, 600);
  p2.setRotation(degrees(90));
  return src.save();
}

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

/** Each original markup's Space, found again in the reopened document by type and anchor. */
function assertSameSpaces(original, reopened) {
  const before = markupSpacePather(original);
  const after = markupSpacePather(reopened);
  let matched = 0;
  for (const a of original.annotations) {
    const pa = markupAnchor(a);
    const twin = reopened.annotations.find(b => b.page === a.page && b.type === a.type
      && (() => { const pb = markupAnchor(b); return pb && near(pa.x, pb.x, 0.6) && near(pa.y, pb.y, 0.6); })());
    assert.ok(twin, `${a.id} (${a.type}) reopens at its place`);
    assert.equal(after(twin), before(a), `${a.id}: Space`);
    matched += 1;
  }
  return matched;
}

function assertSameOutlines(original, reopened) {
  const want = collectSpaces(original);
  const got = collectSpaces(reopened);
  assert.equal(got.length, want.length);
  for (const s of want) {
    const t = s.source === 'room'
      ? got.find(g => g.source === 'room' && g.page === s.page && g.name === s.name)
      : got.find(g => g.id === s.id);
    assert.ok(t, `${s.id} reopens`);
    assert.deepEqual([t.name, t.color, t.hidden, t.page, t.path.join('/')], [s.name, s.color, s.hidden, s.page, s.path.join('/')], s.id);
    assert.equal(t.points.length, s.points.length, `${s.id} corners`);
    s.points.forEach((p, i) => assert.ok(near(p.x, t.points[i].x) && near(p.y, t.points[i].y),
      `${s.id} corner ${i}: ${JSON.stringify(p)} vs ${JSON.stringify(t.points[i])}`));
  }
}

test('spaces, rooms and the Space of 10 markups survive two saves, also on a /Rotate 90 sheet with an offset CropBox', async () => {
  const { annotations, spaces } = sourceModel();
  for (const a of annotations) assert.ok(KEEP.has(a.type), a.type);
  const original = openDocument(annotations, spaces);
  const expected = { annotations: original.annotations.map(a => ({ ...a })), spaces: original.spaces.map(s => ({ ...s })) };

  const first = await save(await sourcePdf());
  const { lib: lib1, doc: once } = await reopen(first);
  // Raw file: one /OPS_Spaces array per page, the rotated page's outline in user space inside its CropBox.
  for (const i of [0, 1]) {
    const arr = lib1.getPages()[i].node.lookup(PDFName.of(SPACES_KEY));
    assert.ok(arr instanceof PDFArray && arr.size() === 2, `page ${i + 1} has its two stored spaces`);
  }
  const path2 = lib1.getPages()[1].node.lookup(PDFName.of(SPACES_KEY)).lookup(0).lookup(PDFName.of('Path')).asArray().map(n => n.asNumber());
  for (let k = 0; k < path2.length; k += 2) {
    assert.ok(path2[k] >= 100 - 1e-6 && path2[k] <= 900 + 1e-6 && path2[k + 1] >= 50 - 1e-6 && path2[k + 1] <= 650 + 1e-6,
      `user-space corner ${path2[k]},${path2[k + 1]}`);
  }
  assertSameOutlines(expected, once);
  assert.equal(assertSameSpaces(expected, once), 22, '11 markups and rooms on each page');

  // Second save from the reopened model.
  openDocument(once.annotations, once.spaces, { _spacesRead: true });
  const second = await save(first);
  const { doc: twice } = await reopen(second);
  assertSameOutlines(expected, twice);
  assertSameSpaces(expected, twice);
  const p1 = markupSpacePather(twice);
  const values = twice.annotations.filter(a => a.page === 1 && !a.opsRuimteNaam).map(p1).sort();
  assert.deepEqual(values, ['', 'Kitchen', 'Kitchen', 'Living', 'Living', 'Office', 'Office',
    'Office ▸ Closet', 'Office ▸ Closet'].sort());
});

test('while the file\'s spaces are not read yet the saver keeps them; once read, a deleted space is gone', async () => {
  const { annotations, spaces } = sourceModel();
  openDocument(annotations, spaces);
  const first = await save(await sourcePdf());
  openDocument([], [], { _spacesRead: false });
  const kept = await save(first);
  assert.equal(readSpaces(await PDFDocument.load(kept)).length, 4, 'not read yet: kept');
  openDocument([], [{ ...spaces[0] }], { _spacesRead: true });
  const replaced = await save(first);
  assert.deepEqual(readSpaces(await PDFDocument.load(replaced)).map(s => s.id), ['office']);
});

test('panel actions: add, rename, recolour, parent, hide and delete are undoable steps', async () => {
  const doc = openDocument(fixture().annotations.map(a => createAnnotation(a)), []);
  const id = actions.addSpace({ page: 1, points: [{ x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 600 }, { x: 0, y: 600 }] });
  assert.ok(id);
  assert.equal(doc.spaces[0].name, 'Space 1');
  assert.ok(actions.renameSpace(id, 'Office'));
  assert.ok(actions.recolorSpace(id, '#112233'));
  const closet = actions.addSpace({ page: 1, name: 'Closet', points: [{ x: 300, y: 500 }, { x: 400, y: 500 }, { x: 400, y: 600 }, { x: 300, y: 600 }] });
  assert.ok(actions.setSpaceParent(closet, 'room:' + doc.annotations[0].id));
  assert.equal(collectSpaces(doc).find(s => s.id === closet).path.join('/'), 'Kitchen/Closet');
  assert.ok(actions.setSpaceHidden(id, true));
  assert.equal(doc.spaces[0].hidden, true);
  assert.equal(doc.undoStack.filter(c => c.type === 'modifySpaces').length, 6);
  await undoManager.undo();
  assert.equal(doc.spaces[0].hidden, false, 'undo restores the outline');
  await undoManager.undo();
  assert.equal(collectSpaces(doc).find(s => s.id === closet).path.join('/'), 'Office/Closet', 'undo: back to geometry');
  await undoManager.redo();
  assert.equal(collectSpaces(doc).find(s => s.id === closet).path.join('/'), 'Kitchen/Closet');
  // A room: renamed and recoloured on the annotation itself; deleting it deletes the room.
  const kitchen = 'room:' + doc.annotations[0].id;
  assert.ok(actions.renameSpace(kitchen, 'Pantry'));
  assert.equal(doc.annotations[0].opsRuimteNaam, 'Pantry');
  assert.ok(actions.recolorSpace(kitchen, '#00ff00'));
  assert.equal(doc.annotations[0].opsSpaceColor, '#00ff00');
  const count = doc.annotations.length;
  assert.ok(actions.deleteSpace(kitchen));
  assert.equal(doc.annotations.length, count - 1);
  await undoManager.undo();
  assert.equal(doc.annotations.length, count);
  assert.ok(actions.deleteSpace(id));
  assert.equal(doc.spaces.some(s => s.id === id), false);
  // From selection: the area measurement m4 becomes a space with its outline.
  const m4 = doc.annotations.find(a => a.id === 'm4');
  doc.selectedAnnotations = [m4, doc.annotations.find(a => a.id === 'living')];
  const r = actions.addSpacesFromSelection();
  assert.deepEqual([r.added.length, r.rooms], [1, 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(doc.spaces.at(-1).points)), m4.points.map(p => ({ x: p.x, y: p.y })));
});
