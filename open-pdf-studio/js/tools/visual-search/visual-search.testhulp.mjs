// Test fixture for Visual Search: a pdf-lib floor plan with duplex
// receptacle symbols (circle, two blades, a stem on one side) in four
// rotations, among walls, door swings and look-alike distractors (plain
// circles, single-blade circles, light fixtures with an X, squares, text).
// Positions are returned in PDF user space so a test can map them through
// the CropBox and /Rotate itself.

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const BLACK = rgb(0, 0, 0);
const R = 5; // circle radius (pt)

/** Rotate (dx, dy) by a multiple of 90° (counter-clockwise in user space). */
function rot(dx, dy, q) {
  switch (((q % 4) + 4) % 4) {
    case 1: return [-dy, dx];
    case 2: return [-dx, -dy];
    case 3: return [dy, -dx];
    default: return [dx, dy];
  }
}

function line(page, x, y, q, a, b, thickness = 0.8) {
  const [ax, ay] = rot(a[0], a[1], q);
  const [bx, by] = rot(b[0], b[1], q);
  page.drawLine({ start: { x: x + ax, y: y + ay }, end: { x: x + bx, y: y + by }, thickness, color: BLACK });
}

function circle(page, x, y, r = R) {
  page.drawCircle({ x, y, size: r, borderWidth: 0.8, borderColor: BLACK });
}

/** The receptacle: centre (x, y), quarter turns q; the stem points +y at q = 0. */
export function drawReceptacle(page, x, y, q = 0) {
  circle(page, x, y);
  line(page, x, y, q, [-1.8, -2.4], [-1.8, 2.4]);
  line(page, x, y, q, [1.8, -2.4], [1.8, 2.4]);
  line(page, x, y, q, [0, R], [0, R + 5]);
}

const DISTRACTORS = [
  (p, x, y) => circle(p, x, y), // plain circle
  (p, x, y, q) => { circle(p, x, y); line(p, x, y, q, [0, -2.4], [0, 2.4]); }, // single blade
  (p, x, y) => { circle(p, x, y); line(p, x, y, 0, [-3.5, -3.5], [3.5, 3.5]); line(p, x, y, 0, [-3.5, 3.5], [3.5, -3.5]); }, // light
  (p, x, y) => p.drawRectangle({ x: x - 5, y: y - 5, width: 10, height: 10, borderWidth: 0.8, borderColor: BLACK }),
  (p, x, y, q) => { circle(p, x, y, 3); line(p, x, y, q, [0, 3], [0, 9]); }, // small circle with stem
  (p, x, y, q, font) => p.drawText('B2', { x: x - 6, y: y - 4, size: 10, font, color: BLACK }),
];

function walls(page, w, h) {
  const t = 1.6;
  for (const x of [40, 320, 590, w - 40]) page.drawLine({ start: { x, y: 40 }, end: { x, y: h - 40 }, thickness: t, color: BLACK });
  for (const y of [40, 245, 460, h - 40]) page.drawLine({ start: { x: 40, y }, end: { x: w - 40, y }, thickness: t, color: BLACK });
  // Door swings on the wall at y = 460.
  for (const x of [160, 440, 700]) {
    page.drawSvgPath('M 0 0 A 24 24 0 0 1 24 -24', { x, y: 460, borderWidth: 0.6, borderColor: BLACK });
  }
}

/**
 * @param {{ pages?: number, rotate?: number, cropBox?: number[], size?: number[] }} [opts]
 *   cropBox [x, y, width, height] in user space
 * @returns {Promise<{ bytes: Uint8Array, symbols: Array<{page:number,x:number,y:number,q:number}>,
 *   distractors: Array<{page:number,x:number,y:number}> }>}
 */
export async function buildReceptacleFixture({ pages = 1, rotate = 0, cropBox, size = [792, 612] } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const symbols = [];
  const distractors = [];
  const [w, h] = size;
  for (let p = 1; p <= pages; p++) {
    const page = doc.addPage([w, h]);
    if (rotate) page.setRotation(degrees(rotate));
    if (cropBox) page.setCropBox(...cropBox);
    walls(page, w, h);
    // 25 receptacles on a jittered 5×5 grid inside the rooms, rotations cycling;
    // a distractor next to each one.
    let k = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const x = 95 + col * 135 + ((row * 7 + p * 3) % 11) + ((k * 0.37) % 1);
        const y = 80 + row * 105 + ((col * 5 + p) % 9) + ((k * 0.61) % 1);
        const q = (k + p) % 4;
        drawReceptacle(page, x, y, q);
        // The symbol's ink box centre (circle and stem): 2.3 pt from the
        // circle centre towards the stem.
        const [ox, oy] = rot(0, 2.3, q);
        symbols.push({ page: p, x, y, q, cx: x + ox, cy: y + oy });
        const dx = x + 42, dy = y + 20;
        DISTRACTORS[k % DISTRACTORS.length](page, dx, dy, q, font);
        distractors.push({ page: p, x: dx, y: dy });
        k++;
      }
    }
    page.drawText(`Sheet E-${p}`, { x: w - 160, y: 18, size: 12, font, color: BLACK });
  }
  return { bytes: await doc.save(), symbols, distractors };
}
