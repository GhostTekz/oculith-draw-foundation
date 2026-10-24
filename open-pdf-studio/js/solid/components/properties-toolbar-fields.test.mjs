// Properties toolbar (the external editor workspace WP4): which fields show for which
// markup type, and the toolbar's document state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TOOLBAR_FIELD_ORDER, fieldsForType, toolbarFields, toolbarFieldIds,
} from './properties-toolbar-fields.js';

const lees = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const LINE = ['typeMenu', 'lineColor', 'opacity', 'lineStyle', 'lineWidth'];
const FONT = ['fontFamily', 'fontSize', 'textColor', 'fontStyle'];

test('a line shows Line: colour, opacity, style and width; an arrow adds Start/End', () => {
  assert.deepEqual(toolbarFieldIds('line'), LINE);
  assert.deepEqual(toolbarFieldIds('arrow'), [...LINE, 'startHead', 'endHead']);
  assert.deepEqual(toolbarFieldIds('polyline'), LINE);
  assert.equal(fieldsForType('line').find((f) => f.id === 'lineColor').prop, 'strokeColor');
  assert.equal(fieldsForType('polyline').find((f) => f.id === 'lineColor').prop, 'color');
});

test('shapes, clouds and polygons add Fill and Hatch', () => {
  for (const type of ['box', 'circle', 'polygon', 'cloud']) {
    assert.deepEqual(toolbarFieldIds(type), [...LINE, 'fillColor', 'hatch'], type);
  }
});

test('text box and callout add Fill and Font with alignment; typewriter text is Font only', () => {
  for (const type of ['textbox', 'callout']) {
    assert.deepEqual(toolbarFieldIds(type), [...LINE, 'fillColor', ...FONT, 'textAlign'], type);
    assert.equal(fieldsForType(type).find((f) => f.id === 'fontSize').prop, 'textFontSize');
  }
  assert.deepEqual(toolbarFieldIds('text'), ['typeMenu', 'opacity', ...FONT]);
  assert.equal(fieldsForType('text').find((f) => f.id === 'fontSize').prop, 'fontSize');
});

test('measurements: lengths have heads, areas add fill and hatch, and the label size is on the toolbar', () => {
  assert.deepEqual(toolbarFieldIds('measureDistance'), [...LINE, 'startHead', 'endHead', 'fontSize']);
  assert.deepEqual(toolbarFieldIds('measurePerimeter'), [...LINE, 'startHead', 'endHead', 'fontSize']);
  assert.deepEqual(toolbarFieldIds('measureArea'), [...LINE, 'fillColor', 'hatch', 'fontSize']);
  for (const type of ['measureDistance', 'measureArea', 'measurePerimeter']) {
    assert.equal(fieldsForType(type).find((f) => f.id === 'fontSize').prop, 'fontSize', type);
  }
  assert.deepEqual(toolbarFieldIds('filledArea'), [...LINE, 'fillColor', 'hatch']);
  assert.ok(toolbarFieldIds(['measureDistance', 'measureArea']).includes('fontSize'));
  assert.equal(toolbarFields(['measureDistance', 'measureArea']).find((f) => f.id === 'fontSize').prop, 'fontSize');
  assert.ok(!toolbarFieldIds(['measureDistance', 'textbox']).includes('fontSize'));
});

test('a multi-selection shows only the fields every type has, with the same property', () => {
  assert.deepEqual(toolbarFieldIds(['measureDistance', 'measureDistance']), toolbarFieldIds('measureDistance'));
  assert.deepEqual(toolbarFieldIds(['line', 'box']), LINE);
  assert.deepEqual(toolbarFieldIds(['arrow', 'box']), LINE);
  // Highlight writes `color`, a box `strokeColor`: no shared line colour.
  assert.ok(!toolbarFieldIds(['highlight', 'box']).includes('lineColor'));
  assert.deepEqual(toolbarFieldIds(['textbox', 'text']), ['typeMenu', 'opacity', 'fontFamily', 'textColor', 'fontStyle']);
});

test('no selection gives no fields; Subject and Status are never toolbar fields', () => {
  assert.deepEqual(toolbarFields([]), []);
  assert.deepEqual(toolbarFields(undefined), []);
  const types = ['line', 'arrow', 'polyline', 'box', 'circle', 'polygon', 'cloud', 'textbox', 'callout', 'text',
    'comment', 'highlight', 'stamp', 'image', 'measureDistance', 'measureArea', 'measurePerimeter', 'count', 'scaleBar'];
  for (const type of types) {
    const ids = toolbarFieldIds(type);
    assert.equal(ids[0], 'typeMenu', type);
    assert.ok(!ids.includes('subject') && !ids.includes('status'), type);
    const order = ids.map((id) => TOOLBAR_FIELD_ORDER.indexOf(id));
    assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), `${type} follows the external editor order`);
  }
});

test('the toolbar has no caption, no Subject/Status, and keeps Layer and the Σ total', () => {
  const balk = lees('./PropertiesToolbar.jsx');
  assert.doesNotMatch(balk, /properties-toolbar-title/);
  assert.doesNotMatch(balk, /general\.subject|general\.status/);
  assert.match(balk, /toolbarFields\(selectionTypes\(\)\)/);
  assert.match(balk, /updateAnnotProp\(/, 'edits go through the panel setter and its undo path');
  assert.match(balk, /<LayerField id="properties-toolbar-layer" \/>/);
  assert.match(balk, /id="properties-toolbar-measure-total"/);
  // Document state: doc ▾, Name, Pages and Insert Blank Page.
  for (const key of ['toolbar.documentMenu', 'toolbar.name', 'toolbar.pages', 'toolbar.insertBlankPage']) {
    assert.ok(balk.includes(`t('${key}')`), key);
  }
  assert.match(balk, /showDocumentMenu/);
  assert.match(balk, /showInsertPageDialog\(\)/);
  const css = lees('../../../styles/properties-toolbar.css');
  assert.match(css.match(/\.properties-toolbar \{[^}]*\}/)[0], /height: 36px;/);
  for (const lang of ['en', 'nl']) {
    const nl = JSON.parse(lees(`../../i18n/locales/${lang}/properties.json`));
    for (const k of ['name', 'pages', 'line', 'start', 'end', 'fill', 'font', 'documentMenu', 'typeMenu', 'insertBlankPage']) {
      assert.ok(nl.toolbar?.[k], `${lang} properties.toolbar.${k}`);
    }
  }
});
