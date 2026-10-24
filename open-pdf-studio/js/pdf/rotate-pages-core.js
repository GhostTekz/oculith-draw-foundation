// Turn a page's /Rotate by a multiple of 90 degrees (pdf-lib). The save of
// the open document applies its in-app page rotations with it, and
// Batch ▸ Rotate (js/batch/ops.js) rotates file pages with it. Markups are
// stored in the unrotated page frame, so they turn with the page.
import { degrees } from 'pdf-lib';

/** The page's new /Rotate, normalised to 0, 90, 180 or 270. */
export function rotatePdfLibPage(page, delta) {
  const existingDeg = page.getRotation().angle;
  const angle = ((((existingDeg + delta) % 360) + 360) % 360);
  page.setRotation(degrees(angle));
  return angle;
}
