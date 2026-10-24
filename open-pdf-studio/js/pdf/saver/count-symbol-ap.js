// Saved appearance of a symbol count: the marker drawn by
// annotations/count-marker.js, recorded by the canvas-to-PDF recorder as
// vector operators (no image XObject). The /Rect stays centred on the count
// point, because the loader reads the point back as the centre of /Rect.
// `map` is the saver's point mapper (displayed page point -> PDF user space),
// so on a rotated page the symbol stays upright as on screen.

import { countUsesSymbol, drawCountSymbolMarker, countSymbolSize } from '../../annotations/count-marker.js';
import { createCanvasPdfRecorder, UnsupportedCanvasOperation } from './canvas-pdf-recorder.js';

/**
 * @returns {{ built: object, rect: number[] } | null}  null: not a symbol
 *   count, or the symbol uses a canvas operation the recorder cannot write
 *   (the caller then writes the numbered dot).
 */
export function buildCountSymbolAP(ann, map) {
  if (!countUsesSymbol(ann)) return null;
  const recorder = createCanvasPdfRecorder();
  try {
    drawCountSymbolMarker(recorder.ctx, ann);
  } catch (error) {
    if (!(error instanceof UnsupportedCanvasOperation)) throw error;
    console.warn(`Count symbol ${ann.symbolId}: ${error.message}; saved as a dot.`);
    return null;
  }
  const built = recorder.toPdf({ map });
  if (!built.bounds) return null;
  const { x: cx, y: cy } = map(ann.x, ann.y);
  const [x1, y1, x2, y2] = built.bounds;
  const half = Math.max(countSymbolSize(ann) / 2, cx - x1, x2 - cx, cy - y1, y2 - cy) + 1;
  return { built, rect: [cx - half, cy - half, cx + half, cy + half] };
}
