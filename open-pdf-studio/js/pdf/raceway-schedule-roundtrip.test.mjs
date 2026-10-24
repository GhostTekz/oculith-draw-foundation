// A placed raceway schedule on real PDF bytes: runs drawn at 1/4" = 1'-0",
// the schedule table placed beside them, saved by the real saver and reopened
// by PDF.js + the annotation converter, with its columns and rows intact.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { PDFDocument } = await import('pdf-lib');
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { formatMeasurement } = await import('../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { measureKindType } = await import('../annotations/measure-extras.js');
const { createRacewayAnnotation } = await import('../tools/raceway/raceway-creator.js');
const { racewaySchedule, racewayScheduleTable } = await import('../quantities/raceway-schedule.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const QUARTER_INCH = { pixelsPerUnit: 18, unit: 'ft' };

function openDocument(annotations) {
  state.documents = [{ id: `rws-rt-${Math.random()}`, filePath: 'C:/rws/in.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations, measureScale: QUARTER_INCH, pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [], undoStack: [], redoStack: [], savedUndoStackLength: 0 }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.preferences.measureRounding = 'none';
  invalidateScaleRegionCache();
}

test('a placed raceway schedule saves and reopens with its rows', async () => {
  const src = await PDFDocument.create();
  src.addPage([1224, 792]);
  const bytes = await src.save();
  openDocument([]);
  const runs = [
    createRacewayAnnotation([{ x: 300, y: 300 }, { x: 660, y: 300 }, { x: 660, y: 480 }],
      { kind: 'conduit', tradeSize: '3/4', tag: 'F-1', marks: { 2: 'pull' } }, 1), // pull box at the end
    createRacewayAnnotation([{ x: 300, y: 340 }, { x: 480, y: 340 }], { kind: 'conduit', tradeSize: '3/4', tag: 'F-1' }, 1),
    createRacewayAnnotation([{ x: 300, y: 600 }, { x: 570, y: 600 }], { kind: 'tray', trayStyle: 'ladder', widthIn: 24 }, 1),
  ];
  const table = racewayScheduleTable(racewaySchedule(runs, { page: 1 }), { title: 'Raceway schedule', tag: 'Tag',
    size: 'Raceway', runs: 'Runs', length: 'Length', bends: 'Max bends',
    fitting: (k) => ({ pull: 'Pull box' })[k] ?? `${k}°` }, formatMeasurement);
  const placed = createAnnotation({ type: 'scheduleTable', page: 1, x: 36, y: 36, width: table.width,
    height: table.height, title: table.title, columns: table.columns, rows: table.rows,
    subject: 'Raceway schedule', color: '#000000', lineWidth: 0.5, opacity: 1 });
  openDocument([...runs, placed]);

  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_p, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_p, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF('C:/rws/out.pdf', { zonderHandtekeningVraag: true }), true);

  const task = pdfjs.getDocument({ data: saved.slice(), isEvalSupported: false, verbosity: 0 });
  const reopened = [];
  try {
    const page = await (await task.promise).getPage(1);
    const colors = await extractAnnotationColors(1, await PDFDocument.load(saved));
    for (const raw of await page.getAnnotations()) {
      const ann = await convertPdfAnnotation(raw, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (ann) reopened.push(ann);
    }
  } finally {
    await task.destroy();
  }
  // 20 ft + 10 ft + 10 ft less the 90° elbow's shortcut (developed length).
  const conduitLength = formatMeasurement({ value: runs[0].measureValue + runs[1].measureValue, unit: 'ft', calibrated: true });
  assert.match(conduitLength, /^39'-\d/u);
  const back = reopened.find(a => a.type === 'scheduleTable');
  assert.ok(back, 'the schedule comes back as a table');
  assert.equal(back.title, 'Raceway schedule');
  assert.deepEqual(back.columns, ['Tag', 'Raceway', 'Runs', 'Length', '90°', 'Pull box', 'Max bends']);
  assert.deepEqual(back.rows.map(r => r.cells), [
    ['F-1', '3/4" EMT', '2', conduitLength, '1', '1', '90°'],
    ['', '24" Ladder tray, 4" rail', '1', '15\'-0"', '', '', ''],
  ]);
  assert.ok(Math.abs(back.x - 36) < 0.5 && Math.abs(back.y - 36) < 0.5);
  assert.ok(Math.abs(back.width - table.width) < 0.5 && Math.abs(back.height - table.height) < 0.5);
  // The runs reopen too, so the schedule can be rebuilt from the saved file.
  const again = racewaySchedule(reopened.filter(a => measureKindType(a) === 'measureRaceway'));
  assert.deepEqual(again.map(r => [r.tag, r.size, r.count]), [['F-1', '3/4" EMT', 2], ['', '24" Ladder tray, 4" rail', 1]]);
});
