// The floating thumbnail tile: where it opens, what it remembers, and its grid.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  TILE_DEFAULTS, areaFor, clampToArea, defaultTileRect, monitorAreas, parseTileMemory, tileMemory, tilePlacement,
} from './thumbnail-tile-placement.js';
import {
  TILE_MAX_PAGES, filterPages, gridMetrics, pageCaption, scrollToShow, stepIndex, tilePageInfo, validTilePages, visibleSlice,
} from './thumbnail-tile-grid.js';

const monitor = (name, x, y, width, height, scaleFactor = 1, taskbar = 0) => ({
  name, scaleFactor, position: { x, y }, size: { width, height },
  workArea: { position: { x, y }, size: { width, height: height - taskbar } },
});
const LAPTOP = monitor('eDP-1', 0, 0, 1920, 1080, 1, 40);
const RIGHT = monitor('DP-2', 1920, 0, 2560, 1440, 1);
const HIDPI = monitor('DP-3', -3840, 0, 3840, 2160, 2);
const inside = (rect, area) => rect.x >= area.x && rect.y >= area.y
  && rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;

test('monitor areas use the work area and keep the scale factor', () => {
  const [laptop, hidpi] = monitorAreas([LAPTOP, HIDPI, { name: 'broken' }]);
  assert.deepEqual(laptop, { name: 'eDP-1', x: 0, y: 0, width: 1920, height: 1040, scale: 1 });
  assert.equal(hidpi.scale, 2);
  assert.equal(monitorAreas(null).length, 0);
  assert.equal(areaFor({ x: 1800, y: 10, width: 400, height: 400 }, monitorAreas([LAPTOP, RIGHT])).name, 'DP-2');
});

test('the first tile is a narrow column at the drawing window right edge, not full screen', () => {
  const owner = { x: 100, y: 50, width: 1600, height: 900 };
  const rect = tilePlacement({ memory: null, monitors: [LAPTOP, RIGHT], owner });
  assert.equal(rect.restored, false);
  assert.equal(rect.width, TILE_DEFAULTS.width);
  assert.equal(rect.height, Math.round(1040 * TILE_DEFAULTS.heightFraction));
  assert.equal(rect.x + rect.width, owner.x + owner.width - TILE_DEFAULTS.edgeGap);
  assert.equal(rect.y, owner.y + TILE_DEFAULTS.topGap);
  assert.ok(inside(rect, monitorAreas([LAPTOP])[0]));
});

test('the first tile scales with a HiDPI monitor and stays on the drawing window monitor', () => {
  const owner = { x: -3800, y: 40, width: 3700, height: 2000 };
  const rect = tilePlacement({ memory: null, monitors: [LAPTOP, HIDPI], owner });
  assert.equal(rect.scale, 2);
  assert.equal(rect.width, TILE_DEFAULTS.width * 2);
  assert.ok(inside(rect, monitorAreas([HIDPI])[0]));
});

test('a maximized drawing window still gets a tile inside the screen', () => {
  const rect = defaultTileRect({ x: 0, y: 0, width: 1920, height: 1040 }, monitorAreas([LAPTOP]));
  assert.ok(inside(rect, monitorAreas([LAPTOP])[0]));
  assert.ok(rect.width < 1920 / 4);
});

test('the tile returns to its remembered monitor and spot', () => {
  const memory = JSON.stringify(tileMemory({ x: 4000, y: 300, width: 320, height: 900 }, monitorAreas([RIGHT])[0]));
  const rect = tilePlacement({ memory, monitors: [LAPTOP, RIGHT], owner: { x: 0, y: 0, width: 1200, height: 800 } });
  assert.deepEqual(rect, { x: 4000, y: 300, width: 320, height: 900, scale: 1, restored: true });
});

test('a remembered monitor that moved in the arrangement keeps the tile at the same spot on it', () => {
  const memory = tileMemory({ x: 4000, y: 300, width: 320, height: 900 }, monitorAreas([RIGHT])[0]);
  const movedLeft = monitor('DP-2', -2560, 0, 2560, 1440, 1);
  const rect = tilePlacement({ memory, monitors: [LAPTOP, movedLeft], owner: null });
  assert.equal(rect.x, -2560 + (4000 - 1920));
  assert.equal(rect.y, 300);
  assert.equal(rect.restored, true);
});

test('a remembered monitor with another scale now converts the tile size', () => {
  const memory = tileMemory({ x: 2000, y: 100, width: 300, height: 600 }, monitorAreas([RIGHT])[0]);
  const scaled = monitor('DP-2', 1920, 0, 5120, 2880, 2);
  const rect = tilePlacement({ memory, monitors: [LAPTOP, scaled], owner: null });
  assert.equal(rect.width, 600);
  assert.equal(rect.height, 1200);
  assert.equal(rect.x, 1920 + 160);
});

test('a disconnected monitor sends the tile back beside the drawing window', () => {
  const memory = tileMemory({ x: 4000, y: 300, width: 320, height: 900 }, monitorAreas([RIGHT])[0]);
  const owner = { x: 100, y: 50, width: 1600, height: 900 };
  const rect = tilePlacement({ memory, monitors: [LAPTOP], owner });
  assert.equal(rect.restored, false);
  assert.deepEqual(rect, tilePlacement({ memory: null, monitors: [LAPTOP], owner }));
});

test('a remembered tile partly off screen is pulled back and shrunk to fit', () => {
  const memory = tileMemory({ x: 1800, y: 900, width: 400, height: 3000 }, monitorAreas([LAPTOP])[0]);
  const rect = tilePlacement({ memory, monitors: [LAPTOP], owner: null });
  assert.ok(inside(rect, monitorAreas([LAPTOP])[0]));
  assert.equal(rect.height, 1040);
  assert.equal(rect.width, 400);
});

test('a remembered tile without a monitor name is matched by position', () => {
  const memory = { x: 2100, y: 100, width: 300, height: 700, monitor: null };
  const rect = tilePlacement({ memory, monitors: [LAPTOP, RIGHT], owner: null });
  assert.equal(rect.restored, true);
  assert.equal(rect.x, 2100);
});

test('tile memory rejects anything that is not a rectangle', () => {
  assert.equal(parseTileMemory('not json'), null);
  assert.equal(parseTileMemory('{"x":1,"y":2,"width":0,"height":5}'), null);
  assert.equal(parseTileMemory({ x: 'a', y: 0, width: 1, height: 1 }), null);
  assert.equal(tileMemory({ x: 0, y: 0, width: 0, height: 10 }, null), null);
  const ok = parseTileMemory({ x: 1, y: 2, width: 3, height: 4, monitor: { name: 5, x: 0, y: 0, width: 9, height: 9 } });
  assert.equal(ok.monitor.name, '');
  assert.equal(ok.monitor.scale, 1);
});

test('with no monitor information the tile still opens beside the drawing window', () => {
  const owner = { x: 100, y: 50, width: 1600, height: 900 };
  const rect = tilePlacement({ memory: null, monitors: [], owner });
  assert.equal(rect.width, TILE_DEFAULTS.width);
  assert.equal(rect.restored, false);
  assert.deepEqual(clampToArea({ x: -50, y: 5, width: 100, height: 100 }, { x: 0, y: 0, width: 80, height: 300 }, 60, 60),
    { x: 0, y: 5, width: 80, height: 100 });
});

test('the grid fits columns to the tile width and the size step', () => {
  assert.equal(gridMetrics(300, 's').columns, 3);
  assert.equal(gridMetrics(300, 'm').columns, 2);
  assert.equal(gridMetrics(300, 'l').columns, 1);
  assert.equal(gridMetrics(100, 'l').columns, 1);
  const m = gridMetrics(300, 'm');
  assert.ok(m.tileWidth * m.columns <= 300);
  assert.ok(m.rowHeight > m.imageHeight);
});

test('the visible slice is bounded and accounts for every row', () => {
  const metrics = gridMetrics(300, 's');
  const slice = visibleSlice(1000, metrics, 5000, 600);
  assert.ok(slice.end - slice.start <= TILE_MAX_PAGES);
  assert.equal(slice.start % metrics.columns, 0);
  const rows = Math.ceil(1000 / metrics.columns);
  const drawnRows = Math.ceil((slice.end - slice.start) / metrics.columns);
  assert.equal(slice.top + slice.bottom + drawnRows * metrics.rowHeight, rows * metrics.rowHeight);
  assert.deepEqual(visibleSlice(0, metrics, 0, 600), { start: 0, end: 0, top: 0, bottom: 0 });
  assert.deepEqual(visibleSlice(5, metrics, 0, 600), { start: 0, end: 5, top: 0, bottom: 0 });
});

test('keeping the current page in view scrolls only when it is outside', () => {
  const metrics = { columns: 2, rowHeight: 100 };
  assert.equal(scrollToShow(0, metrics, 0, 300), 0);
  assert.equal(scrollToShow(9, metrics, 0, 300), 200);
  assert.equal(scrollToShow(2, metrics, 250, 300), 100);
});

test('captions prefer the sheet number, then the page label, then the page number', () => {
  assert.deepEqual(pageCaption(3, { sheet: 'A-101', label: '3', title: 'Floor plan' }),
    { primary: 'A-101', secondary: 'Floor plan', page: 3 });
  assert.deepEqual(pageCaption(4, { label: 'E-2' }), { primary: 'E-2', secondary: '', page: 4 });
  assert.deepEqual(pageCaption(5, null), { primary: '5', secondary: '', page: 5 });
  assert.equal(pageCaption(6, { sheet: 'M-1', label: 'vi' }).secondary, 'vi');
});

test('the filter matches every word against number, label, sheet and title', () => {
  const info = { 1: { label: 'A-101', title: 'Ground floor plan' }, 2: { label: 'A-102', title: 'Roof plan' },
    3: { sheet: 'E-201', title: 'Lighting' }, 4: {} };
  const of = (page) => info[page];
  assert.deepEqual(filterPages(4, of, ''), [1, 2, 3, 4]);
  assert.deepEqual(filterPages(4, of, 'plan'), [1, 2]);
  assert.deepEqual(filterPages(4, of, 'a-1 roof'), [2]);
  assert.deepEqual(filterPages(4, of, 'e-2'), [3]);
  assert.deepEqual(filterPages(4, of, '4'), [4]);
  assert.deepEqual(filterPages(4, of, 'LIGHT'), [3]);
});

test('arrow keys move through the grid by column and row, clamped to the list', () => {
  assert.equal(stepIndex(4, 'ArrowRight', 3, 10), 5);
  assert.equal(stepIndex(4, 'ArrowDown', 3, 10), 7);
  assert.equal(stepIndex(8, 'ArrowDown', 3, 10), 9);
  assert.equal(stepIndex(1, 'ArrowUp', 3, 10), 0);
  assert.equal(stepIndex(-1, 'ArrowDown', 3, 10), 0);
  assert.equal(stepIndex(4, 'End', 3, 10), 9);
  assert.equal(stepIndex(4, 'Home', 3, 10), 0);
  assert.equal(stepIndex(4, 'a', 3, 10), null);
  assert.equal(stepIndex(0, 'ArrowDown', 3, 0), null);
});

test('page captions come from PDF labels and the drawing set entries for this file', () => {
  const sheets = [
    { filePath: 'C:\\Jobs\\Set.pdf', page: 2, label: 'A-102', title: 'Roof\nplan' },
    { filePath: 'C:/jobs/set.pdf', page: 9, label: 'X', title: 'out of range' },
    { filePath: 'C:/Jobs/Other.pdf', page: 1, label: 'Z', title: 'other file' },
  ];
  assert.deepEqual(tilePageInfo(3, ['i', 'ii'], sheets, 'c:/jobs/SET.pdf'),
    [['i', '', ''], ['ii', 'A-102', 'Roof plan'], ['', '', '']]);
  assert.deepEqual(tilePageInfo(1, null, sheets, ''), [['', '', '']]);
});

test('the drawing window accepts only a bounded set of real pages from the tile', () => {
  assert.deepEqual(validTilePages([3, 1, 7], 10), [3, 1, 7]);
  assert.equal(validTilePages([0], 10), null);
  assert.equal(validTilePages([11], 10), null);
  assert.equal(validTilePages([2, 2], 10), null);
  assert.equal(validTilePages([1.5], 10), null);
  assert.equal(validTilePages([], 10), null);
  assert.equal(validTilePages(Array.from({ length: TILE_MAX_PAGES + 1 }, (_, i) => i + 1), 1000), null);
});

test('the tile opens as an owned, compact tool window', () => {
  const source = readFileSync(new URL('./detached-thumbnails.js', import.meta.url), 'utf8');
  for (const option of ['parent: sourceLabel', 'skipTaskbar: true', 'decorations: false', 'fullscreen: false',
    'maximizable: false', 'visible: false']) {
    assert.ok(source.includes(option), option);
  }
  const capability = JSON.parse(readFileSync(new URL('../../../src-tauri/capabilities/thumbnail-view.json', import.meta.url), 'utf8'));
  assert.deepEqual(capability.windows, ['thumbnail-*']);
  assert.ok(capability.permissions.includes('core:window:allow-start-dragging'));
  assert.ok(!capability.permissions.some((permission) => /maximize|fullscreen/.test(permission)));
});
