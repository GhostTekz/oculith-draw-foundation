import { createScaleBar, syncDocScale } from '../../annotations/scale-bar.js';
import { getActiveDocument } from '../../core/state.js';
import { recalculateAllMeasurements, showCalibrationDialog } from '../../annotations/measurement.js';
import {
  recordAdd,
  recordBulkModify,
  recordMeasureScale,
  beginUndoTransaction,
  endUndoTransaction,
} from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';

export const scaleBarTool = {
  name: 'scaleBar',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e && e.button === 2) return;
    const doc = getActiveDocument();
    if (!doc) return;
    // A scale bar carries numbered real-world units and becomes a document
    // scale source. Require an actual document calibration before placing it.
    // Local region and viewport scales must not silently become global here.
    if (!Number.isFinite(doc.measureScale?.pixelsPerUnit) || doc.measureScale.pixelsPerUnit <= 0) {
      showCalibrationDialog();
      return;
    }
    const oldMeasureScale = doc.measureScale == null
      ? doc.measureScale
      : JSON.parse(JSON.stringify(doc.measureScale));
    const measurements = doc.annotations.filter(annotation =>
      ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'].includes(annotation.type)
    );
    const measurementOriginals = measurements.map(annotation => cloneAnnotation(annotation));

    const ann = createScaleBar(ctx.x, ctx.y);
    if (!ann) return;
    doc.annotations.push(ann);

    // Sync doc.measureScale from the new scale bar and recalculate all measurements
    syncDocScale(ann);
    recalculateAllMeasurements();
    beginUndoTransaction();
    recordAdd(ann);
    recordBulkModify(measurements, measurementOriginals);
    recordMeasureScale(oldMeasureScale, doc.measureScale);
    endUndoTransaction();

    ctx.markModified();
    ctx.redraw();

    // Switch back to select tool
    ctx.setTool('select');
  }
};
