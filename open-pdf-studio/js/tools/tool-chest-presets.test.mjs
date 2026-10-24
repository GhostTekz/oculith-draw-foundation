import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Recent Tools are bounded, deduplicated session styles and remain separate from My Tools', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?session=${Date.now()}`);
    const source = { type: 'line', strokeColor: '#ab1234', lineWidth: 4,
      startX: 12, endX: 32, page: 7, subject: 'Private source comment' };
    assert.equal(tools.recordRecentTool({ type: 'comment', color: '#fff' }), null);
    const first = tools.recordRecentTool(source);
    assert.equal(tools.getRecentTools().length, 1);
    assert.deepEqual(first.style, { strokeColor: '#ab1234', lineWidth: 4 });
    assert.equal(values.size, 0, 'recent use must not write persistent storage');
    assert.equal(tools.recordRecentTool({ ...source, page: 9, subject: 'Other drawing' }).id, first.id);
    assert.equal(tools.getRecentTools().length, 1, 'same type and style has one MRU entry');

    for (let index = 0; index < 10; index++) {
      tools.recordRecentTool({ type: 'line', strokeColor: `#${String(index).padStart(6, '0')}`, lineWidth: 1 });
    }
    assert.equal(tools.getRecentTools().length, 8);
    assert.equal(tools.getRecentTools()[0].style.strokeColor, '#000009');
    const chosen = tools.getRecentTools()[2];
    assert.equal(tools.activateRecentTool(chosen.id)?.id, chosen.id);
    assert.deepEqual(tools.applyActiveToolPreset('line', { type: 'line', startX: 10, page: 3 }),
      { type: 'line', startX: 10, page: 3, ...chosen.style });
    assert.deepEqual(tools.applyActiveToolPreset('box', { type: 'box', x: 10 }), { type: 'box', x: 10 });

    const saved = tools.saveToolPreset(source, 'Permanent line');
    assert.ok(saved);
    assert.equal(tools.getToolChestPresets().length, 1);
    assert.equal(values.size, 1, 'only My Tools uses localStorage');
    tools.clearRecentTools();
    assert.equal(tools.getRecentTools().length, 0);
    assert.equal(tools.activeToolPreset(), null);
    assert.equal(tools.getToolChestPresets().length, 1);

    tools.recordRecentTool(source);
    const nextSession = await import(`./tool-chest-presets.js?next=${Date.now()}`);
    assert.equal(nextSession.getRecentTools().length, 0, 'an app reload starts with no recent tools');
    assert.equal(nextSession.getToolChestPresets().length, 1, 'saved My Tools survive reload');
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('dot count presets keep only local appearance and place independent numbers and categories', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?count=${Date.now()}`);
    const source = { type: 'count', page: 8, x: 101, y: 203, id: 'source-count',
      categoryId: 'source-category', number: 49, markerStyle: 'dot',
      color: '#a81d48', strokeColor: '#a81d48', opacity: 0.65,
      author: 'PRIVATE AUTHOR', subject: 'PRIVATE COMMENT', replies: [{ text: 'PRIVATE REPLY' }],
      pdfPath: '/private/source.pdf', symbolId: 'private-symbol' };
    assert.equal(tools.canSaveToolPreset({ ...source, markerStyle: 'symbol' }), false);
    const preset = tools.saveToolPreset(source, 'Door tally');
    assert.ok(preset);
    assert.equal(preset.mode, 'properties');
    assert.equal(preset.geometry, undefined);
    assert.deepEqual(preset.style, { color: '#a81d48', strokeColor: '#a81d48',
      opacity: 0.65, markerStyle: 'dot' });
    const stored = values.get('oculith-tool-chest-presets-v1');
    for (const privateValue of ['source-category', 'PRIVATE AUTHOR', 'PRIVATE COMMENT',
      'PRIVATE REPLY', '/private/source.pdf', 'private-symbol']) {
      assert.equal(stored.includes(privateValue), false, `${privateValue} cannot enter the local preset`);
    }
    assert.equal(Object.hasOwn(JSON.parse(stored)[0], 'number'), false);
    assert.equal(tools.toggleToolPresetMode(preset.id), null);
    tools.activateToolPreset(preset.id);
    const fresh = { type: 'count', page: 2, x: 340, y: 210,
      categoryId: 'new-category', number: 1, markerStyle: 'dot', color: '#000000' };
    assert.deepEqual(tools.applyActiveToolPreset('count', fresh), { ...fresh, ...preset.style });
    const set = tools.createToolSet('Local counts');
    tools.moveToolPreset(preset.id, set.id);
    assert.throws(() => tools.exportToolSet(set.id), /Count presets are local only/u);
    const reloaded = await import(`./tool-chest-presets.js?countReload=${Date.now()}`);
    assert.deepEqual(reloaded.getToolChestPresets()[0].style, preset.style);
    assert.equal(reloaded.getToolChestPresets()[0].mode, 'properties');
    assert.equal(reloaded.recordRecentTool(source)?.tool, 'count');
    assert.equal(reloaded.getRecentTools().length, 1);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('named sets migrate legacy presets, persist moves, and return tools to My Tools on deletion', async () => {
  const values = new Map([['oculith-tool-chest-presets-v1', JSON.stringify([
    { id: 'legacy', name: 'Issued line', tool: 'line', style: { strokeColor: '#123456', lineWidth: 2 } },
    { id: 'orphan', name: 'Orphan line', tool: 'line', style: { strokeColor: '#654321' }, setId: 'set_missing' },
  ])]]);
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?sets=${Date.now()}`);
    assert.deepEqual(tools.getToolChestSets().map(set => set.name), ['My tools']);
    assert.deepEqual(tools.getToolChestPresets().map(preset => preset.setId),
      [tools.DEFAULT_TOOL_SET_ID, tools.DEFAULT_TOOL_SET_ID]);
    assert.deepEqual(tools.getToolChestPresets().map(preset => preset.mode),
      ['properties', 'properties'], 'legacy appearance presets retain Properties Mode');
    assert.equal(tools.toggleToolPresetMode('legacy'), null, 'appearance-only presets cannot enter Drawing Mode');
    const electrical = tools.createToolSet('  Electrical review  ');
    assert.equal(electrical.name, 'Electrical review');
    assert.equal(tools.createToolSet('electrical REVIEW'), null, 'names are unique without case sensitivity');
    assert.equal(tools.saveToolPreset({ type: 'box', strokeColor: '#abcdef' }, 'Boxes', 'set_missing'), null);
    const box = tools.saveToolPreset({ type: 'box', strokeColor: '#abcdef', x: 22, subject: 'private' }, 'Boxes', electrical.id);
    assert.equal(box.setId, electrical.id);
    assert.deepEqual(box.style, { strokeColor: '#abcdef' }, 'page geometry and source comment never enter a preset');
    const moved = tools.moveToolPreset('legacy', electrical.id);
    assert.equal(moved.setId, electrical.id);
    assert.equal(tools.moveToolPreset('legacy', 'set_missing'), null);
    assert.equal(tools.activateToolPreset('legacy')?.id, 'legacy');
    assert.equal(tools.deleteToolSet(tools.DEFAULT_TOOL_SET_ID), false);
    assert.equal(tools.deleteToolSet(electrical.id), true);
    assert.deepEqual(tools.getToolChestPresets().map(preset => preset.setId),
      Array(3).fill(tools.DEFAULT_TOOL_SET_ID), 'deleting a set never deletes its saved tools');
    assert.equal(tools.activeToolPreset().setId, tools.DEFAULT_TOOL_SET_ID);
    assert.deepEqual(tools.getToolChestSets().map(set => set.name), ['My tools']);
    assert.equal(JSON.parse(values.get('oculith-tool-chest-sets-v1')).length, 0);
    assert.equal(JSON.parse(values.get('oculith-tool-chest-presets-v1')).length, 3);

    const nextSession = await import(`./tool-chest-presets.js?setsReload=${Date.now()}`);
    assert.deepEqual(nextSession.getToolChestSets().map(set => set.name), ['My tools']);
    assert.equal(nextSession.getToolChestPresets().length, 3);
    assert.equal(nextSession.getRecentTools().length, 0);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('saved shape geometry switches between Properties and Drawing Mode without source metadata', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?drawing=${Date.now()}`);
    const source = { type: 'box', page: 9, x: 75, y: 85, width: 120, height: 60,
      rotation: 25, strokeColor: '#123abc', subject: 'Source note', contents: 'Confidential' };
    const preset = tools.saveToolPreset(source, 'Outline');
    assert.equal(preset.mode, 'properties');
    assert.deepEqual(preset.geometry, { kind: 'box', width: 120, height: 60, rotation: 25 });
    tools.activateToolPreset(preset.id);
    const newProps = { type: 'box', page: 1, x: 300, y: 400, width: 25, height: 35, subject: '' };
    assert.deepEqual(tools.applyActiveToolPreset('box', newProps),
      { ...newProps, strokeColor: '#123abc' }, 'Properties Mode keeps drawn size');
    assert.equal(tools.toggleToolPresetMode(preset.id)?.mode, 'drawing');
    assert.deepEqual(tools.applyActiveToolPreset('box', newProps),
      { ...newProps, strokeColor: '#123abc', width: 120, height: 60, rotation: 25 },
      'Drawing Mode keeps relative size at the new anchor');
    assert.equal(JSON.stringify(JSON.parse(values.get('oculith-tool-chest-presets-v1'))).includes('Source note'), false);
    const reloaded = await import(`./tool-chest-presets.js?drawingReload=${Date.now()}`);
    assert.equal(reloaded.getToolChestPresets()[0].mode, 'drawing');
    reloaded.activateToolPreset(preset.id);
    assert.equal(reloaded.activeDrawingToolPreset('box')?.id, preset.id);
    assert.equal(reloaded.toggleToolPresetMode(preset.id)?.mode, 'properties');
    assert.equal(reloaded.activeDrawingToolPreset('box'), null);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('updating a saved drawing tool preserves identity and rejects incompatible or unsafe sources', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?update=${Date.now()}`);
    const set = tools.createToolSet('Revision review');
    const original = tools.saveToolPreset({ type: 'box', x: 300, y: 400, width: 90, height: 55,
      strokeColor: '#123456', lineWidth: 2, subject: 'Old source comment' }, 'Review outline', set.id);
    tools.toggleToolPresetMode(original.id);
    tools.activateToolPreset(original.id);
    const source = { type: 'box', x: 800, y: 900, width: 145, height: 70,
      strokeColor: '#aabbcc', lineWidth: 4, page: 8, subject: 'Private source comment',
      contents: 'Not a reusable label' };
    assert.equal(tools.canUpdateToolPreset(original.id, source), true);
    assert.equal(tools.canUpdateToolPreset(original.id, { ...source, type: 'cloud' }), false);
    assert.equal(tools.canUpdateToolPreset(original.id, { ...source, locked: true }), false);
    assert.equal(tools.canUpdateToolPreset(original.id, { ...source, readOnly: true }), false);
    assert.equal(tools.canUpdateToolPreset(original.id, { ...source, width: 0 }), false,
      'Drawing Mode cannot lose valid geometry during an update');
    const before = values.get('oculith-tool-chest-presets-v1');
    assert.equal(tools.updateToolPresetFromAnnotation(original.id, { ...source, type: 'cloud' }), null);
    assert.equal(values.get('oculith-tool-chest-presets-v1'), before);
    const updated = tools.updateToolPresetFromAnnotation(original.id, source);
    assert.deepEqual(updated, { ...original, style: { strokeColor: '#aabbcc', lineWidth: 4 },
      geometry: { kind: 'box', width: 145, height: 70, rotation: 0 }, mode: 'drawing' });
    assert.equal(tools.activeToolPreset()?.id, original.id);
    assert.deepEqual(tools.applyActiveToolPreset('box', { type: 'box', page: 2, x: 10, y: 20,
      width: 12, height: 13, subject: '' }), { type: 'box', page: 2, x: 10, y: 20,
      width: 145, height: 70, rotation: 0, subject: '', strokeColor: '#aabbcc', lineWidth: 4 });
    const stored = values.get('oculith-tool-chest-presets-v1');
    assert.equal(stored.includes('Private source comment'), false);
    assert.equal(stored.includes('Not a reusable label'), false);
    assert.equal(Object.hasOwn(updated, 'x'), false);
    assert.equal(Object.hasOwn(updated, 'y'), false);
    assert.equal(Object.hasOwn(updated, 'page'), false);
    const reloaded = await import(`./tool-chest-presets.js?updateReload=${Date.now()}`);
    assert.deepEqual(reloaded.getToolChestPresets()[0], updated);
    assert.equal(reloaded.getToolChestSets()[1].id, set.id);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('textbox presets keep appearance by default and reuse text only after explicit opt-in', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?textbox=${Date.now()}`);
    const source = { type: 'textbox', page: 9, x: 240, y: 360, width: 120, height: 44,
      rotation: 15, text: 'ISSUED FOR REVIEW', textColor: '#123abc', fontSize: 14,
      fontFamily: 'Arial', fontBold: true, strokeColor: '#ff6600', fillColor: '#ffffff',
      author: 'Private author', subject: 'Private subject', contents: 'Private comment',
      replies: [{ text: 'Private reply' }], pdfPath: '/private/drawing.pdf' };
    const appearance = tools.saveToolPreset(source, 'Text style');
    assert.ok(appearance);
    assert.equal(appearance.geometry, undefined);
    assert.equal(appearance.text, undefined);
    assert.equal(tools.toggleToolPresetMode(appearance.id), null);
    tools.activateToolPreset(appearance.id);
    const fresh = { type: 'textbox', page: 2, x: 20, y: 30, width: 90, height: 30, text: '' };
    assert.deepEqual(tools.applyActiveToolPreset('textbox', fresh),
      { ...fresh, ...appearance.style }, 'Properties Mode uses new text and drag geometry');

    const drawing = tools.saveToolPreset(source, 'Reusable label', tools.DEFAULT_TOOL_SET_ID,
      { includeTextAndSize: true });
    assert.deepEqual(drawing.geometry, { kind: 'box', width: 120, height: 44, rotation: 15 });
    assert.equal(drawing.text, source.text);
    assert.equal(drawing.mode, 'properties');
    tools.activateToolPreset(drawing.id);
    assert.equal(tools.applyActiveToolPreset('textbox', fresh).text, '');
    tools.toggleToolPresetMode(drawing.id);
    const placed = tools.applyActiveToolPreset('textbox', fresh);
    assert.deepEqual({ page: placed.page, x: placed.x, y: placed.y, width: placed.width,
      height: placed.height, rotation: placed.rotation, text: placed.text },
    { page: 2, x: 20, y: 30, width: 120, height: 44, rotation: 15, text: 'ISSUED FOR REVIEW' });
    const stored = values.get('oculith-tool-chest-presets-v1');
    for (const privateValue of ['Private author', 'Private subject', 'Private comment',
      'Private reply', '/private/drawing.pdf', '"page":9', '"x":240', '"y":360']) {
      assert.equal(stored.includes(privateValue), false, `${privateValue} cannot enter local presets`);
    }
    assert.equal(tools.canUpdateToolPreset(drawing.id, { ...source, text: '' }), false);
    assert.equal(tools.updateToolPresetFromAnnotation(drawing.id, { ...source, text: 'NEW ISSUE' })?.text, 'NEW ISSUE');
    assert.equal(tools.updateToolPresetFromAnnotation(appearance.id, source)?.text, undefined,
      'updating an appearance-only textbox cannot add text silently');
    const named = tools.createToolSet('Text set');
    tools.moveToolPreset(drawing.id, named.id);
    const { parsePortableToolSetBytes } = await import('./tool-set-portable.js');
    const portable = parsePortableToolSetBytes(tools.exportToolSet(named.id));
    assert.deepEqual([portable.tools[0].mode, portable.tools[0].text, portable.tools[0].geometry.width],
      ['drawing', 'NEW ISSUE', 120]);
    const reloaded = await import(`./tool-chest-presets.js?textboxReload=${Date.now()}`);
    assert.equal(reloaded.getToolChestPresets().find(item => item.id === drawing.id).text, 'NEW ISSUE');
    assert.equal(reloaded.getToolChestPresets().find(item => item.id === appearance.id).text, undefined);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('callout appearance presets exclude text, leader geometry, and source metadata', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?callout=${Date.now()}`);
    const source = { type: 'callout', page: 9, x: 220, y: 300, width: 145, height: 60,
      arrowX: 78, arrowY: 360, kneeX: 180, kneeY: 345, armOriginX: 220, armOriginY: 345,
      text: 'PRIVATE SOURCE TEXT', textRuns: [{ text: 'PRIVATE RICH TEXT' }],
      author: 'PRIVATE AUTHOR', subject: 'PRIVATE SUBJECT', contents: 'PRIVATE COMMENT',
      replies: [{ text: 'PRIVATE REPLY' }], pdfPath: '/private/source.pdf',
      strokeColor: '#b84216', fillColor: '#fff2db', textColor: '#153558', fontSize: 13,
      fontFamily: 'Arial', fontBold: true, lineWidth: 2.5, borderStyle: 'dashed',
      opacity: 0.8, leaderStyle: 'curved', borderEffect: 'cloudy', cloudIntensity: 1,
      arrowStyle: 'open', headSize: 9, textPadding: 4 };
    const preset = tools.saveToolPreset(source, 'Field note');
    assert.ok(preset);
    assert.equal(preset.mode, 'properties');
    assert.equal(preset.geometry, undefined);
    assert.equal(preset.text, undefined);
    assert.equal(tools.toggleToolPresetMode(preset.id), null);
    assert.deepEqual(preset.style, { strokeColor: '#b84216', fillColor: '#fff2db',
      opacity: 0.8, lineWidth: 2.5, borderStyle: 'dashed',
      textColor: '#153558', fontSize: 13, fontFamily: 'Arial', fontBold: true,
      textPadding: 4, leaderStyle: 'curved', borderEffect: 'cloudy', cloudIntensity: 1 });
    tools.activateToolPreset(preset.id);
    const fresh = { type: 'callout', page: 2, x: 40, y: 55, width: 110, height: 40,
      arrowX: 20, arrowY: 25, kneeX: 27, kneeY: 38, armOriginX: 40, armOriginY: 38,
      text: 'NEW FIELD NOTE', subject: '' };
    assert.deepEqual(tools.applyActiveToolPreset('callout', fresh), { ...fresh, ...preset.style });
    const stored = values.get('oculith-tool-chest-presets-v1');
    for (const privateValue of ['PRIVATE SOURCE TEXT', 'PRIVATE RICH TEXT', 'PRIVATE AUTHOR',
      'PRIVATE SUBJECT', 'PRIVATE COMMENT', 'PRIVATE REPLY', '/private/source.pdf',
      '"page":9', '"arrowX":78', '"kneeX":180', '"x":220', '"width":145']) {
      assert.equal(stored.includes(privateValue), false, `${privateValue} cannot enter a preset`);
    }
    const next = await import(`./tool-chest-presets.js?calloutReload=${Date.now()}`);
    assert.deepEqual(next.getToolChestPresets()[0], preset);
    assert.equal(next.toggleToolPresetMode(preset.id), null);
    assert.equal(next.canUpdateToolPreset(preset.id, { ...source, locked: true }), false);
    const updated = next.updateToolPresetFromAnnotation(preset.id,
      { ...source, text: 'ANOTHER PRIVATE NOTE', x: 900, arrowX: 888,
        strokeColor: '#146d52', fontSize: 16 });
    assert.equal(updated.id, preset.id);
    assert.equal(updated.mode, 'properties');
    assert.equal(updated.geometry, undefined);
    assert.equal(updated.text, undefined);
    assert.equal(updated.style.strokeColor, '#146d52');
    assert.equal(updated.style.fontSize, 16);
    assert.equal(values.get('oculith-tool-chest-presets-v1').includes('ANOTHER PRIVATE NOTE'), false);
    const set = next.createToolSet('Local callouts');
    next.moveToolPreset(preset.id, set.id);
    const portable = (await import('./tool-set-portable.js')).parsePortableToolSetBytes(next.exportToolSet(set.id));
    assert.equal(portable.version, 2);
    assert.equal(portable.tools[0].tool, 'callout');
    assert.equal(portable.tools[0].geometry, undefined);
    assert.equal(portable.tools[0].text, undefined);
    values.set('oculith-tool-chest-presets-v1', JSON.stringify([{ ...updated,
      mode: 'drawing', geometry: { kind: 'box', width: 145, height: 60, rotation: 0 },
      text: 'INJECTED SOURCE TEXT' }]));
    const guarded = await import(`./tool-chest-presets.js?calloutGuard=${Date.now()}`);
    const restored = guarded.getToolChestPresets()[0];
    assert.equal(restored.mode, 'properties', 'local storage cannot enable unvalidated callout Drawing Mode');
    assert.equal(restored.geometry, undefined);
    assert.equal(restored.text, undefined);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('callout Drawing Mode requires explicit geometry capture and preserves a fresh arrow tip', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?calloutDrawing=${Date.now()}`);
    const source = { type: 'callout', page: 9, x: 180, y: 120, width: 150, height: 60,
      arrowX: 100, arrowY: 200, kneeX: 140, kneeY: 155,
      armOriginX: 180, armOriginY: 150, text: 'PRIVATE SOURCE TEXT',
      author: 'PRIVATE AUTHOR', subject: 'PRIVATE SUBJECT', replies: [{ text: 'PRIVATE REPLY' }],
      pdfPath: '/private/drawing.pdf', strokeColor: '#ad4215', fontSize: 13 };
    assert.equal(tools.saveToolPreset({ ...source, rotation: 15 }, 'Unsafe',
      tools.DEFAULT_TOOL_SET_ID, { includeCalloutGeometry: true }), null);
    assert.equal(tools.getToolChestPresets().length, 0);
    const preset = tools.saveToolPreset(source, 'Leader shape', tools.DEFAULT_TOOL_SET_ID,
      { includeCalloutGeometry: true });
    assert.equal(preset.mode, 'properties');
    assert.equal(preset.text, undefined);
    assert.deepEqual(preset.geometry, { kind: 'callout', boxDx: 80, boxDy: -80,
      width: 150, height: 60, kneeDx: 40, kneeDy: -45, armDx: 80, armDy: -50 });
    tools.activateToolPreset(preset.id);
    const fresh = { type: 'callout', page: 2, x: 340, y: 330, width: 150, height: 60,
      arrowX: 300, arrowY: 400, kneeX: 325, kneeY: 355,
      armOriginX: 340, armOriginY: 360, text: '', subject: '' };
    assert.deepEqual(tools.applyActiveToolPreset('callout', fresh), { ...fresh, ...preset.style });
    assert.equal(tools.toggleToolPresetMode(preset.id)?.mode, 'drawing');
    const placed = tools.applyActiveToolPreset('callout', fresh);
    assert.deepEqual([placed.page, placed.x, placed.y, placed.width, placed.height,
      placed.arrowX, placed.arrowY, placed.kneeX, placed.kneeY,
      placed.armOriginX, placed.armOriginY, placed.text],
    [2, 380, 320, 150, 60, 300, 400, 340, 355, 380, 350, '']);
    assert.deepEqual(tools.applyActiveToolPreset('callout', placed), placed,
      'final annotation creation must not shift the geometry on its second styling pass');
    const stored = values.get('oculith-tool-chest-presets-v1');
    for (const privateValue of ['PRIVATE SOURCE', '/private/drawing.pdf',
      '"page":9', '"arrowX":100', '"x":180']) assert.equal(stored.includes(privateValue), false);
    const reloaded = await import(`./tool-chest-presets.js?calloutDrawingReload=${Date.now()}`);
    assert.equal(reloaded.getToolChestPresets()[0].mode, 'drawing');
    assert.deepEqual(reloaded.getToolChestPresets()[0].geometry, preset.geometry);
    values.set('oculith-tool-chest-presets-v1', JSON.stringify([{ ...reloaded.getToolChestPresets()[0],
      text: 'INJECTED SOURCE TEXT' }]));
    const guarded = await import(`./tool-chest-presets.js?calloutDrawingGuard=${Date.now()}`);
    assert.equal(guarded.getToolChestPresets()[0].text, undefined,
      'even valid callout Drawing Mode cannot import source text from local storage');
    assert.equal(reloaded.canUpdateToolPreset(preset.id, { ...source, rotation: 90 }), false);
    assert.equal(reloaded.canUpdateToolPreset(preset.id, { ...source, readOnly: true }), false);
    assert.equal(reloaded.updateToolPresetFromAnnotation(preset.id,
      { ...source, x: 200, arrowX: 90, armOriginX: 200,
        text: 'ANOTHER PRIVATE NOTE' })?.geometry.boxDx, 110);
    assert.equal(values.get('oculith-tool-chest-presets-v1').includes('ANOTHER PRIVATE NOTE'), false);
    const set = reloaded.createToolSet('Review leaders');
    reloaded.moveToolPreset(preset.id, set.id);
    const portableBytes = reloaded.exportToolSet(set.id);
    const { parsePortableToolSetBytes } = await import('./tool-set-portable.js');
    const portable = parsePortableToolSetBytes(portableBytes);
    assert.equal(portable.version, 2);
    assert.deepEqual(portable.tools[0].geometry, reloaded.getToolChestPresets().find(item => item.id === preset.id).geometry);
    assert.equal(portable.tools[0].text, undefined);
    const imported = reloaded.importToolSet(portableBytes);
    assert.equal(imported.tools[0].mode, 'drawing');
    assert.deepEqual(imported.tools[0].geometry, portable.tools[0].geometry);
    assert.equal(Object.hasOwn(imported.tools[0], 'text'), false);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('My Tools order is the hot-key slot order and survives reload; other sets keep their own order', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?slots=${Date.now()}`);
    const set = tools.createToolSet('Site');
    const saved = [];
    for (let index = 0; index < 12; index++) {
      saved.push(tools.saveToolPreset({ type: 'line', strokeColor: `#0000${String(index).padStart(2, '0')}`,
        startX: 0, startY: 0, endX: 10, endY: 0 }, `Line ${index + 1}`));
      if (index === 1) tools.saveToolPreset({ type: 'box', strokeColor: '#ff0000', x: 0, y: 0, width: 5, height: 5 }, 'Site box', set.id);
    }
    assert.equal(tools.myToolsSlotPreset(1).id, saved[0].id);
    assert.equal(tools.myToolsSlotPreset(10).id, saved[9].id, 'key 0 = slot 10');
    assert.equal(tools.myToolsSlotPreset(11), null);
    assert.equal(tools.myToolsSlotOf(saved[10].id), null, 'the 11th tool has no hot key');
    assert.equal(tools.myToolsSlotOf(saved[2].id), 3, 'the Site box does not take a My Tools slot');

    assert.equal(tools.reorderToolPreset(saved[0].id, -1), false, 'the first tool cannot move up');
    assert.equal(tools.reorderToolPreset(saved[1].id, -1), true);
    assert.equal(tools.myToolsSlotPreset(1).id, saved[1].id);
    assert.equal(tools.myToolsSlotPreset(2).id, saved[0].id);
    assert.equal(tools.reorderToolPreset(saved[1].id, 1), true, 'moving down skips the other set');
    assert.equal(tools.myToolsSlotPreset(1).id, saved[0].id);

    assert.equal(tools.placeToolPresetAt(saved[11].id, 0), true, 'drag the 12th tool to slot 1');
    assert.equal(tools.myToolsSlotOf(saved[11].id), 1);
    assert.equal(tools.myToolsSlotOf(saved[9].id), null, 'the old slot 10 tool moved to 11');

    tools.moveToolPreset(saved[11].id, set.id);
    assert.equal(tools.myToolsSlotOf(saved[11].id), null);
    assert.equal(tools.myToolsSlotPreset(1).id, saved[0].id);

    const reloaded = await import(`./tool-chest-presets.js?slotsReload=${Date.now()}`);
    assert.deepEqual(Array.from({ length: 10 }, (_, i) => reloaded.myToolsSlotPreset(i + 1)?.name),
      ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6', 'Line 7', 'Line 8', 'Line 9', 'Line 10']);
    assert.deepEqual(reloaded.getToolChestPresets().filter(p => p.setId === set.id).map(p => p.name),
      ['Site box', 'Line 12']);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('a sequence pattern stays with its tool through update, mode switch, reload, export and import', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const tools = await import(`./tool-chest-presets.js?sequence=${Date.now()}`);
    const sequence = { prefix: 'R', suffix: '', start: 100, step: 10, digits: 1 };
    const box = { type: 'box', strokeColor: '#123456', x: 4, y: 5, width: 30, height: 20 };
    const preset = tools.saveToolPreset(box, 'Room box');
    assert.equal(tools.setToolPresetSequence(preset.id, { ...sequence, extra: 1 }), null);
    assert.deepEqual(tools.setToolPresetSequence(preset.id, sequence).sequence, sequence);
    assert.deepEqual(tools.updateToolPresetFromAnnotation(preset.id, { ...box, strokeColor: '#654321' }).sequence, sequence);
    assert.deepEqual(tools.toggleToolPresetMode(preset.id).sequence, sequence);
    tools.activateToolPreset(preset.id);
    const doc = {};
    const placed = { type: 'box', x: 1, y: 1, width: 3, height: 3, subject: '' };
    assert.equal(tools.stampActiveToolSequence(placed, doc), 'R100');
    assert.equal(placed.subject, 'R100');
    assert.equal(tools.stampActiveToolSequence({ type: 'line' }, doc), null, 'another tool type takes no label');
    assert.deepEqual(doc.toolSequences, { 'R\u0001': 110 });
    const set = tools.createToolSet('Rooms');
    tools.moveToolPreset(preset.id, set.id);
    const imported = tools.importToolSet(tools.exportToolSet(set.id));
    assert.deepEqual(imported.tools[0].sequence, sequence);
    const reloaded = await import(`./tool-chest-presets.js?sequenceReload=${Date.now()}`);
    assert.ok(reloaded.getToolChestPresets().every(item => JSON.stringify(item.sequence) === JSON.stringify(sequence)));
    assert.equal(reloaded.setToolPresetSequence(preset.id, null).sequence, undefined, 'remove the sequence');
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
