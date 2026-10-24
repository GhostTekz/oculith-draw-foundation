// Visual Search preview, drawn by the annotation render pass (rendering.js)
// so zoom and viewport repaints keep it: a frame around each result above
// the similarity threshold (dashed grey when excluded) and the picked symbol.
// The context is already in page space (annotation coordinates).

import { getEffectiveScale } from '../effective-scale.js';
import { overlayResults } from './session.js';
import { template, threshold } from '../../solid/stores/visualSearchStore.js';

const INCLUDED = '#0ea5e9';
const EXCLUDED = '#9ca3af';
const PICK = '#f97316';

export function drawVisualSearchOverlay(ctx, pageNum) {
  if (!ctx) return;
  const list = overlayResults(pageNum);
  const t = template();
  const showPick = t && t.page === pageNum && list.length;
  if (!list.length && !showPick) return;
  const px = 1 / (getEffectiveScale() || 1);
  const min = threshold();
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5 * px;
  for (const r of list) {
    if (r.score < min) continue;
    const pad = 1.5 * px;
    if (r.included === false) {
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.strokeStyle = EXCLUDED;
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = INCLUDED;
      ctx.fillStyle = 'rgba(14, 165, 233, 0.12)';
      ctx.fillRect(r.x - pad, r.y - pad, r.width + 2 * pad, r.height + 2 * pad);
    }
    ctx.strokeRect(r.x - pad, r.y - pad, r.width + 2 * pad, r.height + 2 * pad);
  }
  if (showPick) {
    ctx.setLineDash([4 * px, 2 * px]);
    ctx.strokeStyle = PICK;
    ctx.strokeRect(t.rect.x, t.rect.y, t.rect.width, t.rect.height);
  }
  ctx.restore();
}
