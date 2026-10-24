import { getActiveDocument } from '../core/state.js';
import { isTauri } from '../core/platform.js';
import { nativeOcgSelectionForDocument } from './native-ocg-selection.js';
import { pageCanvasContext } from './page-canvas-context.js';
import { sourceRenderCurrent, sourceRenderRevision } from './source-render-revision.js';
import { detailTileCovers, detailTileRequest } from './continuous-native-detail.js';

function intersection(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom, area: (right - left) * (bottom - top) } : null;
}

function inkSamples(data) {
  let ink = 0;
  const stride = Math.max(4, Math.floor(data.length / 4 / 1024) * 4);
  for (let i = 0; i < data.length; i += stride) {
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) ink++;
  }
  return ink;
}

// One canvas for the whole continuous view. It moves between page wrappers
// instead of adding a compositor layer to every page in a large drawing set.
export class ContinuousNativeDetailLayer {
  constructor({ getRotation, getDpr, isStaleDoc }) {
    this.getRotation = getRotation;
    this.getDpr = getDpr;
    this.isStaleDoc = isStaleDoc;
    this.canvas = null;
    this.coverage = null;
    this.inflight = false;
    this.queued = false;
    this.timer = null;
    this.generation = 0;
    this.blankRetryKey = null;
  }

  reset() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.coverage = null;
    this.blankRetryKey = null;
    this.canvas?.remove();
    this.canvas = null;
    if (this.inflight) this.queued = true;
  }

  schedule(delay = 65) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.update();
    }, delay);
  }

  _candidate() {
    const doc = getActiveDocument();
    if (!isTauri() || !doc?.filePath || doc.viewMode !== 'continuous') return null;
    const container = document.getElementById('pdf-container');
    const pages = document.getElementById('continuous-container');
    if (!container || !pages || pages.style.display === 'none') return null;
    const viewport = container.getBoundingClientRect();
    let best = null;
    for (const wrapper of pages.querySelectorAll('.page-wrapper')) {
      const cc = wrapper.querySelector('.canvas-container-cont');
      const base = cc?.querySelector('canvas.pdf-canvas');
      if (!base?.width || !base?.height) continue;
      const rect = cc.getBoundingClientRect();
      const visible = intersection(rect, viewport);
      if (visible && (!best || visible.area > best.visible.area)) best = { wrapper, cc, base, rect, visible };
    }
    if (!best) return null;
    const dpr = this.getDpr();
    const { wrapper, cc, base, rect, visible } = best;
    // The capped full-page bitmap is already sharp enough below this ratio.
    if (base.width >= rect.width * dpr * 0.98 && base.height >= rect.height * dpr * 0.98) return null;
    const pageNum = Number(wrapper.dataset.page);
    if (!Number.isInteger(pageNum) || pageNum < 1) return null;
    const view = {
      x: visible.left - rect.left, y: visible.top - rect.top,
      w: visible.right - visible.left, h: visible.bottom - visible.top,
    };
    const sourceRevision = sourceRenderRevision(doc.filePath);
    const ocg = nativeOcgSelectionForDocument(doc);
    const rotation = this.getRotation(pageNum);
    return {
      doc, wrapper, cc, base, view, dpr, pageNum, rotation, sourceRevision, ocg, scale: doc.scale,
      key: `${doc.filePath}|${pageNum}|${doc.scale}|${dpr}|${rotation}|${sourceRevision}|${ocg.revision}`,
      tile: detailTileRequest({ page: { w: rect.width, h: rect.height }, view, scale: doc.scale, dpr }),
    };
  }

  async update() {
    if (this.inflight) { this.queued = true; return; }
    const target = this._candidate();
    if (!target?.tile || !sourceRenderCurrent(target.doc.filePath, target.sourceRevision)) {
      this.canvas?.remove();
      this.canvas = null;
      this.coverage = null;
      return;
    }
    if (this.coverage?.key === target.key
        && this.canvas?.parentElement === target.cc
        && detailTileCovers(this.coverage.css, target.view)) return;
    if (this.canvas && this.coverage?.key !== target.key) this.canvas.style.display = 'none';
    const generation = ++this.generation;
    this.inflight = true;
    try {
      const { points, css, renderScale } = target.tile;
      const { invokeTileRegion } = await import('./progressive-render.js');
      const raw = await invokeTileRegion({
        path: target.doc.filePath,
        pageIndex: target.pageNum - 1,
        scale: renderScale,
        rotation: target.rotation,
        regionXPt: points.x, regionYPt: points.y,
        regionWPt: points.w, regionHPt: points.h,
        ocgVisibility: target.ocg.ocgVisibility,
      });
      if (this.generation !== generation || this.isStaleDoc(target.doc)
          || target.doc.viewMode !== 'continuous' || target.doc.scale !== target.scale
          || !target.wrapper.isConnected || !sourceRenderCurrent(target.doc.filePath, target.sourceRevision)
          || nativeOcgSelectionForDocument(target.doc).revision !== target.ocg.revision) return;
      const current = this._candidate();
      if (!current || current.key !== target.key || current.wrapper !== target.wrapper) return;
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      if (bytes.length < 8) return;
      const header = new DataView(bytes.buffer, bytes.byteOffset, 8);
      const width = header.getUint32(0, true);
      const height = header.getUint32(4, true);
      if (!width || !height || width > 4002 || height > 4002 || bytes.length !== 8 + width * height * 4) return;
      const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, width * height * 4);
      // A native race once returned a nearly white crop over dense base pixels.
      // Keep the correct base visible and retry once after the worker settles.
      const tileInk = inkSamples(rgba);
      if (tileInk <= 8) {
        const mini = document.createElement('canvas');
        mini.width = mini.height = 32;
        const ctx = mini.getContext('2d', { willReadFrequently: true });
        try {
          ctx.drawImage(target.base,
            css.x / target.cc.clientWidth * target.base.width,
            css.y / target.cc.clientHeight * target.base.height,
            css.w / target.cc.clientWidth * target.base.width,
            css.h / target.cc.clientHeight * target.base.height,
            0, 0, 32, 32);
          if (inkSamples(ctx.getImageData(0, 0, 32, 32).data) > 8) {
            if (this.blankRetryKey !== target.key) {
              this.blankRetryKey = target.key;
              this.schedule(1500);
            }
            return;
          }
        } catch { /* an unreadable base is still better than a missing tile */ }
      }
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        pageCanvasContext(this.canvas);
        this.canvas.className = 'pdf-canvas-sharp';
        this.canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:1;box-shadow:none;';
      }
      if (this.canvas.parentElement !== target.cc) {
        this.canvas.remove();
        target.base.insertAdjacentElement('afterend', this.canvas);
      }
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.left = `${css.x}px`;
      this.canvas.style.top = `${css.y}px`;
      this.canvas.style.width = `${css.w}px`;
      this.canvas.style.height = `${css.h}px`;
      pageCanvasContext(this.canvas).putImageData(new ImageData(rgba, width, height), 0, 0);
      this.canvas.style.display = 'block';
      this.coverage = { key: target.key, css };
      this.blankRetryKey = null;
    } catch (error) {
      console.warn('[continuous-detail] region render failed:', error);
    } finally {
      this.inflight = false;
      if (this.queued) { this.queued = false; this.schedule(0); }
    }
  }
}
