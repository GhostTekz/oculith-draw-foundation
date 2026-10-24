import { Show, For, createSignal, createMemo } from 'solid-js';
import {
  editorOpen, shapes, staticMarkup, typeName, setTypeName, VIEWBOX,
  moveVertex, removeVertex, splitSegment, setAllStroke,
  saveSymbolType, cancelSymbolTypeEdit,
} from '../../stores/symbolEditStore.js';

// On-screen size of the square editing canvas (SVG user units are 0..64).
const CANVAS_PX = 480;

const closeSvg = `<svg width="10" height="10" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>`;

export default function SymbolTypeEditor() {
  const [selStroke, setSelStroke] = createSignal('#000000');
  const [selWidth, setSelWidth] = createSignal(2);
  let svgRef;

  // Map a client (mouse) coord to SVG user space (0..64).
  //
  // Use the SVG's own screen CTM rather than a hand-rolled rect ratio: the CTM is
  // the exact transform the browser uses to paint the viewBox, so it already
  // folds in device-pixel-ratio, any CSS scaling of the window (max-width/height),
  // and preserveAspectRatio letterboxing. A manual (clientX-left)/width mapping
  // silently drifts whenever the rendered box is not a perfect 1:1 square — which
  // is what pulled the red handles off the drawn lines. Fall back to the ratio
  // math only if getScreenCTM is unavailable.
  function toUserCoords(clientX, clientY) {
    const ctm = svgRef.getScreenCTM && svgRef.getScreenCTM();
    if (ctm) {
      const pt = svgRef.createSVGPoint();
      pt.x = clientX; pt.y = clientY;
      const u = pt.matrixTransform(ctm.inverse());
      return { x: u.x, y: u.y };
    }
    const rect = svgRef.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * VIEWBOX,
      y: ((clientY - rect.top) / rect.height) * VIEWBOX,
    };
  }

  function startDragVertex(e, shapeId, pointIndex) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const onMove = (ev) => {
      const { x, y } = toUserCoords(ev.clientX, ev.clientY);
      moveVertex(shapeId, pointIndex, x, y);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Alt+click a vertex → delete it; Alt+click a segment midpoint → add a vertex.
  function onVertexMouseDown(e, shapeId, pointIndex) {
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      removeVertex(shapeId, pointIndex);
      return;
    }
    startDragVertex(e, shapeId, pointIndex);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { cancelSymbolTypeEdit(); }
  }

  // Build the "d"/points string for a shape's rendered outline.
  function outline(sh) {
    const pts = sh.points.map(p => `${p.x},${p.y}`).join(' ');
    return pts;
  }

  // Midpoints of each segment (for add-point handles).
  const segmentMidpoints = (sh) => {
    const mids = [];
    const n = sh.points.length;
    const last = sh.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = sh.points[i];
      const b = sh.points[(i + 1) % n];
      mids.push({ i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    return mids;
  };

  const gridLines = createMemo(() => {
    const step = 8;
    const lines = [];
    for (let v = step; v < VIEWBOX; v += step) lines.push(v);
    return lines;
  });

  return (
    <Show when={editorOpen()}>
      <div class="ste-overlay" tabindex="0" ref={el => el && el.focus()} onKeyDown={onKeyDown}>
        <div class="ste-window">
          <div class="ste-header">
            <span class="ste-title">Edit symbol type</span>
            <button class="ste-close" title="Cancel" onClick={cancelSymbolTypeEdit} innerHTML={closeSvg} />
          </div>

          <div class="ste-body">
            <div class="ste-canvas-wrap">
              <svg
                ref={svgRef}
                class="ste-canvas"
                width={CANVAS_PX}
                height={CANVAS_PX}
                viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
              >
                {/* background + grid */}
                <rect x="0" y="0" width={VIEWBOX} height={VIEWBOX} fill="#ffffff" stroke="#d4d4d4" stroke-width="0.4" />
                <For each={gridLines()}>
                  {(v) => (
                    <>
                      <line x1={v} y1="0" x2={v} y2={VIEWBOX} stroke="#eee" stroke-width="0.3" />
                      <line x1="0" y1={v} x2={VIEWBOX} y2={v} stroke="#eee" stroke-width="0.3" />
                    </>
                  )}
                </For>

                {/* preserved (read-only) non-line elements */}
                <g innerHTML={staticMarkup()} opacity="0.9" />

                {/* editable line shapes */}
                <For each={shapes()}>
                  {(sh) => (
                    <>
                      <Show when={sh.closed} fallback={
                        <polyline points={outline(sh)} fill="none"
                          stroke={sh.stroke || '#000'} stroke-width={sh.strokeWidth ?? 2} />
                      }>
                        <polygon points={outline(sh)} fill={sh.fill && sh.fill !== 'none' ? sh.fill : 'none'}
                          stroke={sh.stroke || '#000'} stroke-width={sh.strokeWidth ?? 2} />
                      </Show>

                      {/* segment add-point handles */}
                      <For each={segmentMidpoints(sh)}>
                        {(m) => (
                          <circle class="ste-mid" cx={m.x} cy={m.y} r="0.9"
                            fill="#4a86e8" opacity="0.55"
                            onMouseDown={(e) => { e.stopPropagation(); if (e.button === 0) splitSegment(sh.id, m.i); }} />
                        )}
                      </For>

                      {/* draggable vertices */}
                      <For each={sh.points}>
                        {(p, i) => (
                          <circle class="ste-vertex" cx={p.x} cy={p.y} r="1.6"
                            fill="#ff3b30" stroke="#fff" stroke-width="0.4"
                            onMouseDown={(e) => onVertexMouseDown(e, sh.id, i())} />
                        )}
                      </For>
                    </>
                  )}
                </For>
              </svg>
            </div>

            <div class="ste-sidebar">
              <label class="ste-field">
                <span>Type name</span>
                <input type="text" value={typeName()} onInput={(e) => setTypeName(e.target.value)} />
              </label>

              <div class="ste-field">
                <span>Line colour</span>
                <input type="color" value={selStroke()}
                  onInput={(e) => { setSelStroke(e.target.value); setAllStroke({ stroke: e.target.value }); }} />
              </div>

              <label class="ste-field">
                <span>Line width</span>
                <select value={selWidth()}
                  onChange={(e) => { const w = parseFloat(e.target.value); setSelWidth(w); setAllStroke({ strokeWidth: w }); }}>
                  <option value="0.5">0.5</option>
                  <option value="1">1</option>
                  <option value="1.5">1.5</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="6">6</option>
                </select>
              </label>

              <div class="ste-hint">
                Drag the red points to reshape the lines.<br />
                Click a blue midpoint to add a point.<br />
                Alt-click a red point to remove it.
              </div>
            </div>
          </div>

          <div class="ste-footer">
            <button class="ste-btn" onClick={cancelSymbolTypeEdit}>Cancel</button>
            <button class="ste-btn ste-btn-primary" onClick={() => saveSymbolType()}>Save</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
