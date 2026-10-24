// Vector floor plan for the Dynamic Fill tests and the browser acceptance
// run: two rooms drawn with double-line walls (6" thick at 1/4" = 1'-0",
// i.e. 18 pt per foot), a 3'-0" door in the shared wall, and a 2'-0" square
// column inside room A. Coordinates are PDF user space (y up).
//
//   Room A: 20'-0" x 15'-0" = 300 ft², minus the column 4 ft² = 296 ft²
//   Room B: 10'-0" x 15'-0" = 150 ft²
//   Door:   54 pt wide; a gap tolerance of 60 pt closes it.

import {
  PDFDocument, degrees, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  rectangle, clip, endPath, setLineWidth, moveTo, lineTo, stroke,
} from 'pdf-lib';

export const PT_PER_FT = 18;
export const ROOM_A = { x: 100, y: 100, w: 360, h: 270 };
export const ROOM_B = { x: 469, y: 100, w: 180, h: 270 };
export const COLUMN = { x: 250, y: 200, w: 36, h: 36 };
export const DOOR = { y1: 200, y2: 254 };
export const EXPECTED_FT2 = { A: 296, B: 150, AB_OPEN: 296 + 150 + 9 * 54 / (PT_PER_FT * PT_PER_FT) };

/** The plan as segments in PDF user space. */
export function floorPlanLines() {
  const L = [];
  const poly = (pts) => { for (let i = 0; i + 1 < pts.length; i++) L.push([pts[i], pts[i + 1]]); };
  poly([[91, 91], [658, 91], [658, 379], [91, 379], [91, 91]]);                     // exterior
  poly([[460, 200], [460, 100], [100, 100], [100, 370], [460, 370], [460, 254]]);  // room A
  poly([[469, 200], [469, 100], [649, 100], [649, 370], [469, 370], [469, 254]]);  // room B
  L.push([[460, 200], [469, 200]], [[460, 254], [469, 254]]);                      // door jambs
  const c = COLUMN;
  poly([[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y]]);
  return L;
}

/** Width of the hatch lines drawn by floorPlanPdf({ hatch: true }) (pt on the page). */
export const HATCH_WIDTH = 0.1;

/**
 * The plan as PDF bytes. options.rotate (degrees) and options.cropBox
 * ([x, y, w, h]) make the rotated/cropped variants. options.hatch adds thin
 * hatch lines right across room A (drawn at half width under a 2x
 * transform, so their page width is HATCH_WIDTH) and an unpainted clip
 * rectangle that cuts room A in two.
 */
export async function floorPlanPdf({ rotate = 0, cropBox = null, hatch = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]);
  for (const [[x1, y1], [x2, y2]] of floorPlanLines()) {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.7, color: rgb(0, 0, 0) });
  }
  if (hatch) {
    const a = ROOM_A;
    const ops = [pushGraphicsState(), concatTransformationMatrix(2, 0, 0, 2, 0, 0), setLineWidth(HATCH_WIDTH / 2)];
    for (let x = a.x + 40; x < a.x + a.w; x += 80) {
      ops.push(moveTo(x / 2, a.y / 2), lineTo((x + 20) / 2, (a.y + a.h) / 2), stroke());
    }
    ops.push(popGraphicsState());
    // An unpainted clip path (re W n) across the middle of room A.
    ops.push(pushGraphicsState(), rectangle(a.x, a.y, a.w / 2, a.h), clip(), endPath(), popGraphicsState());
    page.pushOperators(...ops);
  }
  if (cropBox) page.setCropBox(...cropBox);
  if (rotate) page.setRotation(degrees(rotate));
  return doc.save();
}
