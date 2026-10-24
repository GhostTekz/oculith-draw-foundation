// Visual Search matcher on synthetic ink images: rotations, sub-pixel
// placement, the ±10 % scale step, look-alike distractors and blank picks.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_THRESHOLD, rgbaToInk, cropInk, rotateQuarter, buildVariants, searchImage, suppress,
} from './matcher.js';

const SS = 4; // supersampling per axis for anti-aliased strokes

/** Blank ink image. */
const blank = (w, h) => ({ width: w, height: h, data: new Float32Array(w * h) });

/** Stroke a shape given as an inside-test on (x, y) in pixels, anti-aliased by supersampling. */
function paint(img, x0, y0, x1, y1, inside) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.ceil(x1)); x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
        }
      }
      if (hit) img.data[y * img.width + x] = Math.min(1, img.data[y * img.width + x] + hit / (SS * SS));
    }
  }
}

function ring(img, cx, cy, r, w = 1) {
  paint(img, cx - r - w, cy - r - w, cx + r + w, cy + r + w,
    (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= w / 2);
}

function seg(img, ax, ay, bx, by, w = 1) {
  const len = Math.hypot(bx - ax, by - ay);
  paint(img, Math.min(ax, bx) - w, Math.min(ay, by) - w, Math.max(ax, bx) + w, Math.max(ay, by) + w, (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)));
    return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) <= w / 2;
  });
}

/** Clockwise quarter turns of (dx, dy) in y-down image space. */
const turn = (dx, dy, q) => [[dx, dy], [-dy, dx], [-dx, -dy], [dy, -dx]][((q % 4) + 4) % 4];

/** Receptacle: ring, two blades and a stem (pointing up at q = 0), size factor f. */
function receptacle(img, cx, cy, q = 0, f = 1) {
  ring(img, cx, cy, 7 * f);
  const s = (a, b) => {
    const [ax, ay] = turn(a[0] * f, a[1] * f, q);
    const [bx, by] = turn(b[0] * f, b[1] * f, q);
    seg(img, cx + ax, cy + ay, cx + bx, cy + by);
  };
  s([-2.5, -3.5], [-2.5, 3.5]);
  s([2.5, -3.5], [2.5, 3.5]);
  s([0, -7], [0, -14]);
}

/** Ink box centre of a receptacle at (cx, cy): 3.5 px towards the stem. */
const inkCentre = (cx, cy, q = 0, f = 1) => {
  const [dx, dy] = turn(0, -3.5 * f, q);
  return [cx + dx, cy + dy];
};

const near = (m, x, y, tol = 2) => Math.abs(m.x + m.width / 2 - x) < tol && Math.abs(m.y + m.height / 2 - y) < tol;

/** Recall / false positives of `matches` against expected centres. */
function score(matches, expected) {
  const used = new Set();
  let tp = 0;
  for (const m of matches) {
    const j = expected.findIndex((e, i) => !used.has(i) && near(m, e[0], e[1], 3));
    if (j >= 0) { used.add(j); tp++; }
  }
  return { tp, fp: matches.length - tp };
}

test('rgbaToInk: white paper is 0, black ink 1, transparent is paper', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 128, 128, 128, 255]);
  const ink = rgbaToInk(rgba, 4, 1);
  assert.equal(ink[0], 0);
  assert.equal(ink[1], 1);
  assert.equal(ink[2], 0);
  assert.ok(Math.abs(ink[3] - 0.498) < 0.01);
});

test('rotateQuarter turns clockwise and four turns give the original', () => {
  const img = { width: 3, height: 2, data: Float32Array.from([1, 2, 3, 4, 5, 6]) };
  const r1 = rotateQuarter(img, 1);
  assert.equal(r1.width, 2);
  assert.equal(r1.height, 3);
  // Clockwise: the left column (bottom to top) becomes the top row.
  assert.deepEqual([...r1.data], [4, 1, 5, 2, 6, 3]);
  let r = img;
  for (let i = 0; i < 4; i++) r = rotateQuarter(r, 1);
  assert.deepEqual([...r.data], [...img.data]);
  assert.deepEqual([...rotateQuarter(img, 2).data], [6, 5, 4, 3, 2, 1]);
});

test('a blank pick gives no variants and no matches', () => {
  const page = blank(100, 100);
  receptacle(page, 50, 50);
  const t = blank(20, 20);
  assert.equal(buildVariants(t).length, 0);
  assert.deepEqual(searchImage(page, t), []);
});

test('finds every receptacle in four rotations at sub-pixel offsets, and no look-alikes', () => {
  const page = blank(420, 320);
  const expected = [];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 30 + col * 80 + (k * 0.37) % 1, y = 30 + row * 60 + (k * 0.61) % 1;
      receptacle(page, x, y, k % 4);
      expected.push(inkCentre(x, y, k % 4));
      // Distractors: a plain ring, a ring with one blade, a ring with an X.
      const dx = x + 38, dy = y + 12;
      ring(page, dx, dy, 7);
      if (k % 3 === 1) seg(page, dx, dy - 3.5, dx, dy + 3.5);
      if (k % 3 === 2) { seg(page, dx - 5, dy - 5, dx + 5, dy + 5); seg(page, dx - 5, dy + 5, dx + 5, dy - 5); }
      k++;
    }
  }
  // Walls.
  for (let y = 5; y < 320; y += 60) seg(page, 0, y, 420, y, 2);
  const t = cropInk(page, 30 - 16, 30 - 16, 32, 32);
  const matches = searchImage(page, t).filter((m) => m.score >= DEFAULT_THRESHOLD);
  const { tp, fp } = score(matches, expected);
  assert.equal(tp, 25, `found ${tp} of 25`);
  assert.equal(fp, 0, `${fp} false positives`);
  // Rotations are reported per match.
  const rot = matches.find((m) => near(m, expected[1][0], expected[1][1], 3)).rotation;
  assert.equal(rot, 90);
  // Without rotations the upright ones are found and the quarter-turned ones
  // are not (a half turn only moves the stem, so it may still score high).
  const upright = searchImage(page, t, { rotations: false }).filter((m) => m.score >= DEFAULT_THRESHOLD);
  assert.equal(score(upright, expected.filter((_, i) => i % 4 === 0)).tp, 7);
  assert.equal(score(upright, expected.filter((_, i) => i % 2 === 1)).tp, 0);
  assert.ok(upright.every((m) => m.rotation === 0));
});

test('the ±10 % scale step finds symbols drawn 10 % larger', () => {
  const page = blank(300, 120);
  receptacle(page, 40, 60);
  const centres = [[120, 60], [200, 60], [260, 60]];
  for (const [x, y] of centres) receptacle(page, x, y, 0, 1.1);
  const big = centres.map(([x, y]) => inkCentre(x, y, 0, 1.1));
  const t = cropInk(page, 40 - 16, 60 - 16, 32, 32);
  const plain = searchImage(page, t).filter((m) => m.score >= DEFAULT_THRESHOLD);
  const stepped = searchImage(page, t, { scaleStep: true }).filter((m) => m.score >= DEFAULT_THRESHOLD);
  assert.ok(score(stepped, big).tp === 3, 'all three larger symbols found with the scale step');
  assert.ok(score(plain, big).tp < score(stepped, big).tp, 'the scale step adds matches');
  const m = stepped.find((r) => near(r, big[0][0], big[0][1], 3));
  assert.equal(m.scale, 1.1);
  assert.ok(m.window.width > t.width, 'the window of a larger match is larger');
});

test('match windows sit on the symbol to a fraction of a pixel', () => {
  const page = blank(200, 100);
  receptacle(page, 50, 50);
  receptacle(page, 140.5, 50.25, 2);
  const t = cropInk(page, 34, 34, 32, 32);
  const m = searchImage(page, t).filter((r) => r.score >= DEFAULT_THRESHOLD);
  assert.equal(m.length, 2);
  const other = m.find((r) => r.x > 100);
  const [ex, ey] = inkCentre(140.5, 50.25, 2);
  assert.ok(Math.abs(other.x + other.width / 2 - ex) <= 0.5, `x ${other.x + other.width / 2}`);
  assert.ok(Math.abs(other.y + other.height / 2 - ey) <= 0.5, `y ${other.y + other.height / 2}`);
  // The ink box is the symbol: ring and stem, 15 px wide and 22 px tall.
  assert.ok(Math.abs(other.width - 15) <= 1.5 && Math.abs(other.height - 22) <= 1.5, `${other.width}×${other.height}`);
  assert.ok(m.every((r) => r.thumb && r.thumb.data.length === r.thumb.width * r.thumb.height));
});

test('suppress keeps the best of overlapping hits and separate ones apart', () => {
  const hits = [
    { cx: 10, cy: 10, width: 10, height: 10, score: 0.8 },
    { cx: 12, cy: 11, width: 10, height: 10, score: 0.9 },
    { cx: 30, cy: 10, width: 10, height: 10, score: 0.7 },
  ];
  const kept = suppress(hits);
  assert.deepEqual(kept.map((h) => h.score), [0.9, 0.7]);
});
