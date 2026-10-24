// Dynamic Fill session: replace vs Shift/Ctrl add/remove, temporary boundary
// lines, raster pages, Apply and Clear.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const session = await import('./session.js');
const { floorPlanLines, ROOM_A, ROOM_B, PT_PER_FT, EXPECTED_FT2 } = await import('./floor-plan.testhulp.mjs');

const H = 612;
const edges = floorPlanLines().map(([[x1, y1], [x2, y2]]) => ({ x1, y1: H - y1, x2, y2: H - y2 }));
const load = async () => edges;
const inRoom = (r) => ({ x: r.x + r.w / 2 + 40, y: H - (r.y + r.h / 2) });

function openDoc() {
  state.documents = [{ id: `df-s-${Math.random()}`, filePath: null, pdfDoc: {}, currentPage: 1, annotations: [],
    measureScale: { pixelsPerUnit: PT_PER_FT, unit: 'ft' }, pageRotations: {}, textEdits: [] }];
  state.activeDocumentIndex = 0;
  session.cancel();
  session.setOptions({ gap: 60, output: 'area', mode: 'fill' });
}

test('a click replaces the fill; Shift adds a region and removes it again', async () => {
  openDoc();
  const a = inRoom(ROOM_A), b = inRoom(ROOM_B);
  assert.equal((await session.fillAt(1, a.x, a.y, false, load)).status, 'ok');
  assert.equal((await session.fillAt(1, b.x, b.y, false, load)).status, 'ok');
  assert.equal(session.status().fills, 1, 'a plain click replaces');
  await session.fillAt(1, a.x, a.y, true, load);
  assert.equal(session.status().fills, 2, 'Shift adds');
  assert.equal((await session.fillAt(1, a.x, a.y, true, load)).status, 'removed');
  assert.equal(session.status().fills, 1);
  session.clearFills();
  assert.equal(session.hasFills(), false);
});

test('outside the plan and on a raster page the bar says why nothing filled', async () => {
  openDoc();
  assert.equal((await session.fillAt(1, 10, 10, false, load)).status, 'open');
  assert.equal(session.status().message, 'open');
  assert.equal((await session.fillAt(1, 300, 300, false, async () => [])).status, 'noVector');
  assert.equal(session.status().message, 'noVector');
  assert.equal(session.hasFills(), false);
});

test('a boundary line closes the door without a gap tolerance and is cleared by Apply', async () => {
  openDoc();
  session.setOptions({ gap: 0, mode: 'boundary' });
  // Across the door, from jamb to jamb (as drawn, overlapping the wall line).
  session.addBoundaryPoint(1, 460, H - 190);
  session.addBoundaryPoint(1, 460, H - 264);
  session.finishBoundary();
  assert.equal(session.status().boundaries, 1);
  session.setOptions({ mode: 'fill' });
  const a = inRoom(ROOM_A);
  const r = await session.fillAt(1, a.x, a.y, false, load);
  assert.equal(r.status, 'ok');
  const expected = EXPECTED_FT2.A;
  assert.ok(Math.abs(r.area / PT_PER_FT ** 2 - expected) < 1e-6, `${r.area / PT_PER_FT ** 2} vs ${expected}`);
  const anns = await session.apply();
  assert.equal(anns.length, 1);
  assert.equal(anns[0].type, 'measureArea');
  assert.equal(state.documents[0].annotations.length, 1);
  assert.equal(session.status().boundaries, 0, 'boundaries are temporary');
  assert.equal(session.hasFills(), false);
});

test('Perimeter output gives one closed measurement per region', async () => {
  openDoc();
  session.setOptions({ output: 'perimeter' });
  const a = inRoom(ROOM_A), b = inRoom(ROOM_B);
  await session.fillAt(1, a.x, a.y, false, load);
  await session.fillAt(1, b.x, b.y, true, load);
  const anns = await session.apply();
  assert.deepEqual(anns.map((x) => x.type), ['measurePerimeter', 'measurePerimeter']);
  assert.ok(Math.abs(anns[0].measureValue - 70) < 1e-6);
  assert.ok(Math.abs(anns[1].measureValue - 50) < 1e-6);
  const pts = anns[0].points;
  assert.deepEqual(pts[0], pts[pts.length - 1], 'closed path');
});

test('options are validated and remembered in preferences', () => {
  openDoc();
  session.setOptions({ output: 'bogus', gap: -4 });
  assert.deepEqual(session.options().outputs, ['area']);
  assert.equal(session.options().gap, 0);
  session.setOptions({ output: 'polylength', gap: 12 });
  assert.deepEqual([...state.preferences.dynamicFillOutputs], ['polylength']);
  assert.equal(state.preferences.dynamicFillGap, 12);
  // Toggles keep display order and never leave nothing selected.
  session.toggleOutput('area');
  assert.deepEqual(session.options().outputs, ['area', 'polylength']);
  session.toggleOutput('polylength');
  session.toggleOutput('area');
  assert.deepEqual(session.options().outputs, ['area']);
  assert.deepEqual(session.normaliseOutputs(['polygon', 'nope', 'volume', 'space']), ['space', 'volume', 'polygon']);
});

test('several outputs at once: Area, Volume and Polygon from one fill (the external editor Create options)', async () => {
  openDoc();
  state.preferences.measureVolumeDepth = 10;
  state.preferences.measureVolumeDepthUnit = 'ft';
  session.setOptions({ outputs: ['polygon', 'volume', 'area'] });
  const a = inRoom(ROOM_A);
  await session.fillAt(1, a.x, a.y, false, load);
  const anns = await session.apply();
  assert.deepEqual(anns.map((x) => x.measureKind === 'volume' ? 'volume' : x.type), ['measureArea', 'volume', 'filledArea']);
  assert.ok(Math.abs(anns[0].measureValue - EXPECTED_FT2.A) < 1e-6);
  assert.ok(Math.abs(anns[1].measureVolumeValue - EXPECTED_FT2.A * 10) < 1e-6, `volume ${anns[1].measureVolumeValue}`);
  assert.equal(anns[1].measureVolumeUnit, 'ft³');
  state.preferences.measureVolumeDepth = undefined;
});

test('dragging paints every region it passes; points inside a fill do nothing', async () => {
  openDoc();
  const a = inRoom(ROOM_A), b = inRoom(ROOM_B);
  await session.fillAt(1, a.x, a.y, false, load);
  assert.equal((await session.fillAt(1, a.x + 30, a.y, 'paint', load)).status, 'inside');
  assert.equal((await session.fillAt(1, 465, a.y, 'paint', load)).status, 'ok', 'the door recess is its own region');
  assert.equal((await session.fillAt(1, b.x, b.y, 'paint', load)).status, 'ok');
  assert.equal((await session.fillAt(1, 10, 10, 'paint', load)).status, 'open');
  assert.equal(session.status().message, '', 'crossing the outside while painting is not an error');
  assert.equal(session.status().fills, 3);
});

test('Clear Boundaries keeps the fills; Clear Fill keeps the boundaries', async () => {
  openDoc();
  session.setOptions({ mode: 'boundary' });
  session.addBoundaryPoint(1, 460, H - 190);
  session.addBoundaryPoint(1, 460, H - 264);
  session.finishBoundary();
  session.setOptions({ mode: 'fill' });
  const a = inRoom(ROOM_A);
  await session.fillAt(1, a.x, a.y, false, load);
  session.clearBoundaries();
  assert.equal(session.status().boundaries, 0);
  assert.equal(session.status().fills, 1);
  session.setOptions({ mode: 'boundary' });
  session.addBoundaryPoint(1, 0, 0);
  session.addBoundaryPoint(1, 5, 5);
  session.finishBoundary();
  session.clearFills();
  assert.equal(session.status().fills, 0);
  assert.equal(session.status().boundaries, 1);
});

test('encircling the building fills every closed region inside the loop', async () => {
  openDoc();
  const loop = [{ x: 80, y: H - 80 }, { x: 670, y: H - 80 }, { x: 670, y: H - 390 }, { x: 80, y: H - 390 }];
  const added = await session.fillInside(1, loop, load);
  assert.ok(added >= 3, `regions added: ${added}`);
  const ft2 = (r) => r.area / PT_PER_FT ** 2;
  const areas = session._session().regions.map(ft2);
  assert.ok(areas.some((a) => Math.abs(a - EXPECTED_FT2.A) < 1e-6), 'room A');
  assert.ok(areas.some((a) => Math.abs(a - EXPECTED_FT2.B) < 1e-6), 'room B');
  assert.ok(areas.some((a) => Math.abs(a - 4) < 1e-6), 'the column');
  const total = areas.reduce((x, y) => x + y, 0);
  assert.ok(total <= (567 * 288) / PT_PER_FT ** 2 + 1e-6, `no more than the building: ${total}`);
  // A loop inside room A that holds nothing closed adds nothing.
  openDoc();
  const cut = [{ x: 120, y: H - 120 }, { x: 240, y: H - 120 }, { x: 240, y: H - 190 }, { x: 120, y: H - 190 }];
  assert.equal(await session.fillInside(1, cut, load), 0);
  assert.equal(session.status().message, 'nothingInside');
});

test('settings: preview colours and hiding markups are validated and remembered', () => {
  openDoc();
  session.setOptions({ fillColor: '#FF0000', boundaryColor: 'red', hideMarkups: true });
  assert.equal(session.options().fillColor, '#ff0000');
  assert.equal(session.options().boundaryColor, session.DEFAULT_BOUNDARY_COLOR, 'not a #rrggbb colour');
  assert.equal(state.preferences.dynamicFillColor, '#ff0000');
  assert.equal(state.preferences.dynamicFillHideMarkups, true);
  session.setOptions({ fillColor: session.DEFAULT_FILL_COLOR, hideMarkups: false });
  assert.equal(state.preferences.dynamicFillHideMarkups, false);
  session.setOptions({ minWeight: 0.25 });
  assert.equal(state.preferences.dynamicFillMinWeight, 0.25);
  session.setOptions({ minWeight: -3 });
  assert.equal(session.options().minWeight, 0);
  session.setOptions({ minWeight: 99 });
  assert.equal(session.options().minWeight, session.MAX_MIN_WEIGHT);
  session.setOptions({ minWeight: 0 });
});

test('Space output: a numbered room per region with its tag, in the floor-plan room model', async () => {
  openDoc();
  const { isRuimteVlak, ruimteVanTag, tagWeergaveParams } = await import('../../plattegrond/ruimte-koppeling.js');
  session.setOptions({ outputs: ['space'], spaceName: 'Office' });
  const a = inRoom(ROOM_A), b = inRoom(ROOM_B);
  await session.fillAt(1, a.x, a.y, false, load);
  await session.fillAt(1, b.x, b.y, true, load);
  const anns = await session.apply();
  assert.deepEqual(anns.map((x) => x.type), ['measureArea', 'parametricSymbol', 'measureArea', 'parametricSymbol']);
  const [roomA, tagA, roomB, tagB] = anns;
  assert.ok(isRuimteVlak(roomA) && isRuimteVlak(roomB));
  assert.deepEqual([roomA.opsRuimteNaam, roomA.opsRuimteNummer, roomB.opsRuimteNummer], ['Office', '1', '2']);
  assert.ok(Math.abs(roomA.measureValue - EXPECTED_FT2.A) < 1e-6);
  assert.equal(roomA.holes.length, 1, 'the column is cut out of the room');
  const all = state.documents[0].annotations;
  assert.equal(ruimteVanTag(tagA, all)?.id, roomA.id);
  assert.equal(ruimteVanTag(tagB, all)?.id, roomB.id);
  assert.equal(tagWeergaveParams(tagA, all).oppervlakteTekst, '296.00 ft²');
  // The next Space on the page continues the numbering.
  session.setOptions({ spaceName: '' });
  await session.fillAt(1, a.x, a.y, false, load);
  const [roomC] = await session.apply();
  assert.equal(roomC.opsRuimteNummer, '3');
  assert.ok(roomC.opsRuimteNaam.length > 0, 'a default name');
  session.setOptions({ outputs: ['area'] });
});

function useInvoke(invoke) {
  const previous = globalThis.window.__TAURI__;
  globalThis.window.__TAURI__ = { core: { invoke } };
  return () => {
    if (previous === undefined) delete globalThis.window.__TAURI__;
    else globalThis.window.__TAURI__ = previous;
  };
}

// Apply schedules geos_net_area on a later turn. Let that read a missing
// command before a test installs its own invoke.
async function settleGeometry() {
  await import('../../annotations/geos-area.js');
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('a gap keeps the flood and 296 ft² when polygonize returns no face', async () => {
  openDoc();
  await settleGeometry();
  const a = inRoom(ROOM_A);
  let calls = 0;
  const restore = useInvoke(async (cmd, args) => {
    if (cmd !== 'geos_polygonize') return null;
    calls += 1;
    assert.ok(Array.isArray(args.lines) && args.lines.length > 0 && args.lines.length <= 800);
    const unchanged = args.lines.some((line) => edges.some((edge) => (
      line[0][0] === edge.x1 && line[0][1] === edge.y1 && line[1][0] === edge.x2 && line[1][1] === edge.y2
    )));
    assert.equal(unchanged, true, 'annotation-space segments are passed through');
    return [];
  });
  try {
    const r = await session.fillAt(1, a.x, a.y, false, load);
    assert.equal(r.status, 'ok');
    assert.ok(Math.abs(r.area / PT_PER_FT ** 2 - EXPECTED_FT2.A) < 1e-6, `${r.area / PT_PER_FT ** 2}`);
    assert.equal(r.holes.length, 1, 'the column is still a hole');
  } finally {
    restore();
  }
  assert.equal(calls, 1);
  assert.equal(globalThis.window.__TAURI__, undefined);
  const anns = await session.apply();
  assert.ok(Math.abs(anns[0].measureValue - EXPECTED_FT2.A) < 1e-6);
  assert.equal(anns[0].holes.length, 1);
});

test('a covering polygonize face becomes the applied contour', async () => {
  openDoc();
  await settleGeometry();
  const a = inRoom(ROOM_A);
  const shell = [[300, 350], [360, 350], [360, 410], [300, 410]];
  const restore = useInvoke(async (cmd) => (cmd === 'geos_polygonize'
    ? [{ shell, holes: [], area: 3600 }]
    : null));
  let r;
  try {
    r = await session.fillAt(1, a.x, a.y, false, load);
  } finally {
    restore();
  }
  assert.equal(globalThis.window.__TAURI__, undefined);
  const expected = shell.map(([x, y]) => ({ x, y }));
  assert.deepEqual(r.outer, expected);
  assert.equal(r.holes.length, 0);
  assert.equal(r.area, 3600);
  assert.deepEqual(session._session().regions[0].outer, expected);
  const anns = await session.apply();
  assert.deepEqual(anns[0].points, expected);
});

test('paint does not ask polygonize', async () => {
  openDoc();
  await settleGeometry();
  const a = inRoom(ROOM_A);
  let calls = 0;
  const restore = useInvoke(async (cmd) => {
    if (cmd !== 'geos_polygonize') return null;
    calls += 1;
    return [];
  });
  try {
    const r = await session.fillAt(1, a.x, a.y, 'paint', load);
    assert.equal(r.status, 'ok');
    assert.ok(Math.abs(r.area / PT_PER_FT ** 2 - EXPECTED_FT2.A) < 1e-6);
  } finally {
    restore();
  }
  assert.equal(calls, 0);
  assert.equal(globalThis.window.__TAURI__, undefined);
});

test('a stale click does not write the polygonized face', async () => {
  openDoc();
  await settleGeometry();
  const a = inRoom(ROOM_A);
  let releaseFirst;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let calls = 0;
  const restore = useInvoke((cmd) => {
    if (cmd !== 'geos_polygonize') return null;
    calls += 1;
    if (calls === 1) {
      markStarted();
      return new Promise((done) => { releaseFirst = done; });
    }
    return [];
  });
  try {
    const first = session.fillAt(1, a.x, a.y, false, load);
    await Promise.race([
      started,
      new Promise((_, reject) => { setTimeout(() => reject(new Error('polygonize was not called')), 1000); }),
    ]);
    const second = await session.fillAt(1, a.x, a.y, false, load);
    releaseFirst([{ shell: [[300, 350], [360, 350], [360, 410], [300, 410]], holes: [], area: 3600 }]);
    const late = await first;
    assert.equal(second.status, 'ok');
    assert.equal(late.status, 'stale');
    assert.ok(Math.abs(second.area / PT_PER_FT ** 2 - EXPECTED_FT2.A) < 1e-6);
    assert.equal(session.status().fills, 1);
    assert.ok(Math.abs(session._session().regions[0].area / PT_PER_FT ** 2 - EXPECTED_FT2.A) < 1e-6);
    assert.equal(session._session().regions[0].holes.length, 1);
  } finally {
    restore();
  }
  assert.equal(globalThis.window.__TAURI__, undefined);
});

test('the fill engine without a worker (node) gives plain, transferable results', async () => {
  const engine = await import('./fill-engine.js');
  assert.equal(engine.usesWorker(), false, 'node has no Web Worker: in place');
  const a = inRoom(ROOM_A);
  const r = await engine.fill(edges, a, { gap: 60 });
  assert.equal(r.status, 'ok');
  assert.ok(Math.abs(r.area / PT_PER_FT ** 2 - EXPECTED_FT2.A) < 1e-6);
  assert.equal(typeof r.escape, 'undefined');
  assert.doesNotThrow(() => structuredClone(r), 'a worker can post it');
  // Paint memo: an open flood is remembered; the next paint point in it is open at once.
  const open = await engine.fill(edges, { x: 10, y: 10 }, { gap: 0 }, true);
  assert.equal(open.status, 'open');
  const inside = await engine.inside(edges, [{ x: 80, y: H - 80 }, { x: 670, y: H - 80 }, { x: 670, y: H - 390 }, { x: 80, y: H - 390 }], [], { gap: 60 });
  assert.ok(inside.length >= 3);
  assert.doesNotThrow(() => structuredClone(inside));
});
