// Freehand pen: the positions of one frame joined to the stroke.
//
// tool-dispatcher.js keeps every position since the previous frame
// (including the browser's coalesced pointer events) instead of only the last
// one, so a fast stroke is not cut into one straight piece per frame. Points
// closer than half a screen pixel to the previous point add nothing visible
// but grow the saved ink path (1000 Hz pens), so they are skipped. The frame's
// own final position is always kept.

/**
 * @param {{x:number,y:number}[]} pad  the stroke so far (changed in place)
 * @param {{x:number,y:number}[]|undefined} tussen  in-between positions
 * @param {{x:number,y:number}} eind  this frame's position
 * @param {number} schaal  screen pixels per page unit
 * @returns {number} index of the last point that was already drawn
 */
export function voegPenPuntenToe(pad, tussen, eind, schaal) {
  const vanaf = pad.length - 1;
  const min = 0.5 / (schaal || 1);
  for (const p of tussen || []) {
    const vorige = pad[pad.length - 1];
    if (Math.hypot(p.x - vorige.x, p.y - vorige.y) >= min) pad.push({ x: p.x, y: p.y });
  }
  pad.push({ x: eind.x, y: eind.y });
  return vanaf;
}
