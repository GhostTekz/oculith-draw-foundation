// Markups Summary CSV with all three optional column groups at once:
// Attachments (capture.js), Space (Spaces panel) and the raceway columns
// (Tag, Raceway, Fittings, Bends). Built the way the Markups List exports it
// (AnnotationsPanel exportSummary: list order, replies, status history, page
// labels, the Space namer): every line, replies included, has the header's
// column count, and each value sits under its own header.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { invalidateScaleRegionCache } = await import('./scale-region.js');
const { list, store, showList } = await import('../ui/panels/annotations-list.testhulp.mjs');
const { fixture } = await import('../spaces/spaces-fixture.testhulp.mjs');
const { createRacewayAnnotation } = await import('../tools/raceway/raceway-creator.js');
const { markupCsv } = await import('./markup-csv.js');

const parse = (csv) => csv.replace(/^\uFEFF/u, '').trim().split('\r\n')
  .map(line => [...line.matchAll(/"((?:[^"]|"")*)"/gu)].map(m => m[1].replaceAll('""', '"')));

function openDocument() {
  const plain = { ...fixture(), filePath: 'C:/csv/plan.pdf', pdfDoc: {}, viewMode: 'single', selectedAnnotations: [],
    measureScale: { pixelsPerUnit: 18, unit: 'ft' }, pageRotations: {}, _annotationPagesReady: new Set([1, 2]),
    textEdits: [] };
  state.documents = [plain];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0]; // the state's own (reactive) copy
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  // A conduit run with a 90 inside the kitchen, a tray in the office.
  const run = createRacewayAnnotation([{ x: 40, y: 40 }, { x: 250, y: 40 }, { x: 250, y: 250 }],
    { kind: 'conduit', conduitType: 'EMT', tradeSize: '3/4', tag: 'C-1' }, 1);
  run.id = 'run';
  const tray = createRacewayAnnotation([{ x: 40, y: 380 }, { x: 200, y: 380 }],
    { kind: 'tray', trayStyle: 'ladder', widthIn: 12, railIn: 4 }, 1);
  tray.id = 'tray';
  doc.annotations.push(run, tray);
  // Photos on the kitchen box (m1), with a reply on it.
  const m1 = doc.annotations.find(a => a.id === 'm1');
  m1.capturePhotos = [
    { id: 'p1', name: 'site.jpg', mimeType: 'image/jpeg', date: '2026-10-14T09:00:00', dataUrl: 'data:image/jpeg;base64,AAAA' },
    { id: 'p2', name: 'detail.jpg', mimeType: 'image/jpeg', date: '2026-10-14T09:01:00', dataUrl: 'data:image/jpeg;base64,AAAA' },
  ];
  m1.replies = [{ author: 'B', text: 'Seen on site', createdAt: '2026-10-14T10:00:00Z' }];
  for (const a of doc.annotations) Object.assign(a, { author: a.author || 'A', createdAt: '2026-10-01T00:00:00Z' });
  return doc;
}

test('Attachments, Space and raceway columns export together, aligned on every line', () => {
  showList();
  const doc = openDocument();
  store.setColumnFilters({});
  store.setColumnSort(null);
  store.setSearchQuery('');
  store.setSortMode('page');
  list.updateAnnotationsList();
  const markups = list.currentListMarkups();
  assert.ok(markups.some(a => a.id === 'run') && markups.some(a => a.id === 'm1'));
  const options = { replyRows: true, statusHistory: true, latestStatusOnly: false, inListOrder: true,
    layerName: annotation => list.markupLayerName(doc, annotation),
    pageLabel: annotation => list.markupPageLabel(doc, annotation.page),
    spaceOf: list.markupSpaceNamer(doc) };
  assert.equal(typeof options.spaceOf, 'function');
  const rows = parse(markupCsv(doc.annotations, markups, doc.markupTextColumnName, doc.markupChoiceColumn,
    doc.markupNumberColumn, doc.markupCheckmarkColumn, doc.markupFormulaColumn, doc.markupTextColumn2Name,
    doc.markupChoiceColumn2, doc.markupNumberColumn2, options));
  const [header, ...lines] = rows;

  // Header order: … Page label, Attachments, Space, then the four raceway columns.
  assert.deepEqual(header.slice(-7), ['Page label', 'Attachments', 'Space', 'Tag', 'Raceway', 'Fittings', 'Bends']);
  assert.equal(new Set(header).size, header.length, 'no header twice');
  lines.forEach((line, index) => assert.equal(line.length, header.length,
    `line ${index + 1} (${line[1]}) has ${line.length} cells, the header ${header.length}`));

  const col = (name) => header.indexOf(name);
  const by = (pred) => lines.find(pred);
  const cell = (line, name) => line[col(name)];
  const run = by(line => line[1] === 'measureRaceway' && cell(line, 'Tag') === 'C-1');
  const tray = by(line => line[1] === 'measureRaceway' && cell(line, 'Tag') === '');
  const box = by(line => line[1] === 'box');
  const reply = by(line => line[1] === 'Reply' && line[5] === 'Seen on site');
  assert.ok(run && tray && box && reply);

  // The run: raceway values under the raceway headers, its space under Space.
  assert.equal(cell(run, 'Raceway'), '3/4" EMT');
  assert.equal(cell(run, 'Fittings'), '1 × 90°');
  assert.equal(cell(run, 'Bends'), '90°');
  assert.equal(cell(run, 'Space'), 'Kitchen');
  assert.equal(cell(run, 'Attachments'), '');
  assert.equal(cell(tray, 'Raceway'), '12" Ladder tray, 4" rail');
  assert.equal(cell(tray, 'Space'), 'Office');

  // The box: attachments and space, empty raceway cells.
  assert.equal(cell(box, 'Attachments'), 'site.jpg; detail.jpg');
  assert.equal(cell(box, 'Space'), 'Kitchen');
  assert.deepEqual(['Tag', 'Raceway', 'Fittings', 'Bends'].map(name => cell(box, name)), ['', '', '', '']);

  // A reply line: its markup's space, no attachments, no raceway values.
  assert.equal(cell(reply, 'Space'), 'Kitchen');
  assert.equal(cell(reply, 'Attachments'), '');
  assert.deepEqual(['Tag', 'Raceway', 'Fittings', 'Bends'].map(name => cell(reply, name)), ['', '', '', '']);

  // Every other line leaves the raceway columns empty.
  for (const line of lines.filter(l => l[1] !== 'measureRaceway')) {
    assert.deepEqual(line.slice(-4), ['', '', '', ''], `${line[1]} has no raceway values`);
  }
});
