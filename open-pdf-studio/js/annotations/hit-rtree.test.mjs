// Hit-testing asks the markup R-tree before the per-type test. Far markups
// must not hide the one under the cursor, later entries still win, and a
// markup on another page stays out.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { findAnnotationAt, findAnnotationsAt } = await import('./geometry.js');

function box(over = {}) {
  return {
    type: 'box', page: 1, x: 0, y: 0, width: 40, height: 30,
    fillColor: '#ffffff', ...over,
  };
}

function opzet(annotations) {
  state.documents = [{
    id: 'hit-rtree',
    filePath: 'C:/hit/in.pdf',
    currentPage: 1,
    scale: 1,
    viewMode: 'single',
    annotations,
    selectedAnnotations: [],
    selectedAnnotation: null,
    undoStack: [],
    redoStack: [],
    savedUndoStackLength: 0,
    pdfDoc: { numPages: 2 },
    pageRotations: {},
    _annotationPagesReady: new Set([1, 2]),
    textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  state.currentTool = 'select';
}

test('hundreds of far boxes do not hide the line under the cursor', () => {
  const far = [];
  for (let i = 0; i < 400; i++) {
    far.push(box({
      id: `far${i}`,
      x: 2000 + (i % 20) * 60,
      y: 2000 + Math.floor(i / 20) * 50,
    }));
  }
  const line = { id: 'under', type: 'line', page: 1, startX: 10, startY: 40, endX: 120, endY: 40 };
  opzet([...far, line]);
  assert.equal(findAnnotationAt(60, 40, 1)?.id, 'under');
});

test('two stacked boxes: the later array entry wins', () => {
  const earlier = box({ id: 'earlier', x: 10, y: 10, width: 50, height: 50 });
  const later = box({ id: 'later', x: 10, y: 10, width: 50, height: 50, fillColor: '#000000' });
  opzet([earlier, later]);
  assert.equal(findAnnotationAt(30, 30, 1)?.id, 'later');
  const stack = findAnnotationsAt(30, 30, 1);
  assert.deepEqual(stack.map((a) => a.id), ['later', 'earlier']);
});

test('a box on another page is not a hit', () => {
  opzet([box({ id: 'other', page: 2, x: 10, y: 10, width: 50, height: 50 })]);
  assert.equal(findAnnotationAt(30, 30, 1), null);
});

test('the angle arc outside the three-point box is still a hit', () => {
  const angle = {
    id: 'angle', type: 'measureAngle', page: 1, arcRadius: 30,
    vertex: { x: 100, y: 100 },
    point1: { x: 110, y: 100 },
    point2: { x: 100, y: 110 },
  };
  opzet([angle]);
  const rad = 10 * Math.PI / 180;
  const x = 100 + 30 * Math.cos(rad);
  const y = 100 + 30 * Math.sin(rad);
  assert.equal(findAnnotationAt(x, y, 1)?.id, 'angle');
});

test('a click on the dimension number selects the measurement', () => {
  const dim = {
    id: 'dim', type: 'measureDistance', page: 1,
    startX: 0, startY: 100, endX: 200, endY: 100,
    fontSize: 18, measureText: "24'-0\"",
    startHead: 'none', endHead: 'none',
  };
  opzet([dim]);
  assert.equal(findAnnotationAt(100, 85, 1)?.id, 'dim');
  assert.equal(findAnnotationAt(100, 100, 1)?.id, 'dim');
  assert.equal(findAnnotationAt(100, 70, 1), null);
  opzet([{ ...dim, id: 'in', dimTextPosition: 'inline' }]);
  assert.equal(findAnnotationAt(100, 85, 1), null);
  assert.equal(findAnnotationAt(100, 100, 1)?.id, 'in');
});

test('replacing a markup with the same geometry still selects it', () => {
  opzet([box({ id: 'keep', x: 10, y: 10, width: 50, height: 50 })]);
  assert.equal(findAnnotationAt(30, 30, 1)?.id, 'keep');
  const anns = state.documents[0].annotations;
  anns[0] = JSON.parse(JSON.stringify(anns[0]));
  assert.equal(findAnnotationAt(30, 30, 1)?.id, 'keep');
});

test('a broken markup does not swallow the click on the box under it', () => {
  const keep = box({ id: 'keep', x: 90, y: 120, width: 40, height: 40 });
  const spline = {
    id: 'bad-spline', type: 'spline', page: 1,
    controlPoints: [undefined, { x: 0, y: 0 }, { x: 5, y: 0 }],
  };
  const poly = {
    id: 'bad-poly', type: 'polygon', page: 1,
    points: [undefined, undefined, undefined],
  };
  const area = {
    id: 'bad-area', type: 'measureArea', page: 1,
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }],
    holes: [[undefined, { x: 150, y: 110 }, { x: 160, y: 110 }]],
  };
  opzet([keep, spline, poly, area]);
  assert.equal(findAnnotationAt(110, 140, 1)?.id, 'keep');
});

test('the visible page wins when the document page has not caught up', () => {
  const p1 = box({ id: 'p1', page: 1, x: 10, y: 10, width: 40, height: 40 });
  const p2 = box({ id: 'p2', page: 2, x: 10, y: 10, width: 40, height: 40 });
  opzet([p1, p2]);
  state.documents[0].currentPage = 1;
  const prev = window.__pdfViewport;
  window.__pdfViewport = {
    active: true,
    filePath: state.documents[0].filePath,
    pageNum: 2,
    zoom: 1,
  };
  try {
    assert.equal(findAnnotationAt(30, 30)?.id, 'p2');
    assert.equal(findAnnotationAt(30, 30, 1)?.id, 'p1');
  } finally {
    if (prev === undefined) delete window.__pdfViewport;
    else window.__pdfViewport = prev;
  }
});
