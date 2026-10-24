// Tool Chest panel actions (the external editor gear and tool menus): rename a set or tool,
// Copy to ▸ another set, and switch a whole set between Properties and
// Drawing Mode. Stored in the existing preset/set storage format.
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('rename, copy to a set and set-wide mode keep the storage format', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const tools = await import(`./tool-chest-presets.js?panel=${Date.now()}`);
    const arch = tools.createToolSet('Architect Review');
    const eng = tools.createToolSet('Engineer Review');
    const line = tools.saveToolPreset({ type: 'line', strokeColor: '#aa0000', lineWidth: 2, startX: 0, startY: 0,
      endX: 40, endY: 0, page: 1 }, 'Red line', arch.id);
    const box = tools.saveToolPreset({ type: 'box', strokeColor: '#0000aa', x: 0, y: 0, width: 20, height: 10,
      page: 1 }, 'Blue box', arch.id);
    const note = tools.saveToolPreset({ type: 'highlight', color: '#ffff00' }, 'Marker', arch.id);
    assert.ok(line?.geometry && box?.geometry && note && !note.geometry);

    // Rename a set: unique, trimmed, no control characters; My Tools cannot be renamed.
    assert.equal(tools.renameToolSet(arch.id, '  Architect  ')?.name, 'Architect');
    assert.equal(tools.renameToolSet(arch.id, 'engineer review'), null, 'names stay unique');
    assert.equal(tools.renameToolSet(arch.id, 'Bad\u0007name'), null);
    assert.equal(tools.renameToolSet(tools.DEFAULT_TOOL_SET_ID, 'Mine'), null);
    assert.deepEqual(JSON.parse(values.get('oculith-tool-chest-sets-v1')).map(set => set.name), ['Architect', 'Engineer Review']);

    // Rename a tool.
    assert.equal(tools.renameToolPreset(line.id, ' Red dimension ')?.name, 'Red dimension');
    assert.equal(tools.renameToolPreset(line.id, '   '), null);

    // Copy to: a new id at the end of the target set; the original stays.
    const copy = tools.copyToolPreset(line.id, eng.id);
    assert.ok(copy && copy.id !== line.id);
    assert.equal(copy.setId, eng.id);
    assert.deepEqual(copy.geometry, line.geometry);
    assert.equal(tools.copyToolPreset(line.id, 'set_missing'), null);
    assert.equal(tools.getToolChestPresets().filter(p => p.setId === arch.id).length, 3);

    // Set-wide Drawing Mode: only tools with geometry switch.
    assert.equal(tools.setToolSetMode(arch.id, 'drawing'), 2);
    const byId = id => tools.getToolChestPresets().find(p => p.id === id);
    assert.deepEqual([byId(line.id).mode, byId(box.id).mode, byId(note.id).mode], ['drawing', 'drawing', 'properties']);
    assert.equal(byId(copy.id).mode, 'properties', 'other sets are untouched');
    assert.equal(tools.setToolSetMode(arch.id, 'drawing'), 0);
    assert.equal(tools.setToolSetMode(arch.id, 'properties'), 2);
    assert.equal(tools.setToolSetMode(arch.id, 'sideways'), 0);

    // The stored presets still load through the cleaner (fresh module).
    const reloaded = await import(`./tool-chest-presets.js?panel-reload=${Date.now()}`);
    assert.equal(reloaded.getToolChestPresets().length, 4);
    assert.equal(reloaded.getToolChestSets().length, 3);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
