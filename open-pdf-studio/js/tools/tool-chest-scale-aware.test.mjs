// Scale-aware Tool Chest sets (the external editor): a named set records the drawing scale
// its Drawing Mode tools were made for. Placed on a page with another
// calibrated scale, the saved geometry resizes proportionally; uncalibrated
// pages, Properties Mode and sets without a reference keep the saved size.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scaleToolGeometry } from './tool-preset-geometry.js';
import { buildPortableToolSetBytes, parsePortableToolSetBytes, TOOL_SET_SEQUENCE_VERSION } from './tool-set-portable.js';

// 1:100 in mm: 72/25.4/100 pt per real mm. 1:50 is twice as large on paper.
const scale = (n, unit = 'mm') => ({ pixelsPerUnit: 72 / 25.4 / n * ({ mm: 1, m: 1000, ft: 304.8 }[unit]), unit });

test('relative geometry scales every length and keeps rotation', () => {
  assert.deepEqual(scaleToolGeometry('line', { kind: 'line', dx: 10, dy: -4 }, 2), { kind: 'line', dx: 20, dy: -8 });
  assert.deepEqual(scaleToolGeometry('box', { kind: 'box', width: 10, height: 5, rotation: 30 }, 0.5),
    { kind: 'box', width: 5, height: 2.5, rotation: 30 });
  assert.deepEqual(scaleToolGeometry('polyline', { kind: 'path', points: [{ x: 0, y: 0 }, { x: 3, y: 4 }] }, 3).points,
    [{ x: 0, y: 0 }, { x: 9, y: 12 }]);
  const callout = { kind: 'callout', boxDx: 110, boxDy: -50, width: 170, height: 70, kneeDx: 85, kneeDy: -15, armDx: 110, armDy: -15 };
  assert.deepEqual(scaleToolGeometry('callout', callout, 2), { kind: 'callout', boxDx: 220, boxDy: -100, width: 340,
    height: 140, kneeDx: 170, kneeDy: -30, armDx: 220, armDy: -30 });
  assert.equal(scaleToolGeometry('box', { kind: 'box', width: 90000, height: 5, rotation: 0 }, 2), null, 'beyond the limits');
  assert.equal(scaleToolGeometry('box', { kind: 'box', width: 9, height: 5, rotation: 0 }, 0), null);
});

test('a Drawing Mode tool of a scale-aware set resizes to the scale at the placement point', async () => {
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const tools = await import(`./tool-chest-presets.js?scaleAware=${Date.now()}`);
    // Page 1 at 1:100 (mm), page 2 at 1:50 expressed in metres, page 3 uncalibrated,
    // page 4: a viewport at 1:200 in feet right of x=500.
    tools.setToolChestScaleResolver((page, x) => page === 1 ? { ...scale(100), calibrated: true }
      : page === 2 ? { ...scale(50, 'm'), calibrated: true }
        : page === 4 ? { ...scale(x > 500 ? 200 : 100, 'ft'), calibrated: true }
          : { pixelsPerUnit: 1, unit: 'pt', calibrated: false });
    const set = tools.createToolSet('Doors 1:100');
    assert.equal(tools.setToolSetReferenceScale(set.id, { pixelsPerUnit: -1, unit: 'mm' }), null);
    assert.equal(tools.setToolSetReferenceScale(set.id, { ...scale(100), unit: 'pt' }), null, 'a scale needs a real unit');
    assert.deepEqual(tools.setToolSetReferenceScale(set.id, scale(100)).referenceScale, scale(100));
    assert.equal(tools.referenceScaleRatio(scale(100)), 100);
    const door = tools.saveToolPreset({ type: 'box', strokeColor: '#123456', x: 5, y: 5, width: 40, height: 20 }, 'Door', set.id);
    const plain = tools.saveToolPreset({ type: 'box', strokeColor: '#654321', x: 5, y: 5, width: 40, height: 20 }, 'Plain');
    tools.toggleToolPresetMode(door.id);
    tools.toggleToolPresetMode(plain.id);
    const place = (preset, page, x = 100, y = 100) => {
      tools.activateToolPreset(preset.id);
      const placed = tools.applyActiveToolPreset('box', { type: 'box', page, x, y, width: 1, height: 1 }, x, y);
      return [placed.width, placed.height].map(v => Math.round(v * 1000) / 1000);
    };
    assert.deepEqual(place(door, 1), [40, 20], 'same scale: saved size');
    assert.deepEqual(place(door, 2), [80, 40], '1:50 page: twice the paper size, in another unit');
    assert.deepEqual(place(door, 3), [40, 20], 'uncalibrated page: saved size');
    assert.deepEqual(place(door, 4, 100), [40, 20], 'the scale at the point decides (1:100 in feet)');
    assert.deepEqual(place(door, 4, 600), [20, 10], 'a 1:200 viewport halves it');
    assert.deepEqual(place(plain, 2), [40, 20], 'My Tools have no reference scale');
    tools.toggleToolPresetMode(door.id);
    tools.activateToolPreset(door.id);
    assert.equal(tools.applyActiveToolPreset('box', { type: 'box', page: 2, x: 1, y: 1, width: 7, height: 3 }, 1, 1).width, 7,
      'Properties Mode keeps the drawn size');

    const bytes = tools.exportToolSet(set.id);
    const parsed = parsePortableToolSetBytes(bytes);
    assert.equal(parsed.version, TOOL_SET_SEQUENCE_VERSION);
    assert.deepEqual(parsed.referenceScale, scale(100));
    const imported = tools.importToolSet(bytes);
    assert.deepEqual(imported.set.referenceScale, scale(100));
    const reloaded = await import(`./tool-chest-presets.js?scaleAwareReload=${Date.now()}`);
    assert.deepEqual(reloaded.getToolChestSets().find(item => item.id === set.id).referenceScale, scale(100));
    assert.equal(reloaded.setToolSetReferenceScale(set.id, null).referenceScale, undefined, 'turn scale-aware off');
    assert.equal(parsePortableToolSetBytes(reloaded.exportToolSet(set.id)).version, 1, 'without a reference: version 1 again');
  } finally {
    globalThis.localStorage = previous;
  }
});

test('portable reference scale is exact and only in version 3', () => {
  const tools = [{ name: 'Door', tool: 'box', style: { strokeColor: '#123456' } }];
  const text = new TextDecoder().decode(buildPortableToolSetBytes('Doors', tools, scale(100)));
  const doc = JSON.parse(text);
  assert.equal(doc.version, 3);
  for (const bad of [{ ...scale(100), extra: 1 }, { pixelsPerUnit: 0, unit: 'mm' }, { pixelsPerUnit: 1, unit: 'pt' }]) {
    assert.throws(() => parsePortableToolSetBytes(new TextEncoder().encode(JSON.stringify({ ...doc, referenceScale: bad }))),
      /reference scale/u, JSON.stringify(bad));
  }
  assert.throws(() => parsePortableToolSetBytes(new TextEncoder().encode(JSON.stringify({ ...doc, version: 2 }))),
    /extra fields/u, 'version 2 has no reference scale');
});
