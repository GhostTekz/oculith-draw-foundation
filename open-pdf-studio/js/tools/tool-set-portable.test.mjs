import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPortableToolSetBytes, parsePortableToolSetBytes, suggestedPortableToolSetName,
  TOOL_SET_FORMAT, MAX_PORTABLE_SET_BYTES,
} from './tool-set-portable.js';

const encode = value => new TextEncoder().encode(JSON.stringify(value));
const valid = () => ({
  format: TOOL_SET_FORMAT, version: 1, name: 'Electrical review',
  tools: [{ name: 'Orange line', tool: 'line', style: { strokeColor: '#ea6715', lineWidth: 5, opacity: 0.65 } }],
});

test('portable JSON contains only set, tool, and supported appearance fields', () => {
  const bytes = buildPortableToolSetBytes('Electrical review', [{
    id: 'private-local-id', setId: 'private-set-id', name: 'Orange line', tool: 'line',
    style: { strokeColor: '#ea6715', lineWidth: 5, opacity: 0.65 },
    page: 17, x: 340, subject: 'Private plan note', sourcePath: '/plans/private.pdf',
    mode: 'drawing', geometry: { kind: 'line', dx: 65, dy: 40 },
  }]);
  const text = new TextDecoder().decode(bytes);
  assert.deepEqual(parsePortableToolSetBytes(bytes), valid());
  for (const secret of ['private-local-id', 'private-set-id', 'Private plan note', '/plans/private.pdf', '"page"', '"x"', '"geometry"', '"mode"']) {
    assert.equal(text.includes(secret), false, `${secret} must not leave the app`);
  }
  assert.equal(suggestedPortableToolSetName('A:101 / Electrical'), 'A_101_Electrical.ocudraw-tools.json');
  assert.equal(parsePortableToolSetBytes(encode({ ...valid(), tools: [{ name: 'Outline', tool: 'box', style: { fillColor: 'transparent' } }] }))
    .tools[0].style.fillColor, 'transparent');
});

test('portable parser rejects extra fields, unsupported types, malformed style, version, and oversized bytes', () => {
  const cases = [
    { value: { ...valid(), sourcePdf: '/secret.pdf' }, error: /extra fields/u },
    { value: { ...valid(), version: 4 }, error: /version/u },
    { value: { ...valid(), tools: [{ ...valid().tools[0], page: 3 }] }, error: /extra fields/u },
    { value: { ...valid(), tools: [{ ...valid().tools[0], tool: 'script' }] }, error: /unsupported type/u },
    { value: { ...valid(), tools: [{ name: 'Local only', tool: 'callout', style: { strokeColor: '#ea6715' } }] }, error: /unsupported type/u },
    { value: { ...valid(), tools: [{ ...valid().tools[0], style: { strokeColor: '#ea6715', geometry: [1, 2] } }] }, error: /extra fields/u },
    { value: { ...valid(), tools: [{ ...valid().tools[0], style: { strokeColor: 'url(https://example.com)' } }] }, error: /hex color/u },
    { value: { ...valid(), tools: [{ ...valid().tools[0], style: { opacity: 2 } }] }, error: /range/u },
    { value: { ...valid(), tools: Array(51).fill(valid().tools[0]) }, error: /at most 50/u },
  ];
  for (const { value, error } of cases) assert.throws(() => parsePortableToolSetBytes(encode(value)), error);
  assert.throws(() => parsePortableToolSetBytes(new Uint8Array(MAX_PORTABLE_SET_BYTES + 1)), /at most/u);
  assert.throws(() => parsePortableToolSetBytes(Uint8Array.of(0xff)), /UTF-8/u);
});

test('version 2 exports callout appearance and explicit relative geometry without source content', () => {
  const geometry = { kind: 'callout', boxDx: 110, boxDy: -50,
    width: 170, height: 70, kneeDx: 85, kneeDy: -15, armDx: 110, armDy: -15 };
  const callout = { name: 'Review callout', tool: 'callout', mode: 'drawing', geometry,
    style: { strokeColor: '#b84216', fillColor: '#fff2db', textColor: '#153558',
      fontSize: 15, fontFamily: 'Arial', fontBold: true, lineWidth: 2.5,
      borderStyle: 'dashed', opacity: 0.8, leaderStyle: 'curved',
      borderEffect: 'cloudy', cloudIntensity: 1, textPadding: 4 },
    text: 'PRIVATE SOURCE TEXT', author: 'PRIVATE AUTHOR', page: 9,
    arrowX: 100, x: 210, pdfPath: '/private/plan.pdf' };
  const bytes = buildPortableToolSetBytes('Review', [
    { name: 'Orange line', tool: 'line', style: { strokeColor: '#ea6715' } },
    { ...callout, name: 'Blank callout', mode: 'properties' }, callout,
  ]);
  const parsed = parsePortableToolSetBytes(bytes);
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.tools.map(tool => tool.tool), ['line', 'callout', 'callout']);
  assert.deepEqual(Object.keys(parsed.tools[1]), ['name', 'tool', 'style']);
  assert.deepEqual(parsed.tools[2], { name: 'Review callout', tool: 'callout',
    style: callout.style, mode: 'drawing', geometry });
  const output = new TextDecoder().decode(bytes);
  for (const sourceOnly of ['PRIVATE SOURCE', '/private/plan.pdf', '"page"', '"arrowX"',
    '"x"', '"author"', '"pdfPath"', '"text"']) {
    assert.equal(output.includes(sourceOnly), false, `${sourceOnly} cannot enter v2`);
  }
  assert.equal(parsePortableToolSetBytes(buildPortableToolSetBytes('Old shapes', [
    { name: 'Line', tool: 'line', style: { strokeColor: '#ea6715' } },
  ])).version, 1, 'existing shape sets keep their version 1 contract');
});

test('version 2 rejects malformed callout fields, geometry, and content', () => {
  const base = { name: 'Callout', tool: 'callout', style: { strokeColor: '#b84216',
    textColor: '#153558', fontSize: 15, fontFamily: 'Arial', leaderStyle: 'curved' },
  mode: 'drawing', geometry: { kind: 'callout', boxDx: 110, boxDy: -50,
    width: 170, height: 70, kneeDx: 85, kneeDy: -15, armDx: 110, armDy: -15 } };
  const invalid = [
    [{ ...base, text: 'PRIVATE' }, /extra fields/u],
    [{ ...base, page: 7 }, /extra fields/u],
    [{ ...base, geometry: { ...base.geometry, arrowX: 100 } }, /relative/u],
    [{ ...base, geometry: { ...base.geometry, boxDx: 1e9 } }, /relative/u],
    [{ ...base, geometry: { ...base.geometry, armDx: 111 } }, /relative/u],
    [{ ...base, geometry: { ...base.geometry, kneeDy: null } }, /relative/u],
    [{ ...base, style: { ...base.style, headSize: 9 } }, /extra fields/u],
    [{ ...base, style: { ...base.style, fontFamily: 'Arial;color:red' } }, /fontFamily/u],
    [{ ...base, style: { ...base.style, leaderStyle: 'script' } }, /leaderStyle/u],
    [{ ...base, style: { ...base.style, borderEffect: 'cloudy', cloudIntensity: 3 } }, /cloudIntensity/u],
    [{ ...base, style: { ...base.style, textPadding: -1 } }, /textPadding/u],
    [{ ...base, mode: 'properties' }, /extra fields/u],
    [{ name: 'Text from another drawing', tool: 'textbox',
      style: { textColor: '#153558' }, mode: 'drawing',
      geometry: { kind: 'box', width: 100, height: 35, rotation: 0 }, text: 'PRIVATE' }, /extra fields/u],
  ];
  for (const [tool, message] of invalid) {
    assert.throws(() => parsePortableToolSetBytes(encode({ ...valid(), version: 2, tools: [tool] })), message);
  }
  assert.throws(() => buildPortableToolSetBytes('Mixed', [base,
    { name: 'Text label', tool: 'textbox', style: { textColor: '#153558' },
      mode: 'drawing', geometry: { kind: 'box', width: 100, height: 35, rotation: 0 },
      text: 'PRIVATE' }]), /separate named set/u,
  'v2 export must fail rather than silently drop source textbox text');
});

test('textbox JSON exports appearance by default and Drawing Mode content only after explicit capture', () => {
  const source = { name: 'Review label', tool: 'textbox', style: { strokeColor: '#ea6715',
    fillColor: '#ffffff', textColor: '#123abc', fontSize: 14, fontFamily: 'Arial',
    fontBold: true, fontItalic: false, fontUnderline: false, textAlign: 'center', lineSpacing: 1.2 },
  mode: 'properties', geometry: { kind: 'box', width: 130, height: 48, rotation: 0 },
  text: 'ISSUED FOR REVIEW', page: 7, x: 210, y: 330, author: 'PRIVATE AUTHOR',
  subject: 'PRIVATE COMMENT', replies: [{ text: 'PRIVATE REPLY' }] };
  const properties = parsePortableToolSetBytes(buildPortableToolSetBytes('Labels', [source]));
  assert.deepEqual(Object.keys(properties.tools[0]), ['name', 'tool', 'style']);
  assert.deepEqual(properties.tools[0].style, source.style);
  const drawingBytes = buildPortableToolSetBytes('Labels', [{ ...source, mode: 'drawing' }]);
  const drawing = parsePortableToolSetBytes(drawingBytes).tools[0];
  assert.deepEqual(drawing, { name: source.name, tool: 'textbox', style: source.style,
    mode: 'drawing', geometry: source.geometry, text: source.text });
  for (const secret of ['PRIVATE AUTHOR', 'PRIVATE COMMENT', 'PRIVATE REPLY',
    '"page"', '"x"', '"y"', '"author"', '"subject"', '"replies"']) {
    assert.equal(new TextDecoder().decode(drawingBytes).includes(secret), false, secret);
  }
  assert.deepEqual(parsePortableToolSetBytes(encode(valid())), valid(),
    'the previous six-shape version 1 format remains readable');
});

test('textbox JSON rejects malformed content, coordinates, and appearance', () => {
  const base = { name: 'Label', tool: 'textbox', style: { textColor: '#123abc', fontSize: 14 },
    mode: 'drawing', geometry: { kind: 'box', width: 100, height: 35, rotation: 0 }, text: 'REVIEW' };
  const bad = [
    [{ ...base, x: 200 }, /extra fields/u],
    [{ ...base, geometry: { ...base.geometry, x: 200 } }, /relative size/u],
    [{ ...base, geometry: { ...base.geometry, width: 100001 } }, /relative size/u],
    [{ ...base, text: 'X'.repeat(2001) }, /display text/u],
    [{ ...base, text: 'Bad\u0000text' }, /display text/u],
    [{ ...base, text: 'Bad\u0085text' }, /display text/u],
    [{ ...base, style: { ...base.style, fontSize: 513 } }, /fontSize/u],
    [{ ...base, style: { ...base.style, fontFamily: 'Arial"/><x foo="bar' } }, /fontFamily/u],
    [{ ...base, style: { ...base.style, fontFamily: 'Arial;color:red' } }, /fontFamily/u],
    [{ ...base, style: { ...base.style, author: 'Private' } }, /extra fields/u],
    [{ ...base, mode: 'properties' }, /extra fields/u],
  ];
  for (const [tool, message] of bad) {
    assert.throws(() => parsePortableToolSetBytes(encode({ ...valid(), tools: [tool] })), message);
  }
});

test('import resolves duplicate set and preset names and rejects invalid files before changing storage', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const store = await import(`./tool-chest-presets.js?portable=${Date.now()}`);
    const first = store.createToolSet('Electrical review');
    store.saveToolPreset({ type: 'line', strokeColor: '#ea6715' }, 'Existing line', first.id);
    const exported = store.exportToolSet(first.id);
    const duplicateSet = store.importToolSet(exported);
    assert.equal(duplicateSet.set.name, 'Electrical review (2)');
    assert.equal(duplicateSet.tools[0].name, 'Existing line');
    const repeated = { ...valid(), tools: [valid().tools[0], valid().tools[0]] };
    const duplicateTools = store.importToolSet(encode(repeated));
    assert.equal(duplicateTools.set.name, 'Electrical review (3)');
    assert.deepEqual(duplicateTools.tools.map(tool => tool.name), ['Orange line', 'Orange line (2)']);
    const before = new Map(values);
    assert.throws(() => store.importToolSet(encode({ ...valid(), comment: 'unsafe' })), /extra fields/u);
    assert.deepEqual(values, before, 'a rejected file must not change either local storage key');
    assert.equal(store.getRecentTools().length, 0);

    const reloaded = await import(`./tool-chest-presets.js?portableReload=${Date.now()}`);
    assert.equal(reloaded.getToolChestSets().length, 4);
    assert.equal(reloaded.getToolChestPresets().length, 4);
    for (let index = 0; index < store.MAX_TOOL_CHEST_TOOLS - 4; index++) {
      store.saveToolPreset({ type: 'line', strokeColor: '#000000' }, `Filler ${index}`);
    }
    const fullStorage = new Map(values);
    assert.throws(() => store.importToolSet(encode(valid())), /not enough room/u);
    assert.deepEqual(values, fullStorage, 'capacity rejection must not create a partial set');
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('a malformed version 2 callout set leaves both local stores unchanged', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  try {
    const store = await import(`./tool-chest-presets.js?calloutAtomic=${Date.now()}`);
    const set = store.createToolSet('Existing');
    store.saveToolPreset({ type: 'line', strokeColor: '#ea6715' }, 'Existing line', set.id);
    const before = new Map(values);
    const malformed = { format: TOOL_SET_FORMAT, version: 2, name: 'Imported', tools: [
      { name: 'Good line', tool: 'line', style: { strokeColor: '#ea6715' } },
      { name: 'Bad callout', tool: 'callout', style: { strokeColor: '#b84216' },
        mode: 'drawing', geometry: { kind: 'callout', boxDx: 110, boxDy: -50,
          width: 170, height: 70, kneeDx: 85, kneeDy: -15, armDx: 110, armDy: -15,
          arrowX: 100 } },
    ] };
    assert.throws(() => store.importToolSet(encode(malformed)), /relative callout geometry/u);
    assert.deepEqual(values, before);
    assert.deepEqual(store.getToolChestSets().map(item => item.name), ['My tools', 'Existing']);
    assert.deepEqual(store.getToolChestPresets().map(item => item.name), ['Existing line']);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('named set export and import preserve textbox mode without source annotation fields', async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  try {
    const store = await import(`./tool-chest-presets.js?textboxPortable=${Date.now()}`);
    const set = store.createToolSet('Field labels');
    const annotation = { type: 'textbox', page: 4, x: 280, y: 190, width: 110, height: 35,
      text: 'CHECK FIELD', strokeColor: '#ea6715', textColor: '#123abc', fontSize: 14,
      author: 'PRIVATE AUTHOR', subject: 'PRIVATE COMMENT', replies: [{ text: 'PRIVATE REPLY' }] };
    store.saveToolPreset(annotation, 'Blank label', set.id);
    const drawing = store.saveToolPreset(annotation, 'Repeated label', set.id, { includeTextAndSize: true });
    store.toggleToolPresetMode(drawing.id);
    const bytes = store.exportToolSet(set.id);
    const tools = parsePortableToolSetBytes(bytes).tools;
    assert.equal(tools.length, 2);
    assert.deepEqual(Object.keys(tools[0]), ['name', 'tool', 'style']);
    assert.deepEqual([tools[1].mode, tools[1].text, tools[1].geometry.width], ['drawing', 'CHECK FIELD', 110]);
    for (const secret of ['PRIVATE AUTHOR', 'PRIVATE COMMENT', 'PRIVATE REPLY', '"x"', '"y"', '"page"']) {
      assert.equal(new TextDecoder().decode(bytes).includes(secret), false, secret);
    }
    const imported = store.importToolSet(bytes);
    assert.deepEqual(imported.tools.map(tool => tool.mode), ['properties', 'drawing']);
    assert.equal(imported.tools[0].text, undefined);
    assert.deepEqual([imported.tools[1].text, imported.tools[1].geometry.width], ['CHECK FIELD', 110]);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('version 3 carries a sequence pattern per tool; sets without one keep version 1 or 2', async () => {
  const { TOOL_SET_SEQUENCE_VERSION, portableVersionFor } = await import('./tool-set-portable.js');
  const sequence = { prefix: 'D-', suffix: '', start: 1, step: 1, digits: 2 };
  const line = { name: 'Orange line', tool: 'line', style: { strokeColor: '#ea6715' } };
  assert.equal(portableVersionFor([line]), 1);
  assert.equal(portableVersionFor([{ ...line, tool: 'callout' }]), 2);
  const bytes = buildPortableToolSetBytes('Doors', [
    { ...line, id: 'local', sequence, subject: 'PRIVATE' },
    { name: 'Door tag', tool: 'textbox', style: { textColor: '#153558' }, mode: 'drawing',
      geometry: { kind: 'box', width: 80, height: 20, rotation: 0 }, text: 'Fire door', sequence },
    { name: 'Door callout', tool: 'callout', style: { strokeColor: '#b84216' } },
  ]);
  const text = new TextDecoder().decode(bytes);
  assert.equal(text.includes('PRIVATE'), false);
  assert.equal(text.includes('next'), false, 'document counters never leave the PDF');
  const parsed = parsePortableToolSetBytes(bytes);
  assert.equal(parsed.version, TOOL_SET_SEQUENCE_VERSION);
  assert.deepEqual(parsed.tools[0].sequence, sequence);
  assert.equal(parsed.tools[1].text, 'Fire door', 'version 3 keeps Drawing Mode textbox text');
  assert.equal(parsed.tools[2].sequence, undefined);
  const v3 = JSON.parse(text);
  for (const bad of [{ ...sequence, step: 0 }, { ...sequence, next: 4 }, { prefix: 'D-', start: 1, step: 1, digits: 2 }]) {
    v3.tools[0].sequence = bad;
    assert.throws(() => parsePortableToolSetBytes(encode(v3)), /sequence/u, JSON.stringify(bad));
  }
  v3.tools[0].sequence = sequence;
  v3.version = 2;
  assert.throws(() => parsePortableToolSetBytes(encode(v3)), /extra fields/u, 'version 2 has no sequence');
});
