// Development MCP probe: hold one *completed native* render response at the
// WebView IPC boundary. The Rust worker still renders the real PDF; the test
// can save the same path before letting those old bytes reach the UI.
let pending = null;
const canvasIds = new WeakMap();
const canvasDrawCounts = new WeakMap();
let nextCanvasId = 1;
let canvasDrawProbeInstalled = false;

function installCanvasDrawProbe() {
  if (!canvasDrawProbeInstalled) {
    // Count actual bitmap publication on the PDF canvases. A digest alone
    // cannot detect an identical stale bitmap being drawn a second time.
    for (const method of ['drawImage', 'putImageData']) {
      const original = CanvasRenderingContext2D.prototype[method];
      CanvasRenderingContext2D.prototype[method] = function (...args) {
        if (this.canvas?.matches?.('#pdf-canvas, .pdf-canvas')) {
          canvasDrawCounts.set(this.canvas, (canvasDrawCounts.get(this.canvas) || 0) + 1);
        }
        return original.apply(this, args);
      };
    }
    canvasDrawProbeInstalled = true;
  }
}

function observeCanvasDraws(canvas) {
  installCanvasDrawProbe();
  if (!canvasIds.has(canvas)) canvasIds.set(canvas, nextCanvasId++);
  return { canvasId: canvasIds.get(canvas), drawCount: canvasDrawCounts.get(canvas) || 0 };
}

export async function renderRaceDiagnostic({ action, path, command, holdInvalidation = false, failInvalidation = false, x = 0.5, y = 0.5, points } = {}) {
  if (!import.meta.env.DEV) return { ok: false, error: 'development only' };
  if (!window.__TAURI__?.core?.invoke) return { ok: false, error: 'native IPC unavailable' };
  const { setDevelopmentInvokeProbe } = await import('../core/platform.js');

  if (action === 'arm') {
    if (pending) return { ok: false, error: 'render response already armed' };
    if (!path || !['render_pdf_page', 'render_pdf_page_region'].includes(command)) {
      return { ok: false, error: 'path and render command required' };
    }
    const probe = { path, command, started: false, held: false, released: false,
      release: null, holdInvalidation, failInvalidation, invalidationStarted: false,
      invalidationHeld: false, invalidationFailed: false, nativeInvalidationError: null,
      releaseInvalidation: null };
    pending = probe;
    setDevelopmentInvokeProbe(async (name, args, next) => {
      if (pending === probe && probe.holdInvalidation && name === 'invalidate_pdf_cache'
          && args?.path === path && !probe.invalidationStarted) {
        probe.invalidationStarted = true;
        probe.invalidationHeld = true;
        return new Promise((resolve, reject) => {
          probe.releaseInvalidation = () => {
            if (probe.failInvalidation) {
              // The real Save already wrote the file. Reject at the same
              // invoke boundary as a worker-cache invalidation failure.
              probe.invalidationFailed = true;
              reject(new Error('Injected native PDF cache invalidation failure'));
            } else next().then(resolve, error => {
              probe.nativeInvalidationError = String(error);
              reject(error);
            });
          };
        });
      }
      if (pending !== probe || name !== command || args?.path !== path || probe.started) {
        return next();
      }
      probe.started = true;
      // Complete the actual PDFium command before holding the response. A
      // queued request or a fake pixel buffer would not test this boundary.
      const bytes = await next();
      probe.held = true;
      return new Promise(resolve => { probe.release = () => resolve(bytes); });
    });
    return { ok: true, armed: true };
  }

  if (action === 'status') {
    installCanvasDrawProbe();
    const { sourceRenderRevision, sourceWriteActive } = await import('./source-render-revision.js');
    const activePath = path || pending?.path;
    const messageDialog = document.querySelector('.message-dialog');
    return { ok: true, armed: !!pending, started: !!pending?.started,
      held: !!pending?.held, invalidationHeld: !!pending?.invalidationHeld,
      invalidationFailed: !!pending?.invalidationFailed,
      nativeInvalidationError: pending?.nativeInvalidationError || null,
      messageDialogFocused: !!messageDialog?.contains(document.activeElement),
      sourceRevision: sourceRenderRevision(activePath),
      sourceWriteActive: sourceWriteActive(activePath) };
  }

  if (action === 'release-invalidation') {
    if (!pending?.invalidationHeld || !pending.releaseInvalidation) {
      return { ok: false, error: 'no held native invalidation' };
    }
    const release = pending.releaseInvalidation;
    pending.releaseInvalidation = null;
    pending.invalidationHeld = false;
    release();
    return { ok: true, released: true };
  }

  if (action === 'pixel' || action === 'page-pixels') {
    const { getActiveDocument } = await import('../core/state.js');
    const doc = getActiveDocument();
    // Continuous mode renders into per-page canvases; #pdf-canvas belongs to
    // the hidden single-page view and can remain white for the entire test.
    const canvas = doc?.viewMode === 'continuous'
      ? document.querySelector('.page-wrapper[data-page="1"] .pdf-canvas')
      : document.getElementById('pdf-canvas');
    if (!canvas?.width || !canvas?.height) return { ok: false, error: 'PDF canvas unavailable' };
    const context = canvas.getContext('2d');
    const drawProbe = observeCanvasDraws(canvas);
    if (action === 'page-pixels') {
      if (!Array.isArray(points) || points.length > 64 || points.some(point =>
        !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
        return { ok: false, error: 'up to 64 finite page points required' };
      }
      const vp = window.__pdfViewport;
      const widthPt = doc.pageDims?.[1]?.widthPt || vp?.pageW;
      const heightPt = doc.pageDims?.[1]?.heightPt || vp?.pageH;
      const rect = canvas.getBoundingClientRect();
      const samples = points.map(point => {
        let px, py;
        if (doc.viewMode === 'continuous') {
          px = point.x * canvas.width / widthPt;
          py = point.y * canvas.height / heightPt;
        } else {
          px = (vp.offsetX + point.x * vp.zoom) * canvas.width / rect.width;
          py = (vp.offsetY + point.y * vp.zoom) * canvas.height / rect.height;
        }
        const ix = Math.round(px), iy = Math.round(py);
        if (ix < 0 || iy < 0 || ix >= canvas.width || iy >= canvas.height) return null;
        return [...context.getImageData(ix, iy, 1, 1).data].slice(0, 3);
      });
      return { ok: true, samples };
    }
    const cx = Math.max(0, Math.min(canvas.width - 1, Math.floor(Number(x) * canvas.width)));
    const cy = Math.max(0, Math.min(canvas.height - 1, Math.floor(Number(y) * canvas.height)));
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let digest = 2166136261;
    for (let i = 0; i < pixels.length; i++) digest = Math.imul(digest ^ pixels[i], 16777619);
    let redPixels = 0;
    for (let i = 0; i < pixels.length; i += 40) {
      if (pixels[i] > pixels[i + 1] + 80 && pixels[i] > pixels[i + 2] + 80) redPixels++;
    }
    return { ok: true, pixel: [...context.getImageData(cx, cy, 1, 1).data], digest: digest >>> 0,
      ...drawProbe,
      width: canvas.width, height: canvas.height,
      redFraction: redPixels / Math.ceil(pixels.length / 40),
      hasTile: !!window.__pdfViewport?.currentTile };
  }

  if (action === 'release') {
    if (!pending?.held || !pending.release) return { ok: false, error: 'no held native response' };
    if (pending.invalidationHeld) return { ok: false, error: 'release native invalidation first' };
    const probe = pending;
    setDevelopmentInvokeProbe(null);
    pending = null;
    probe.released = true;
    probe.release();
    return { ok: true, released: true };
  }

  if (action === 'cancel') {
    if (pending) {
      setDevelopmentInvokeProbe(null);
      pending.releaseInvalidation?.();
      pending.release?.();
      pending = null;
    }
    return { ok: true };
  }
  return { ok: false, error: 'unknown diagnostic action' };
}
