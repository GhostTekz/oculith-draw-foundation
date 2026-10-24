// An opaque arrow draws straight onto the markup canvas; only a translucent,
// multiply, shadowed or filtered one goes through the scratch canvas, and
// that canvas is reused (rendering.js, case 'arrow'). The module itself is
// stubbed under node, so this pins the branch in its source.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./rendering.js', import.meta.url), 'utf8');
const arrow = src.slice(src.indexOf("    case 'arrow': {"), src.indexOf("    case 'arc': {"));

test('the arrow branch allocates no canvas of its own', () => {
  assert.ok(arrow.length > 0);
  assert.doesNotMatch(arrow, /document\.createElement\('canvas'\)/);
  assert.match(arrow, /offCanvas = pijlKladblok\(\);/);
  assert.match(src, /function pijlKladblok\(\) \{\s*if \(!_pijlKladblok\) _pijlKladblok = document\.createElement\('canvas'\);/);
});

test('only an opaque, normal, unshadowed, unfiltered arrow draws directly', () => {
  assert.match(arrow, /const direct = ctx\.globalAlpha >= 1 && ctx\.globalCompositeOperation === 'source-over'\s*&& !\(ctx\.shadowBlur > 0\) && \(!ctx\.filter \|\| ctx\.filter === 'none'\);/);
  // Direct drawing is bracketed by save/restore; the scratch path composites.
  assert.match(arrow, /if \(direct\) \{\s*ctx\.save\(\);/);
  assert.match(arrow, /if \(direct\) \{\s*ctx\.restore\(\);\s*\} else \{[\s\S]*ctx\.drawImage\(offCanvas,/);
  // The scratch canvas stays within canvas limits at a deep zoom.
  assert.match(arrow, /Math\.min\(arrowScaleWens, 4096 \/ Math\.max\(offW, offH, 1\)\)/);
});
