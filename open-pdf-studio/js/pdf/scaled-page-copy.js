// A copy of the page bitmap at the size the screen shows it.
//
// The whole-page bitmap is usually larger than its place on screen (it is
// rendered for the next zoom bucket, up to 4096 px), and _render() draws it
// downscaled with the 'high' filter so CAD hairlines keep their weight. That
// filter resamples the entire bitmap on every frame, also while the sheet is
// only panned and its size does not change. Here it runs once per size: as
// soon as two frames in a row ask for the same bitmap at the same size, the
// filtered copy is kept and later frames copy it 1:1 (offsets are whole
// device pixels, so the blit adds no resampling). A changing size (zoom)
// draws directly, as before.

const STANDAARD_MAX_PIXELS = 4096 * 4096;

/**
 * @param {{maakCanvas: () => HTMLCanvasElement|OffscreenCanvas,
 *          context?: (canvas) => CanvasRenderingContext2D|null,
 *          maxPixels?: number}} opties
 */
export function maakSchaalKopie({ maakCanvas, context = (c) => c.getContext('2d'), maxPixels = STANDAARD_MAX_PIXELS }) {
  let kopie = null;      // { bron, w, h, canvas }
  let vorige = null;     // { bron, w, h } of the previous frame

  return {
    /**
     * The filtered copy of `bron` at `w`×`h` device px, or null: draw `bron`
     * directly this frame (size still changing, too large, or no canvas).
     */
    voor(bron, w, h) {
      const wi = Math.round(w);
      const hi = Math.round(h);
      const stabiel = !!vorige && vorige.bron === bron && vorige.w === wi && vorige.h === hi;
      vorige = { bron, w: wi, h: hi };
      if (kopie && kopie.bron === bron && kopie.w === wi && kopie.h === hi) return kopie.canvas;
      if (!stabiel || !bron || wi < 1 || hi < 1 || wi * hi > maxPixels) return null;
      const canvas = kopie?.canvas || maakCanvas();
      if (!canvas) return null;
      // Resizing clears the canvas and resets its state, so the filter is
      // set afterwards.
      canvas.width = wi;
      canvas.height = hi;
      const ctx = context(canvas);
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bron, 0, 0, wi, hi);
      kopie = { bron, w: wi, h: hi, canvas };
      return canvas;
    },
    /** Release the copy (page change, viewport teardown). */
    wis() {
      if (kopie?.canvas) {
        kopie.canvas.width = 0;
        kopie.canvas.height = 0;
      }
      kopie = null;
      vorige = null;
    },
  };
}
