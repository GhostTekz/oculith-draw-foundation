// Tool Chest Properties and Drawing Mode for polylines, polygons, cloud
// polylines, typewriters, flags, built-in stamps and palette symbols. A
// preset keeps appearance and relative size only: never the source page,
// position, author, comment, replies, image data or SVG.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanToolGeometry, captureToolGeometry, applyDrawingGeometry } from './tool-preset-geometry.js';

const PRIVATE = { page: 7, author: 'PRIVATE AUTHOR', subject: 'PRIVATE COMMENT', replies: [{ text: 'PRIVATE REPLY' }],
  id: 'private-id', pdfPath: '/private/source.pdf' };

function withStorage(run) {
  return async () => {
    const values = new Map();
    const previous = globalThis.localStorage;
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    try { await run(values); } finally { globalThis.localStorage = previous; }
  };
}

function assertNoPrivate(values) {
  const stored = values.get('oculith-tool-chest-presets-v1') || '';
  for (const secret of ['PRIVATE', '/private/', 'private-id', '"page"', 'data:image', '<svg']) {
    assert.equal(stored.includes(secret), false, `${secret} cannot enter a local preset`);
  }
}

test('polyline paths are stored from their first vertex and placed at the click', () => {
  const source = { type: 'polyline', points: [{ x: 50, y: 60 }, { x: 90, y: 60 }, { x: 90, y: 20 }] };
  const geometry = captureToolGeometry(source);
  assert.deepEqual(geometry, { kind: 'path', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: -40 }] });
  assert.deepEqual(applyDrawingGeometry('polyline', { type: 'polyline', points: [{ x: 1, y: 1 }] }, geometry, 200, 300).points,
    [{ x: 200, y: 300 }, { x: 240, y: 300 }, { x: 240, y: 260 }]);
  assert.equal(cleanToolGeometry('polyline', { kind: 'path', points: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }), null,
    'the first vertex is the placement point');
  assert.equal(cleanToolGeometry('polyline', { kind: 'path', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }), null);
  assert.equal(cleanToolGeometry('polyline', { kind: 'path', points: [{ x: 0, y: 0 }, { x: 1e6, y: 0 }] }), null);
  assert.equal(captureToolGeometry({ ...source, rotation: 30 }), null);
  assert.equal(cleanToolGeometry('line', geometry), null, 'a path is not line geometry');
});

test('cloud polylines, polygons, flags, typewriters and stamps use bounded relative boxes or contours', () => {
  const cloud = { type: 'cloudPolyline', x: 10, y: 20, width: 40, height: 30,
    points: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 30, y: 50 }] };
  const contour = captureToolGeometry(cloud);
  assert.deepEqual(contour, { kind: 'points', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }] });
  const placed = applyDrawingGeometry('cloudPolyline', { type: 'cloudPolyline', points: [] }, contour, 100, 100);
  assert.deepEqual([placed.x, placed.y, placed.width, placed.height], [100, 100, 40, 30]);
  assert.deepEqual(captureToolGeometry({ type: 'polygon', x: 3, y: 4, width: 60, height: 50, sides: 8 }),
    { kind: 'box', width: 60, height: 50, rotation: 0 });
  assert.deepEqual(captureToolGeometry({ type: 'comment', icon: 'flag', x: 3, y: 4, width: 30, height: 30 }),
    { kind: 'box', width: 30, height: 30, rotation: 0 });
  assert.equal(captureToolGeometry({ type: 'comment', icon: 'note', x: 3, y: 4, width: 30, height: 30 }), null,
    'an ordinary note is not a flag tool');
  const stampBox = captureToolGeometry({ type: 'stamp', stampName: 'Approved', x: 0, y: 0, width: 160, height: 50, rotation: 90 });
  const stamp = applyDrawingGeometry('stamp', { type: 'stamp', stampName: 'Approved' }, stampBox, 500, 400);
  assert.deepEqual([stamp.x, stamp.y, stamp.width, stamp.height, stamp.rotation], [420, 375, 160, 50, 90],
    'a stamp is centred on the click as without a preset');
  const symbol = applyDrawingGeometry('symbol', { type: 'stamp', symbolId: 'oculith-door', stampSvg: '<svg/>' },
    { kind: 'box', width: 40, height: 20, rotation: 0 }, 100, 100);
  assert.deepEqual([symbol.x, symbol.y], [80, 90]);
});

test('each new type saves only appearance and identity, places with it, and stays local', withStorage(async (values) => {
  const tools = await import(`./tool-chest-presets.js?drawingTypes=${Date.now()}`);
  const sources = {
    polyline: { type: 'polyline', strokeColor: '#112233', lineWidth: 3, opacity: 0.5,
      points: [{ x: 5, y: 5 }, { x: 25, y: 5 }], ...PRIVATE },
    polygon: { type: 'polygon', strokeColor: '#223344', fillColor: '#ffeecc', sides: 8, x: 1, y: 1, width: 40, height: 40, ...PRIVATE },
    cloudPolyline: { type: 'cloudPolyline', strokeColor: '#334455', lineWidth: 2, x: 0, y: 0, width: 20, height: 20,
      points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }], ...PRIVATE },
    typewriter: { type: 'typewriter', textColor: '#445566', fontSize: 14, fontFamily: 'Arial', noWrap: true,
      x: 1, y: 1, width: 80, height: 20, text: 'Field note', ...PRIVATE },
    flag: { type: 'comment', icon: 'flag', color: '#dc2626', fillColor: '#dc2626', x: 1, y: 1, width: 24, height: 24,
      text: 'PRIVATE NOTE TEXT', ...PRIVATE },
    stamp: { type: 'stamp', stampName: 'Approved', stampText: 'APPROVED', stampColor: '#22c55e', color: '#22c55e',
      opacity: 0.85, x: 0, y: 0, width: 160, height: 50, rotation: 0, ...PRIVATE },
    symbol: { type: 'stamp', symbolId: 'oculith-door-single', stampSvg: '<svg>PRIVATE SVG</svg>',
      imageData: 'data:image/png;base64,AAAA', opacity: 0.9, x: 0, y: 0, width: 40, height: 40, rotation: 0, ...PRIVATE },
  };
  const saved = {};
  for (const [tool, source] of Object.entries(sources)) {
    assert.equal(tools.presetToolOf(source), tool);
    assert.ok(tools.canSaveToolPreset(source), tool);
    saved[tool] = tools.saveToolPreset(source, `${tool} tool`, undefined,
      tool === 'typewriter' ? { includeTextAndSize: true } : {});
    assert.ok(saved[tool], tool);
    assert.equal(saved[tool].tool, tool);
    assert.ok(saved[tool].geometry, `${tool} can enter Drawing Mode`);
  }
  assertNoPrivate(values);
  assert.deepEqual(saved.polygon.style, { strokeColor: '#223344', fillColor: '#ffeecc', sides: 8 });
  assert.deepEqual(saved.stamp.style, { stampName: 'Approved', stampText: 'APPROVED', stampColor: '#22c55e',
    color: '#22c55e', strokeColor: '#22c55e', opacity: 0.85 });
  assert.deepEqual(saved.symbol.style, { symbolId: 'oculith-door-single', opacity: 0.9 });
  assert.equal(saved.typewriter.text, 'Field note');
  assert.equal(tools.canSaveToolPreset({ type: 'stamp', stampName: 'Custom', imageData: 'data:image/png;base64,AA' }), false,
    'a custom image stamp cannot become a tool');
  assert.equal(tools.canSaveToolPreset({ type: 'comment', icon: 'note', color: '#ffff00' }), false);

  // Properties Mode: the new markup keeps its own geometry and takes the style.
  tools.activateToolPreset(saved.polyline.id);
  const drawn = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], strokeColor: '#000000', page: 2 };
  assert.deepEqual(tools.applyActiveToolPreset('polyline', drawn), { ...drawn, ...saved.polyline.style });
  // Drawing Mode: the saved shape at the click.
  tools.toggleToolPresetMode(saved.polyline.id);
  assert.deepEqual(tools.applyActiveToolPreset('polyline', drawn, 100, 50).points, [{ x: 100, y: 50 }, { x: 120, y: 50 }]);
  tools.toggleToolPresetMode(saved.flag.id);
  tools.activateToolPreset(saved.flag.id);
  const flag = tools.applyActiveToolPreset('flag', { type: 'comment', icon: 'flag', x: 10, y: 10, width: 24, height: 24, page: 3 }, 10, 10);
  assert.deepEqual([flag.color, flag.page, flag.width], ['#dc2626', 3, 24]);
  assert.equal(tools.applyActiveToolPreset('flag', { type: 'comment', icon: 'note', x: 1 }).color, undefined,
    'a flag tool does not restyle a note');
  tools.activateToolPreset(saved.symbol.id);
  const other = { type: 'stamp', symbolId: 'another-symbol', stampSvg: '<svg/>', opacity: 1 };
  assert.deepEqual(tools.applyActiveToolPreset('symbol', other), other, 'a symbol tool styles only its own symbol');
  assert.equal(tools.applyActiveToolPreset('symbol', { ...other, symbolId: 'oculith-door-single' }).opacity, 0.9);

  // Sequences reach the new types through finishToolPresetPlacement.
  tools.activateToolPreset(saved.stamp.id);
  tools.setToolPresetSequence(saved.stamp.id, { prefix: 'S', suffix: '', start: 1, step: 1, digits: 1 });
  const doc = {};
  const stamp = tools.finishToolPresetPlacement({ type: 'stamp', stampName: 'Approved', stampText: 'APPROVED',
    stampColor: '#22c55e', color: '#22c55e', subject: '' }, doc);
  assert.equal(stamp.subject, 'S1');
  assert.equal(tools.getRecentTools()[0].tool, 'stamp');

  const set = tools.createToolSet('Field');
  tools.moveToolPreset(saved.polyline.id, set.id);
  assert.throws(() => tools.exportToolSet(set.id), /polyline tools are local only/u);
  const reloaded = await import(`./tool-chest-presets.js?drawingTypesReload=${Date.now()}`);
  assert.deepEqual(reloaded.getToolChestPresets().map(preset => preset.tool).sort(),
    Object.keys(sources).sort());
  assert.equal(reloaded.getToolChestPresets().find(p => p.tool === 'polyline').mode, 'drawing');
}));
