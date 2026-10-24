// Drag a rectangle on the current page and get it back in the annotation
// model space (page points, top-left of the visible sheet, page rotation
// applied, view rotation undone). Page Labels > Create from Page Region uses
// it to mark the title-block sheet number. Same overlay and conversion as
// the region screenshot (screenshot.js).

import { createRoot, createEffect, on } from 'solid-js';
import { render } from 'solid-js/web';
import ScreenshotOverlay from '../solid/components/ScreenshotOverlay.jsx';
import { startScreenshot, endScreenshot, active } from '../solid/stores/screenshotStore.js';
import { getCurrentCanvases, selectionToAppRect } from './screenshot.js';
import { getActiveDocument } from '../core/state.js';

const MOUNT_ID = 'region-pick-overlay-root';

/**
 * @returns {Promise<{ page:number, rect:{x,y,width,height}, pageWidth:number, pageHeight:number }|null>}
 *   null when cancelled (Escape, a click without a drag, no page on screen)
 */
export function pickPageRegion() {
  const canvases = getCurrentCanvases();
  const doc = getActiveDocument();
  if (!canvases || !doc?.pdfDoc) return Promise.resolve(null);
  const container = canvases.container;
  container.style.position = container.style.position || 'relative';
  endScreenshot();
  document.getElementById(MOUNT_ID)?.remove();

  const mountEl = document.createElement('div');
  mountEl.id = MOUNT_ID;
  mountEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:auto;z-index:500;';
  container.appendChild(mountEl);
  const disposeOverlay = render(() => ScreenshotOverlay(), mountEl);

  return new Promise((resolve) => {
    let done = false;
    let disposeWatch = () => {};
    const finish = (value) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        disposeWatch();
        disposeOverlay();
        mountEl.remove();
      });
      resolve(value);
    };
    startScreenshot(container, (sel) => {
      const r = selectionToAppRect(sel, container);
      if (!r || !(r.w > 0) || !(r.h > 0)) { finish(null); return; }
      finish({
        page: doc.currentPage || 1,
        rect: { x: r.x, y: r.y, width: r.w, height: r.h },
        pageWidth: r.pageW,
        pageHeight: r.pageH,
      });
    }, () => finish(null));
    // The overlay ends without a callback for a click that is not a drag.
    createRoot((dispose) => {
      disposeWatch = dispose;
      createEffect(on(active, (isActive) => { if (!isActive) queueMicrotask(() => finish(null)); }, { defer: true }));
    });
  });
}
