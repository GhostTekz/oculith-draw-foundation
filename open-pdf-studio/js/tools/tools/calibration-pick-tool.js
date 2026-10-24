/**
 * Calibration pick tool — 2-click tool to select reference points for scale calibration.
 * After 2 clicks: opens Set Scale with the picked length (PDF points) as the
 * paper length so the user enters its real-world value. Started by the
 * Measure tab's Calibrate button or Set Scale's own Calibrate button (whose
 * draft comes back with the pick); right-click or Esc cancels without a
 * calibration and drops that draft.
 */
import { showCalibrationDialog, forgetSetScaleDraft } from '../../annotations/measurement.js';
import { setTool } from '../manager.js';
import { applyToolTransform } from '../tool-context.js';
import { zetRechtopRond } from '../../pdf/weergave-ruimte.js';

export const calibrationPickTool = {
  name: 'calibrationPick',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, scale } = ctx;

    // Right-click cancels
    if (e.button === 2) {
      state.calibrationPoints = [];
      setTool('select');
      ctx.redraw();
      return;
    }
    if (e.button != null && e.button !== 0) return;

    const snap = ctx.snap(x, y);
    const ptX = snap.snapped ? snap.x : x;
    const ptY = snap.snapped ? snap.y : y;

    // In continuous mode each page has its own coordinate space; a click on
    // another page restarts the pick there.
    if (state.calibrationPoints.length === 0 || state.calibrationPoints[0].pageNum !== ctx.pageNum) {
      // First point
      state.calibrationPoints = [{ x: ptX, y: ptY, pageNum: ctx.pageNum }];
      ctx.redraw();
    } else {
      // Second point — calculate distance and return to measure tab
      const p1 = state.calibrationPoints[0];
      const dx = ptX - p1.x;
      const dy = ptY - p1.y;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);

      if (pixelDist < 3 / scale) return; // Too close, ignore

      const pageNum = p1.pageNum;
      state.calibrationPoints = [];
      // Open first: switching tools runs onDeactivate, which drops the
      // Set Scale draft that this dialog takes back.
      showCalibrationDialog(pixelDist, { pageNum });
      setTool('select');
      ctx.redraw();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;

    if (state.calibrationPoints.length === 0) {
      // Show hover snap
      const snap = ctx.snap(x, y);
      if (snap.snapped) {
        state.lastSnapResult = snap;
        ctx.redraw();
        ctx.drawSnapIndicator(snap);
      } else if (state.lastSnapResult) {
        state.lastSnapResult = null;
        ctx.redraw();
      }
      return;
    }

    // Draw preview line from first point to cursor
    const snap = ctx.snap(x, y);
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);

    const p1 = state.calibrationPoints[0];

    // Draw dashed reference line
    canvasCtx.strokeStyle = '#00AAFF';
    canvasCtx.lineWidth = 1.5;
    canvasCtx.setLineDash([6, 3]);
    canvasCtx.beginPath();
    canvasCtx.moveTo(p1.x, p1.y);
    canvasCtx.lineTo(snapX, snapY);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);

    // Draw endpoints
    const r = 4 / scale;
    canvasCtx.fillStyle = '#00AAFF';
    canvasCtx.beginPath();
    canvasCtx.arc(p1.x, p1.y, r, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.beginPath();
    canvasCtx.arc(snapX, snapY, r, 0, Math.PI * 2);
    canvasCtx.fill();

    // Show live pixel distance
    const dx = snapX - p1.x;
    const dy = snapY - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const midX = (p1.x + snapX) / 2;
    const midY = (p1.y + snapY) / 2;
    // Rechtop op het scherm, ook in een gedraaide weergave (#200).
    zetRechtopRond(canvasCtx, midX, midY);
    canvasCtx.font = `${11}px Arial`;
    canvasCtx.fillStyle = '#00AAFF';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(`${dist.toFixed(1)} px`, midX, midY - 6);

    canvasCtx.restore();

    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  // Escape (GitHub #273): zelfde annulering als rechtermuisklik — punten
  // weggooien, geen kalibratie. De keyboard-handler schakelt daarna naar de
  // selectietool.
  onEscape(ctx) {
    const { state } = ctx;
    const hadPoints = state.calibrationPoints && state.calibrationPoints.length > 0;
    state.calibrationPoints = [];
    ctx.redraw();
    return !!hadPoints;
  },

  onDeactivate(ctx) {
    ctx.state.calibrationPoints = [];
    forgetSetScaleDraft();
    ctx.redraw();
  },
};
