// Axis lock and "commit or cancel when the measure tool is left".
// No app imports: a headless test can load this without the DOM.

const AXIS_EPS = 1e-6;

// Nearest horizontal or vertical through `last`. The cursor picks the axis.
// An object snap already on that axis may supply the point; an off-axis snap
// must not, or the segment leaves the axis.
export function orthoFromLast(last, cursor, snap) {
  const x0 = last.x;
  const y0 = last.y;
  const dx = cursor.x - x0;
  const dy = cursor.y - y0;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (snap && snap.snapped && Number.isFinite(snap.x) && Number.isFinite(snap.y)) {
    const onAxis = horizontal
      ? Math.abs(snap.y - y0) <= AXIS_EPS
      : Math.abs(snap.x - x0) <= AXIS_EPS;
    if (onAxis) return horizontal ? { x: snap.x, y: y0 } : { x: x0, y: snap.y };
  }
  return horizontal ? { x: cursor.x, y: y0 } : { x: x0, y: cursor.y };
}

// Distance and perimeter need two placed points. Area needs a triangle.
// Fewer points are still a preview and must be dropped, not stored.
export function shouldCommitMeasurementOnLeave(kind, placedCount) {
  const n = Number.isFinite(placedCount) ? placedCount : 0;
  if (kind === 'measureDistance' || kind === 'measurePerimeter') return n >= 2;
  if (kind === 'measureArea') return n >= 3;
  return false;
}

// Fixed-offset dimension line. The cursor only picks the side. A cursor on
// the segment (dot >= 0, including "no side chosen") uses the positive
// perpendicular, the same rule as the third click.
export function dimensionOffset(p1, p2, cursor, fixedOff = 18) {
  const lineAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const perpX = -Math.sin(lineAngle);
  const perpY = Math.cos(lineAngle);
  const cx = cursor && Number.isFinite(cursor.x) ? cursor.x : p1.x;
  const cy = cursor && Number.isFinite(cursor.y) ? cursor.y : p1.y;
  const perpSide = ((cx - p1.x) * perpX + (cy - p1.y) * perpY) >= 0 ? 1 : -1;
  const dist = perpSide * fixedOff;
  return {
    startX: p1.x + dist * perpX,
    startY: p1.y + dist * perpY,
    endX: p2.x + dist * perpX,
    endY: p2.y + dist * perpY,
  };
}

export function queuedModifiers(event) {
  return {
    shiftKey: !!event?.shiftKey,
    ctrlKey: !!event?.ctrlKey,
    altKey: !!event?.altKey,
    metaKey: !!event?.metaKey,
  };
}

// Shift counts when the queued move said so, or the key is down now.
export function heldModifiers(queued, live) {
  return {
    shiftKey: !!(live?.shiftKey || queued?.shiftKey),
    ctrlKey: !!(live?.ctrlKey || queued?.ctrlKey),
    altKey: !!(live?.altKey || queued?.altKey),
    metaKey: !!(live?.metaKey || queued?.metaKey),
  };
}

// Shadow modifier keys without replacing the event. Getters on a DOM event
// stay bound to that event; only the four keys come from `mods`.
export function eventWithHeldModifiers(event, mods) {
  if (!event || !mods) return event;
  if (!!event.shiftKey === !!mods.shiftKey
      && !!event.ctrlKey === !!mods.ctrlKey
      && !!event.altKey === !!mods.altKey
      && !!event.metaKey === !!mods.metaKey) return event;
  return new Proxy(event, {
    get(target, prop) {
      if (prop === 'shiftKey') return !!mods.shiftKey;
      if (prop === 'ctrlKey') return !!mods.ctrlKey;
      if (prop === 'altKey') return !!mods.altKey;
      if (prop === 'metaKey') return !!mods.metaKey;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
