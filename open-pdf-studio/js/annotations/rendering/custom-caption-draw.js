// Custom Captions on the drawing (formula-captions.js): the caption of a
// markup, built from its column values, centred under the markup on a light
// box. The canvas route only; the saver's appearance raster skips it.
import { getActiveDocument } from '../../core/state.js';
import { captionTemplateFor, captionText } from '../formula-captions.js';
import { annotationBounds } from '../spatial-index.js';
import { formatMeasurement } from '../measurement.js';
import { zetRechtopRond } from '../../pdf/weergave-ruimte.js';

export const CAPTION_FONT_SIZE = 11;

/** The caption text of a markup in the active document, or ''. */
export function customCaptionFor(annotation, doc = getActiveDocument()) {
  const template = captionTemplateFor(annotation, doc);
  return template ? captionText(template, annotation, doc, { formatMeasurement }) : '';
}

export function drawCustomCaption(ctx, annotation, color) {
  if (!annotation || annotation._ignoreViewFilters) return;
  const doc = getActiveDocument();
  if (!doc) return;
  const text = customCaptionFor(annotation, doc);
  if (!text) return;
  const bounds = annotationBounds(annotation);
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height + 4;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([]);
  zetRechtopRond(ctx, x, y, doc);
  ctx.font = `${CAPTION_FONT_SIZE}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const width = ctx.measureText(text).width + 6;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(x - width / 2, y, width, CAPTION_FONT_SIZE + 4);
  ctx.fillStyle = color || '#000000';
  ctx.fillText(text, x, y + 2);
  ctx.restore();
}
