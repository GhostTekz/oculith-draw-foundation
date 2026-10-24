import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePatText, parsePatBytes, patLineToFamily, PAT_UNITS, MAX_PAT_FILE_BYTES } from './pat-import.js';
import { patFamilyPrimitives } from './hatch-pat-geometry.js';
import { setUserHatchPatterns, registerDocumentHatchPattern, getCustomHatchPattern, listCustomHatchPatterns,
  cleanHatchPatternDef } from './hatch-registry.js';
import { getHatchLineFamilies } from '../pdf/saver/hatch-catalog.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Small fixtures written from the public .PAT format description: ANSI31 is
// the one-family 45° hatch; the second is an AR-CONC-like multi-family
// concrete pattern of short dashes and dots (not the AutoCAD original).
export const PAT_FIXTURE = `;; OcuDraw test fixture
*ANSI31, ANSI Iron, Brick, Stone masonry
45, 0,0, 0,3.175

*AR-CONC-LIKE, Concrete-like aggregate (test fixture)
50, 0,0, 4.1,-4.3, 0.75,-8.1
355, 0,0, -2.1,6.2, 0.6,-6.6
100.5, 0.6,0.05, 5.5,5.0, 0.65,-8.4
46, 0,2, 4.6,4.0, 0,-5.5
96, 0.9,1.4, 3.2,6.6, 0,-6.1   ; dots
`;

test('ANSI31 and a multi-family concrete pattern parse into page-point families', () => {
  const { patterns, warnings } = parsePatText(PAT_FIXTURE, { unit: 'mm' });
  assert.deepEqual(warnings, []);
  assert.deepEqual(patterns.map(p => p.id), ['pat:ANSI31', 'pat:AR-CONC-LIKE']);
  const [ansi, conc] = patterns;
  assert.equal(ansi.name, 'ANSI31');
  assert.equal(ansi.description, 'ANSI Iron, Brick, Stone masonry');
  assert.equal(ansi.families.length, 1);
  const f = ansi.families[0];
  // y up in .PAT, y down on the canvas: the angle flips sign; 3.175 mm = 9 pt.
  close(f.angle, -45);
  close(f.deltaY, 3.175 * 72 / 25.4, 1e-5);
  assert.equal(f.pat, true);
  assert.equal(f.dashPattern, undefined);
  assert.equal(conc.families.length, 5);
  // Negative delta-y: the same family walked the other way.
  const c0 = conc.families[0];
  close(c0.deltaY, 4.3 * PAT_UNITS.mm, 1e-5);
  close(c0.deltaX, 4.1 * PAT_UNITS.mm, 1e-5);
  assert.deepEqual(conc.families[3].dashPattern.map(v => Math.round(v * 1000) / 1000), [0, -15.591]);
});

test('patLineToFamily keeps the line set of a family (y flip)', () => {
  // Line i of a .PAT family passes through origin + i*(dx*d + dy*n) (y up).
  const values = [30, 1, 2, 3, 4];
  const fam = patLineToFamily(values, 1);
  const a = 30 * Math.PI / 180;
  const d = [Math.cos(a), Math.sin(a)], n = [-Math.sin(a), Math.cos(a)];
  const fa = fam.angle * Math.PI / 180;
  const fd = [Math.cos(fa), Math.sin(fa)], fn = [-Math.sin(fa), Math.cos(fa)];
  for (const i of [-2, -1, 1, 3]) {
    // PAT base point, flipped to y down.
    const px = 1 + i * (3 * d[0] + 4 * n[0]);
    const py = -(2 + i * (3 * d[1] + 4 * n[1]));
    // Some line j of the converted family passes through it: its offset
    // along the normal is a multiple of the spacing.
    const off = (px - fam.originX) * fn[0] + (py - fam.originY) * fn[1];
    close(off / fam.deltaY, Math.round(off / fam.deltaY), 1e-9);
    const j = Math.round(off / fam.deltaY);
    // And the dash phase lands on that line's base point.
    const bx = fam.originX + j * (fam.deltaX * fd[0] + fam.deltaY * fn[0]);
    const by = fam.originY + j * (fam.deltaX * fd[1] + fam.deltaY * fn[1]);
    close(bx, px, 1e-9); close(by, py, 1e-9);
  }
});

test('malformed and hostile .PAT input is skipped with warnings, never thrown into the registry', () => {
  const text = `45,0,0,0,1
*GOOD
0, 0,0, 0,2
0, 0,0, 0,0
abc, 1, 2
0, 0,0, 0,2, ${Array(40).fill('1,-1').join(',')}
*
*EMPTY
*GOOD, duplicate name
90, 0,0, 0,3
`;
  const { patterns, warnings } = parsePatText(text, { unit: 'pt' });
  assert.deepEqual(patterns.map(p => p.id), ['pat:GOOD', 'pat:GOOD_2']);
  assert.equal(patterns[0].families.length, 1);
  assert.ok(warnings.length >= 5, warnings.join('\n'));
  assert.throws(() => parsePatBytes(new Uint8Array(MAX_PAT_FILE_BYTES + 1)), /at most/);
  assert.throws(() => parsePatBytes(new Uint8Array(0)), /empty/);
  assert.equal(cleanHatchPatternDef({ id: 'ANSI31', families: [{ angle: 0, deltaY: 1 }] }), null, 'namespaced ids only');
});

test('.PAT geometry: dashes anchored at each line base point, 0 is a dot', () => {
  const fam = { angle: 0, originX: 0, originY: 0, deltaX: 5, deltaY: 10, dashPattern: [4, -2, 0, -4], pat: true };
  const { segments, dots } = patFamilyPrimitives(fam, 1, { cx: 0, cy: 0 }, { left: 0, top: -1, right: 30, bottom: 1 });
  // Line 0 (y = 0) crosses the area; base point x = 0, period 10. (Lines
  // just outside the area may be emitted too; the clip path removes them.)
  const on = (y0) => (p) => Math.abs(p[1] - y0) < 1e-9;
  assert.deepEqual(segments.filter(on(0)).map(s => [s[0], s[2]]), [[0, 4], [10, 14], [20, 24]]);
  assert.deepEqual(dots.filter(on(0)).map(d => d[0]), [6, 16, 26]);
  // Line 1 is staggered by deltaX: dashes start at x = 5 there.
  const l1 = patFamilyPrimitives(fam, 1, { cx: 0, cy: 0 }, { left: 0, top: 9, right: 30, bottom: 11 });
  assert.deepEqual(l1.segments.filter(on(10)).map(s => s[0]), [5, 15, 25]);
  assert.deepEqual(l1.dots.filter(on(10)).map(d => d[0]), [1, 11, 21]);
  // A budget stops runaway output.
  const big = patFamilyPrimitives({ ...fam, deltaY: 0.1 }, 1, { cx: 0, cy: 0 }, { left: 0, top: 0, right: 1e4, bottom: 1e4 }, 1000);
  assert.equal(big.truncated, true);
  assert.ok(big.segments.length + big.dots.length <= 1000);
});

test('registry: the user pattern wins over a document copy; the saver catalog reads both', () => {
  const { patterns } = parsePatText(PAT_FIXTURE, { unit: 'mm' });
  setUserHatchPatterns([patterns[0]]);
  assert.equal(getCustomHatchPattern('pat:ANSI31').families.length, 1);
  const docCopy = { ...patterns[0], families: [...patterns[0].families, patterns[0].families[0]] };
  registerDocumentHatchPattern(docCopy);
  assert.equal(getCustomHatchPattern('pat:ANSI31').families.length, 1, 'local definition wins');
  registerDocumentHatchPattern(patterns[1]);
  assert.deepEqual(listCustomHatchPatterns().map(p => p.id), ['pat:ANSI31', 'pat:AR-CONC-LIKE']);
  assert.equal(getHatchLineFamilies('pat:AR-CONC-LIKE').length, 5);
  assert.equal(getHatchLineFamilies('pat:UNKNOWN').length, 1, 'an unknown imported id falls back to a visible hatch');
  setUserHatchPatterns([]);
});
