// Tool Chest panel view (the external editor layout): the search filters tools across every
// section, and which sections are open or in Detail view survives a restart.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SECTION_STATE_KEY, MY_TOOLS_SECTION, RECENT_SECTION, toolSetSectionId, librarySectionId,
  readSectionState, writeSectionState, isSectionOpen, withSectionToggled, withAllSections,
  sectionView, withSectionView, pruneSectionState, cleanSectionState,
  filterToolChestSections, toolMatchesQuery, toolDescription, myToolsBadge,
} from './tool-chest-view.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

const preset = (id, name, tool, extra = {}) => ({ id, name, tool, mode: 'properties', style: {}, ...extra });
const sections = () => [
  { id: MY_TOOLS_SECTION, name: 'My Tools', tools: [
    { id: 'a', name: 'Red cloud', tool: 'cloud', description: toolDescription(preset('a', 'Red cloud', 'cloud')) },
    { id: 'b', name: 'Door tag', tool: 'textbox', description: toolDescription(preset('b', 'Door tag', 'textbox',
      { mode: 'drawing', sequence: { prefix: 'D-', suffix: '', start: 1, step: 1, digits: 2 } })) },
  ] },
  { id: RECENT_SECTION, name: 'Recent Tools', tools: [
    { id: 'r1', name: 'Box', tool: 'box', description: toolDescription(preset('r1', 'Box', 'box'), { recent: true }) },
  ] },
  { id: toolSetSectionId('set_arch'), name: 'Architect Review', tools: [
    { id: 'c', name: 'Clash cloud', tool: 'cloud', description: 'Cloud · Properties Mode' },
    { id: 'd', name: 'Dimension line', tool: 'line', description: 'Line · Drawing Mode' },
  ] },
  { id: librarySectionId('oculith-lighting'), name: 'Oculith · Lighting', tools: [
    { id: 'oculith-downlight', name: 'Downlight', description: 'Oculith · Lighting' },
    { id: 'oculith-exit', name: 'Exit sign', description: 'Oculith · Lighting' },
  ] },
];

test('the search filters tools across all sections and drops sections without a match', () => {
  assert.equal(filterToolChestSections(sections(), '   ').length, 4, 'an empty search changes nothing');
  const clouds = filterToolChestSections(sections(), 'cloud');
  assert.deepEqual(clouds.map(s => [s.id, s.tools.map(t => t.id)]),
    [[MY_TOOLS_SECTION, ['a']], [toolSetSectionId('set_arch'), ['c']]]);
  assert.ok(clouds.every(s => s.searchOpen), 'matching sections show open while searching');
  // Every word must match: name, type name, description (mode, sequence) or id.
  assert.deepEqual(filterToolChestSections(sections(), 'line drawing').flatMap(s => s.tools.map(t => t.id)), ['d']);
  assert.deepEqual(filterToolChestSections(sections(), 'TEXT BOX').flatMap(s => s.tools.map(t => t.id)), ['b']);
  assert.deepEqual(filterToolChestSections(sections(), 'D-##').flatMap(s => s.tools.map(t => t.id)), ['b']);
  assert.deepEqual(filterToolChestSections(sections(), 'rectangle').flatMap(s => s.tools.map(t => t.id)), ['r1'],
    'the type name (box = Rectangle) matches');
  // A section whose own name matches keeps all its tools.
  const lighting = filterToolChestSections(sections(), 'lighting');
  assert.deepEqual(lighting.map(s => s.tools.length), [2]);
  assert.deepEqual(filterToolChestSections(sections(), 'nothing-here'), []);
  assert.equal(toolMatchesQuery(null, 'x'), false);
  assert.equal(toolMatchesQuery({ name: 'Exit' }, ''), true);
});

test('descriptions and My Tools hot-key badges follow the external editor', () => {
  assert.equal(toolDescription(preset('x', 'X', 'cloudPolyline', { mode: 'drawing' })), 'Cloud+ · Drawing Mode');
  assert.equal(toolDescription(preset('x', 'X', 'line'), { recent: true }), 'Line · session style');
  assert.deepEqual([0, 1, 8, 9, 10, -1].map(myToolsBadge), ['1', '2', '9', '0', '', '']);
});

test('section collapse state and Detail view are remembered across a restart', () => {
  const storage = memoryStorage();
  let state = readSectionState(storage);
  // Defaults: My Tools, Recent Tools, and the electrical receptacles open.
  assert.equal(isSectionOpen(state, MY_TOOLS_SECTION), true);
  assert.equal(isSectionOpen(state, RECENT_SECTION), true);
  assert.equal(isSectionOpen(state, librarySectionId('electrical')), true);
  assert.equal(isSectionOpen(state, librarySectionId('oculith-power')), true);
  assert.equal(isSectionOpen(state, toolSetSectionId('set_arch')), false);
  assert.equal(isSectionOpen(state, librarySectionId('oculith-lighting')), false);

  state = withSectionToggled(state, MY_TOOLS_SECTION);
  state = withSectionToggled(state, toolSetSectionId('set_arch'));
  state = withSectionView(state, toolSetSectionId('set_arch'), 'detail');
  assert.equal(writeSectionState(state, storage), true);
  assert.ok(storage.values.has(SECTION_STATE_KEY));

  const reloaded = readSectionState(storage);
  assert.equal(isSectionOpen(reloaded, MY_TOOLS_SECTION), false);
  assert.equal(isSectionOpen(reloaded, toolSetSectionId('set_arch')), true);
  assert.equal(isSectionOpen(reloaded, RECENT_SECTION), true, 'untouched sections keep their default');
  assert.equal(sectionView(reloaded, toolSetSectionId('set_arch')), 'detail');
  assert.equal(sectionView(reloaded, MY_TOOLS_SECTION), 'symbol');
  assert.equal(sectionView(withSectionView(reloaded, toolSetSectionId('set_arch'), 'symbol'),
    toolSetSectionId('set_arch')), 'symbol');

  // Expand all / Collapse all over the listed sections.
  const ids = sections().map(s => s.id);
  const collapsed = withAllSections(reloaded, ids, false);
  assert.ok(ids.every(id => !isSectionOpen(collapsed, id)));
  assert.ok(ids.every(id => isSectionOpen(withAllSections(collapsed, ids, true), id)));

  // A removed set is forgotten.
  const pruned = pruneSectionState(reloaded, [MY_TOOLS_SECTION, RECENT_SECTION]);
  assert.deepEqual(Object.keys(pruned.open), [MY_TOOLS_SECTION]);
  assert.deepEqual(pruned.detail, []);
});

test('unreadable or hostile stored section state falls back to the defaults', () => {
  assert.deepEqual(readSectionState(memoryStorage({ [SECTION_STATE_KEY]: '{not json' })), { open: {}, detail: [] });
  assert.deepEqual(readSectionState({ getItem() { throw new Error('blocked'); } }), { open: {}, detail: [] });
  assert.deepEqual(cleanSectionState({ open: { 'set:a': 'yes', 'lib:<b>': true, recent: false, other: true },
    detail: ['set:a', 'set:a', 7, 'x'] }), { open: { recent: false }, detail: ['set:a'] });
  assert.equal(writeSectionState({ open: {} }, { setItem() { throw new Error('full'); } }), false);
});
