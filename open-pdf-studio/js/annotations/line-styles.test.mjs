import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_LINE_STYLES, getBuiltinLineStyle, cleanLineStyle, layoutLineStyle, lineStyleLayoutBounds,
  resolveLineStyle, buildLineStyleSetBytes, parseLineStyleSetBytes, mergeImportedLineStyles,
  lineStyleMargin, arcPolylinePoints, MAX_LINE_STYLE_SET_BYTES,
} from './line-styles.js';
import { helveticaBreedte } from './maatlijn-inline.js';

const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} != ${b}`);
const gas = getBuiltinLineStyle('gas');

test('built-in set: the ten utility and drafting styles, all clean', () => {
  assert.deepEqual(BUILTIN_LINE_STYLES.map(s => s.id),
    ['gas', 'water', 'sewer', 'storm', 'electric', 'telecom', 'fence', 'centerline', 'hidden', 'phantom']);
  for (const s of BUILTIN_LINE_STYLES) {
    const { builtin, ...rest } = s;
    assert.equal(builtin, true);
    assert.deepEqual(cleanLineStyle(s), rest, s.id);
  }
});

test('GAS on a polyline: text at the set spacing, rotated with each segment, line broken around it', () => {
  // Two segments: 200 pt to the right, then 200 pt straight down (y down).
  const pts = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }];
  const lay = layoutLineStyle(gas, pts, { lineWidth: 1 });
  assert.equal(lay.length, 400);
  // interval 80, first at 40: 40, 120, 200, 280, 360.
  assert.equal(lay.texts.length, 5);
  const along = (t) => (Math.abs(t.y) < 1e-9 ? t.x : 200 + t.y);
  const w = helveticaBreedte('GAS', 7);
  // The one at 200 would straddle the corner: it moves back onto the first
  // run, with its 2 pt gap.
  assert.deepEqual(lay.texts.map(t => Math.round(along(t) * 1000) / 1000),
    [40, 120, Math.round((200 - w / 2 - 2) * 1000) / 1000, 280, 360]);
  for (const t of lay.texts) assert.equal(t.text, 'GAS');
  // First segment: horizontal text; second: along the downward segment.
  close(lay.texts[0].angle, 0);
  close(lay.texts[2].angle, 0);
  close(lay.texts[3].angle, -Math.PI / 2, 1e-9, 'a vertical run reads bottom-to-top');
  // The centre of the cap height sits on the line: base = centre - dir*w/2 - up*h/2.
  close(lay.texts[0].width, w);
  close(lay.texts[0].baseX, 40 - w / 2);
  close(lay.texts[0].baseY, 7 * 0.718 / 2);
  // The line is broken around each text: gap 2 pt each side.
  const pieces = lay.strokes.map(s => s.points);
  assert.equal(pieces.length, 6);
  close(pieces[0][0].x, 0);
  close(pieces[0][1].x, 40 - w / 2 - 2);
  close(pieces[1][0].x, 40 + w / 2 + 2);
  // No text bends round the corner.
  for (const t of lay.texts) {
    const a = along(t);
    assert.ok(a + w / 2 <= 200 + 1e-9 || a - w / 2 >= 200 - 1e-9, `text at ${a} straddles the corner`);
  }
});

test('text stays readable: a right-to-left run is flipped, a rotated page reads in its own frame', () => {
  const lay = layoutLineStyle(gas, [{ x: 300, y: 0 }, { x: 0, y: 0 }]);
  for (const t of lay.texts) close(t.angle, 0, 1e-9, 'upright, not upside down');
  // On a page shown rotated 90°, the same horizontal run reads along the
  // displayed page: angle + rotation stays within (-90°, 90°].
  const rot = Math.PI / 2;
  const lay90 = layoutLineStyle(gas, [{ x: 0, y: 0 }, { x: 300, y: 0 }], { draaiing: rot });
  for (const t of lay90.texts) {
    const shown = t.angle + rot;
    assert.ok(Math.cos(shown) > -1e-9, `upright on the displayed page (${shown})`);
  }
});

test('dash pattern: explicit pieces and dots; offsets give parallel lines', () => {
  const style = cleanLineStyle({ id: 'dd', name: 'dd', lines: [
    { offset: -3, dash: [10, -5, 0, -5], width: 1 }, { offset: 3, dash: [], width: 2 },
  ], marks: [] });
  const lay = layoutLineStyle(style, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { lineWidth: 1.5 });
  const dashed = lay.strokes.filter(s => s.width === 1.5);
  const solid = lay.strokes.filter(s => s.width === 3);
  assert.equal(solid.length, 1);
  close(solid[0].points[0].y, 3);
  // period 20: dashes at 0-10, 20-30, ..., 80-90; dots at 15, 35, ..., 95.
  assert.equal(dashed.length, 5);
  for (const s of dashed) close(s.points[0].y, -3);
  assert.deepEqual(dashed.map(s => s.points[0].x), [0, 20, 40, 60, 80]);
  assert.deepEqual(lay.dots.map(d => Math.round(d.x * 1e6) / 1e6), [15, 35, 55, 75, 95]);
  close(lay.dots[0].r, Math.max(1.5 * 0.75, 0.5));
});

test('offset lines keep mitred corners on a polyline', () => {
  const style = cleanLineStyle({ id: 'off', name: 'off', lines: [{ offset: 5, dash: [] }], marks: [] });
  const lay = layoutLineStyle(style, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.equal(lay.strokes.length, 1);
  const p = lay.strokes[0].points;
  // Normal (-uy, ux) of a run to the right is (0, 1); the corner moves to (95, 5).
  close(p[0].y, 5);
  close(p[1].x, 95); close(p[1].y, 5);
  close(p[2].x, 95); close(p[2].y, 100);
});

test('symbols repeat without breaking the line; scale with line width multiplies every length', () => {
  const fence = getBuiltinLineStyle('fence');
  const lay = layoutLineStyle(fence, [{ x: 0, y: 0 }, { x: 96, y: 0 }]);
  assert.equal(lay.strokes.length, 1, 'gap null: the line runs through the symbols');
  assert.equal(lay.shapes.length, 4 * 2, 'four x marks of two strokes each');
  const scaled = cleanLineStyle({ ...fence, id: 'fence2', scaleWithWidth: true });
  const lay2 = layoutLineStyle(scaled, [{ x: 0, y: 0 }, { x: 96, y: 0 }], { lineWidth: 2 });
  assert.equal(lay2.shapes.length, 2 * 2, 'interval 48 at width 2');
  const xs = lay2.shapes[0].points.map(p => p.x);
  close(Math.max(...xs) - Math.min(...xs), 10, 1e-9, 'size 5 x 2');
});

test('a short line still shows one mark; bounds and margin cover the text', () => {
  const lay = layoutLineStyle(gas, [{ x: 0, y: 0 }, { x: 30, y: 0 }]);
  assert.equal(lay.texts.length, 1);
  close(lay.texts[0].x, 15);
  const b = lineStyleLayoutBounds(lay);
  assert.ok(b.y1 <= -3.5 && b.y2 >= 3.5);
  assert.ok(lineStyleMargin(gas, 1) >= 7);
});

test('budgets: absurd dash and interval values stay bounded', () => {
  const style = cleanLineStyle({ id: 'tiny', name: 'tiny', lines: [{ offset: 0, dash: [0.001, -0.001] }],
    marks: [{ kind: 'text', text: 'A', size: 1, interval: 0.0001 }] });
  // A dash list without length becomes solid; the interval is clamped to 4 pt.
  assert.deepEqual(style.lines[0].dash, []);
  assert.equal(style.marks[0].interval, 4);
  const lay = layoutLineStyle(style, [{ x: 0, y: 0 }, { x: 1e6, y: 0 }]);
  assert.ok(lay.texts.length <= 2000);
  assert.ok(lay.strokes.length <= 2001);
});

test('cleanLineStyle rejects untrusted input', () => {
  assert.equal(cleanLineStyle(null), null);
  assert.equal(cleanLineStyle({ id: '../x', lines: [{}] }), null);
  assert.equal(cleanLineStyle({ id: 'x', lines: [], marks: [] }), null);
  const c = cleanLineStyle({ id: 'x', name: 'A\u0000B', evil: 1, lines: [{ offset: 999, dash: ['a', 5, Infinity], width: -2 }],
    marks: [{ kind: 'text', text: 'GÅS\n<script>', size: 1e9, interval: 50 }, { kind: 'symbol', shape: 'nope' }] });
  assert.deepEqual(Object.keys(c), ['id', 'name', 'scaleWithWidth', 'lines', 'marks']);
  assert.equal(c.name, 'AB');
  assert.deepEqual(c.lines[0], { offset: 50, dash: [5], width: 0.1 });
  assert.equal(c.marks.length, 1);
  assert.equal(c.marks[0].text, 'GS<script>');
  assert.equal(c.marks[0].size, 72);
});

test('resolveLineStyle: built-in, then user style, then the copy the PDF carried', () => {
  const user = cleanLineStyle({ id: 'user-a', name: 'Mine', lines: [{ offset: 0, dash: [4, -2] }], marks: [] });
  assert.equal(resolveLineStyle({ type: 'polyline', lineStyleId: 'gas' }), gas);
  assert.equal(resolveLineStyle({ type: 'polyline', lineStyleId: 'user-a' }, [user]), user);
  const embedded = { ...user, name: 'Embedded' };
  assert.equal(resolveLineStyle({ type: 'polyline', lineStyleId: 'user-a', lineStyleDef: embedded }, []).name, 'Embedded');
  assert.equal(resolveLineStyle({ type: 'box', lineStyleId: 'gas' }), null, 'only line-like markups');
  assert.equal(resolveLineStyle({ type: 'polyline', lineStyleId: 'unknown' }), null);
});

test('style-set JSON: export, import, rejection and id clashes', () => {
  const mine = cleanLineStyle({ id: 'user-b', name: 'Fibre duct', lines: [{ offset: -2 }, { offset: 2 }],
    marks: [{ kind: 'text', text: 'FO', size: 6, interval: 50, gap: 1.5 }] });
  const bytes = buildLineStyleSetBytes('Crew set', [mine, gas]);
  const parsed = parseLineStyleSetBytes(bytes);
  assert.equal(parsed.name, 'Crew set');
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(parsed.styles[0], mine);
  assert.equal(parsed.styles[1].id, 'gas');
  // Importing: the built-in id and a changed same-id style get fresh ids.
  const changed = { ...mine, name: 'Other' };
  const { styles, added } = mergeImportedLineStyles([changed], parsed.styles);
  assert.equal(added.length, 2);
  assert.notEqual(added[0].id, 'user-b');
  assert.notEqual(added[1].id, 'gas');
  assert.equal(styles.length, 3);
  // The same definition again is not duplicated.
  assert.equal(mergeImportedLineStyles([mine], [mine]).added.length, 0);
  assert.throws(() => parseLineStyleSetBytes(new TextEncoder().encode('{"format":"x"}')), /Unsupported/);
  assert.throws(() => parseLineStyleSetBytes(new Uint8Array(MAX_LINE_STYLE_SET_BYTES + 1)), /at most/);
  const bad = new TextEncoder().encode(JSON.stringify({ format: 'ocudraw.line-styles', version: 1, styles: [{ id: '' }, mine] }));
  assert.equal(parseLineStyleSetBytes(bad).skipped, 1);
});

test('arc markups are laid out along the same 36-step sample the saver writes', () => {
  const pts = arcPolylinePoints({ centerX: 0, centerY: 0, radius: 100, startAngle: 0, endAngle: Math.PI });
  assert.equal(pts.length, 37);
  close(pts[36].x, -100);
});
