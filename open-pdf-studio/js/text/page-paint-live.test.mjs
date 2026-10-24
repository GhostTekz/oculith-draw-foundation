// The page bitmap stays painted while text is selected or edited.
// WebKitGTK shows a composited canvas's white background for that whole
// interval. isolation plus the highlight blend is what promotes #pdf-canvas;
// html.pdf-text-live drops both, and a 0° editor must not add a transform.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PAGE_EDITOR_OPEN_CLASS,
  PAGE_PAINT_LIVE_CLASS,
  applyPagePaintLive,
  bindPagePaintLive,
  pagePaintIsLive,
  setTextEditorPaint,
  textLayerHasSelection,
  withoutFlatTransform,
} from './page-paint-live.js';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const zonderCommentaar = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('0° editor style does not use a transform', () => {
  assert.deepEqual(withoutFlatTransform({ left: '1px', transform: 'rotate(0deg)', 'transform-origin': '0 0' }), { left: '1px' });
  assert.deepEqual(withoutFlatTransform({ transform: 'none' }), {});
  assert.equal(withoutFlatTransform({ transform: 'rotate(90deg)' }).transform, 'rotate(90deg)');
  assert.equal(withoutFlatTransform({ left: '2px' }).left, '2px');

  const markup = lees('../solid/components/TextEditOverlay.jsx');
  assert.match(markup, /transform: gedraaid \? `rotate\(\$\{gedraaid\}deg\)` : 'none'/);

  const pdf = lees('../solid/components/PdfTextEditOverlay.jsx');
  assert.match(pdf, /withoutFlatTransform\(editorStyle\(\)\)/);
  assert.match(pdf, /hoek \? \{ transform: `rotate\(\$\{hoek\}deg\)`/);
  const tool = lees('../tools/text-edit-tool.js');
  assert.match(tool, /if \(\(\(schermRotatie % 360\) \+ 360\) % 360\) \{\s*styleObj\.transform = `rotate\(\$\{schermRotatie\}deg\)`;/);
  assert.match(tool, /if \(kader\.theta\) \{\s*styleObj\.transform = `rotate\(\$\{kader\.theta\}deg\)`;/);
});

test('live text drops isolation and multiply, and does not promote the page canvases', () => {
  const css = zonderCommentaar(lees('../../styles/layout.css'));
  assert.match(css, /#canvas-container \{\s*position: relative;[\s\S]*?isolation: isolate;/);
  assert.match(css, /#text-highlight-canvas \{[^}]*mix-blend-mode: multiply;/);
  assert.match(css, new RegExp(
    `html\\.${PAGE_PAINT_LIVE_CLASS} #canvas-container,[\\s\\S]*?isolation: auto;`,
  ));
  assert.match(css, new RegExp(
    `html\\.${PAGE_PAINT_LIVE_CLASS} #text-highlight-canvas,[\\s\\S]*?mix-blend-mode: normal;`,
  ));
  assert.match(css, new RegExp(
    `html\\.${PAGE_PAINT_LIVE_CLASS} #pdf-canvas,[\\s\\S]*?filter: none;`,
  ));
  assert.match(css, new RegExp(
    `html\\.${PAGE_PAINT_LIVE_CLASS} #pdf-canvas,[\\s\\S]*?box-shadow: none;`,
  ));
  assert.match(css, new RegExp(
    `html\\.${PAGE_EDITOR_OPEN_CLASS} \\.textLayer,[\\s\\S]*?transform: none !important;`,
  ));
  assert.doesNotMatch(css, /translateZ|will-change/);
  for (const id of ['#pdf-canvas', '#pdf-detail-canvas', '#annotation-canvas', '#text-highlight-canvas']) {
    assert.ok(css.includes(id), id);
  }
});

test('the page-paint class follows the editor and a text-layer selection', () => {
  const classes = new Set();
  let selection = null;
  let active = null;
  const listeners = {};
  const prev = globalThis.document;
  globalThis.document = {
    documentElement: {
      classList: {
        toggle(name, on) {
          if (on) classes.add(name);
          else classes.delete(name);
        },
      },
    },
    body: { nodeType: 1 },
    get activeElement() { return active; },
    getSelection() { return selection; },
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  try {
    assert.equal(pagePaintIsLive(), false);
    setTextEditorPaint('markup', true);
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), true);
    assert.equal(classes.has(PAGE_EDITOR_OPEN_CLASS), true, 'an open editor drops the zoomed text-layer matrix');
    setTextEditorPaint('markup', false);
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), false);
    assert.equal(classes.has(PAGE_EDITOR_OPEN_CLASS), false);

    const laag = {
      nodeType: 1,
      closest: (sel) => (sel === '.textLayer' ? laag : null),
    };
    selection = { isCollapsed: false, rangeCount: 1, anchorNode: laag, focusNode: laag };
    assert.equal(textLayerHasSelection(), true);
    applyPagePaintLive();
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), true);
    assert.equal(classes.has(PAGE_EDITOR_OPEN_CLASS), false, 'a text selection keeps the layer matrix');

    selection = { isCollapsed: true, rangeCount: 1, anchorNode: laag, focusNode: laag };
    applyPagePaintLive();
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), false, 'collapsed selection restores isolation');

    const buiten = { nodeType: 1, closest: () => null };
    selection = { isCollapsed: false, rangeCount: 1, anchorNode: buiten, focusNode: buiten };
    applyPagePaintLive();
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), false, 'a selection outside the text layer does not count');

    setTextEditorPaint('pdf', true);
    selection = { isCollapsed: true, rangeCount: 0, anchorNode: null, focusNode: null };
    applyPagePaintLive();
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), true, 'an open editor keeps the page flat');
    setTextEditorPaint('pdf', false);

    active = {
      nodeType: 1,
      isContentEditable: true,
      classList: { contains: (c) => c === 'pdf-text-editor' },
    };
    applyPagePaintLive();
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), true);
    active = null;
    applyPagePaintLive();
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), false);

    active = {
      nodeType: 1,
      isConnected: false,
      isContentEditable: true,
      classList: { contains: (c) => c === 'inline-text-editor' },
    };
    applyPagePaintLive();
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), false, 'a detached editor does not keep the page flat');
    active = null;

    bindPagePaintLive();
    assert.equal(typeof listeners.selectionchange, 'function');
    selection = { isCollapsed: false, rangeCount: 1, anchorNode: laag, focusNode: laag };
    listeners.selectionchange();
    assert.equal(classes.has(PAGE_PAINT_LIVE_CLASS), true);
    bindPagePaintLive();
    assert.equal(listeners.selectionchange !== undefined, true);
  } finally {
    setTextEditorPaint('markup', false);
    setTextEditorPaint('pdf', false);
    globalThis.document = prev;
  }
});

test('editors and text selection arm the page-paint class', () => {
  const markup = lees('../solid/stores/textEditOverlayStore.js');
  const pdf = lees('../solid/stores/pdfTextEditStore.js');
  const selectie = lees('./text-selection.js');
  assert.match(markup, /setTextEditorPaint\('markup', true\)/);
  assert.match(markup, /setTextEditorPaint\('markup', false\)/);
  assert.match(pdf, /setTextEditorPaint\('pdf', true\)/);
  assert.match(pdf, /setTextEditorPaint\('pdf', false\)/);
  assert.match(selectie, /bindPagePaintLive\(\)/);
});
