// Snap targets and the hover marker for click-to-place tools.
//
// The vertex just placed must not be a point magnet. It sits inside the snap
// radius of the next click, so that click landed back on it and the minimum
// distance check threw the click away. performSnap already skips that last
// vertex and still uses it for perpendicular and tangent snaps. Earlier
// vertices stay, so a polygon can still close on its first point.

export function zonderLaatstePunt(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  return points.slice(0, -1);
}

// Pointer-down already snapped once in the dispatcher. A second full scan
// on the same click is what made a measurement feel like it needed two
// clicks on a dense sheet. Reuse that result when this click has no extra
// in-progress targets. A miss stays on the raw cursor: these tools do not
// take the dispatcher's grid fallback.
export function hergebruikKlikSnap(ctx, x, y, doelen) {
  if (doelen && doelen.length) return ctx.snap(x, y, null, doelen);
  const prev = ctx.state?.lastSnapResult;
  if (prev && prev.snapped) return prev;
  return { x, y, snapped: false };
}

function zelfdeSnap(a, b) {
  return !!(a && b && a.snapped && b.snapped
    && a.type === b.type
    && Math.abs(a.x - b.x) < 0.05
    && Math.abs(a.y - b.y) < 0.05);
}

// Hover marker. A pointer that stays on the same snap point must not redraw
// every markup on the sheet; the marker from the previous frame is still there.
export function paintHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  const st = ctx.state;
  if (!st) return;
  if (snap.snapped) {
    if (zelfdeSnap(st.lastSnapResult, snap)) return;
    st.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (st.lastSnapResult) {
    st.lastSnapResult = null;
    ctx.redraw();
  }
}
