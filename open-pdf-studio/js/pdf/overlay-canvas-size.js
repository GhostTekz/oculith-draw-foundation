// Maat van de overlay-canvassen (#annotation-canvas en #text-highlight-canvas)
// in de enkelpagina-weergave.
//
// redrawAnnotations() tekent in één van twee ruimtes, en de overlay moet exact
// de maat van díe ruimte hebben:
//
//  - viewport: de RAF-lus van pdf-viewport.js bezit #pdf-canvas op
//    containermaat en tekent de pagina met (zoom, offsetX, offsetY).
//    Annotaties gaan met dezelfde transform over het HELE venster.
//    Overlay = viewport in CSS-pixels, zonder inline CSS-maat.
//  - pagina: PDF.js tekent de pagina rechtstreeks op #pdf-canvas (leeg
//    document, webversie). Overlay = paginamaat × dpr, CSS = paginamaat.
//
// Waarom dit een eigen beslisregel is: renderPage() zette de overlay aan het
// eind altijd op de PAGINAmaat, ook als de viewport de pagina tekende. Alleen
// de eerstvolgende _render()-frame zette hem terug op de viewportmaat. Kwam
// die frame niet — bv. p2 → p3 met gelijke paginamaat, waar zoom en offsets
// al kloppen (fitToViewport() doet niets) en de bitmap al vóór het einde van
// renderPage() binnen was — dan bleef de overlay op paginamaat staan en werden
// annotaties verkleind en verschoven getekend. Gemeten op
// NKE2D2_opm_aw.pdf p3 (5156×2384 pt, venster 855×697, dpr 1,5): overlay
// 1283×593 backing met CSS 855×395 onder een #pdf-canvas van 1283×1046.
//
// De regel volgt exact de keuze die redrawAnnotations() maakt
// (`vp.active && doc.filePath` → viewport-transform), zodat het pixelraster
// van de overlay altijd bij de gebruikte transform hoort.

/**
 * Tekent redrawAnnotations() in de viewport-ruimte?
 *
 * @param {object} o
 * @param {boolean} o.viewportActief    Is de pdf-viewport-singleton actief?
 * @param {boolean} o.heeftBestandspad  Heeft het actieve document een pad?
 * @returns {boolean}
 */
export function overlayVolgtViewport({ viewportActief, heeftBestandspad }) {
  return !!viewportActief && !!heeftBestandspad;
}

function isPositief(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Longest backing-store side of a page-sized overlay canvas (px). */
export const OVERLAY_MAX_AXIS_PX = 6144;

/** Rand (CSS-px) rond het zichtbare deel als de overlay een uitsnede is. */
export const OVERLAY_CLIP_MARGE_PX = 256;

/**
 * Bepaal de maat van de overlay-canvassen.
 *
 * width/height zijn gehele getallen, afgerond zoals een <canvas> ze opslaat
 * (unsigned long → naar beneden). Zo is een tweede toepassing met dezelfde,
 * fractionele viewportmaat (dpr 1,25 / 1,5) een no-op in plaats van een
 * canvas-wis per frame.
 *
 * @param {object} o
 * @param {boolean} o.viewportActief
 * @param {boolean} o.heeftBestandspad
 * @param {number} [o.viewportCssW]  #pdf-canvas backing-breedte / dpr
 * @param {number} [o.viewportCssH]  #pdf-canvas backing-hoogte / dpr
 * @param {number} [o.paginaCssW]    Paginabreedte in CSS-px op doc.scale
 * @param {number} [o.paginaCssH]    Paginahoogte in CSS-px op doc.scale
 * @param {number} [o.dpr]           devicePixelRatio (backing store per CSS px)
 * @param {number} [o.viewportStijlW] CSS-breedte van #pdf-canvas (viewportmodus)
 * @param {number} [o.viewportStijlH] CSS-hoogte van #pdf-canvas (viewportmodus)
 * @returns {{bron: 'viewport'|'pagina', width: number, height: number,
 *            cssWidth: string, cssHeight: string} | null}
 *   null = geen geldige maat; laat de canvassen dan ongemoeid. In
 *   viewport-modus wordt NOOIT op de paginamaat teruggevallen.
 */
export function bepaalOverlayMaat({
  viewportActief,
  heeftBestandspad,
  viewportCssW,
  viewportCssH,
  paginaCssW,
  paginaCssH,
  dpr,
  zichtbaar = null,
  viewportStijlW,
  viewportStijlH,
}) {
  if (overlayVolgtViewport({ viewportActief, heeftBestandspad })) {
    if (!isPositief(viewportCssW) || !isPositief(viewportCssH)) return null;
    // Backing store at device resolution, exactly the #pdf-canvas backing
    // (round(css · dpr)), so a markup pixel lands on the same physical pixel
    // as the page pixel under it. Drawn at CSS resolution, every markup was
    // upscaled by the compositor at Windows 125/150/200 % scaling: soft lines
    // and text next to a sharp drawing. CSS size = the whole-px #pdf-canvas
    // CSS size (round(backing / dpr) = the container's clientWidth).
    const r = isPositief(dpr) ? dpr : 1;
    if (r === 1) {
      return {
        bron: 'viewport',
        width: Math.floor(viewportCssW),
        height: Math.floor(viewportCssH),
        cssWidth: '',
        cssHeight: '',
      };
    }
    return {
      bron: 'viewport',
      width: Math.round(viewportCssW * r),
      height: Math.round(viewportCssH * r),
      cssWidth: `${isPositief(viewportStijlW) ? viewportStijlW : Math.round(viewportCssW)}px`,
      cssHeight: `${isPositief(viewportStijlH) ? viewportStijlH : Math.round(viewportCssH)}px`,
      backingScale: r,
    };
  }
  if (!isPositief(paginaCssW) || !isPositief(paginaCssH)) return null;
  const d = isPositief(dpr) ? dpr : 1;
  // Diepe zoom op een groot blad: de hele pagina op dpr past niet (8 000-
  // 17 000 px, honderden MB, elke hertekening bevroor). Dan dekt de overlay
  // alleen het zichtbare deel plus een rand, op volle dpr — markeringen
  // blijven scherp zoals de pagina eronder (pdfjs-detail-layer.js). De
  // uitsnede (clipX/clipY, pagina-CSS-px) gaat via dataset mee; tekenen,
  // gereedschappen en klikken rekenen ermee (rendering.js, tool-transform.js,
  // weergave-ruimte.js paginaOorsprong).
  if (zichtbaar && Math.max(paginaCssW, paginaCssH) * d > OVERLAY_MAX_AXIS_PX) {
    const x0 = Math.max(0, Math.floor(zichtbaar.minX - OVERLAY_CLIP_MARGE_PX));
    const y0 = Math.max(0, Math.floor(zichtbaar.minY - OVERLAY_CLIP_MARGE_PX));
    const x1 = Math.min(Math.floor(paginaCssW), Math.ceil(zichtbaar.maxX + OVERLAY_CLIP_MARGE_PX));
    const y1 = Math.min(Math.floor(paginaCssH), Math.ceil(zichtbaar.maxY + OVERLAY_CLIP_MARGE_PX));
    if (x1 > x0 && y1 > y0) {
      const w = x1 - x0, h = y1 - y0;
      const r = Math.min(d, OVERLAY_MAX_AXIS_PX / Math.max(w, h));
      return {
        bron: 'pagina',
        width: Math.floor(w * r),
        height: Math.floor(h * r),
        cssWidth: `${w}px`,
        cssHeight: `${h}px`,
        clipX: x0,
        clipY: y0,
        paginaCssW: Math.floor(paginaCssW),
        paginaCssH: Math.floor(paginaCssH),
      };
    }
  }
  // Backing store per CSS px: the dpr, but never more than OVERLAY_MAX_AXIS_PX
  // on the longest side (no visible part known). The annotation pass reads
  // the real ratio (width / CSS width), so drawing and hit testing stay aligned.
  const r = Math.min(d, OVERLAY_MAX_AXIS_PX / Math.max(paginaCssW, paginaCssH));
  return {
    bron: 'pagina',
    width: Math.floor(paginaCssW * r),
    height: Math.floor(paginaCssH * r),
    cssWidth: `${Math.floor(paginaCssW)}px`,
    cssHeight: `${Math.floor(paginaCssH)}px`,
  };
}

/**
 * Pas een maat uit bepaalOverlayMaat() toe op een canvas. Raakt de backing
 * store alleen aan als die echt verandert (elke toewijzing aan width/height
 * wist het canvas).
 *
 * @param {{width: number, height: number, style?: {width: string, height: string}} | null} canvas
 * @param {ReturnType<typeof bepaalOverlayMaat>} maat
 * @returns {boolean} true als er iets gewijzigd is
 */
export function pasOverlayMaatToe(canvas, maat) {
  if (!canvas || !maat) return false;
  let gewijzigd = false;
  if (canvas.width !== maat.width || canvas.height !== maat.height) {
    canvas.width = maat.width;
    canvas.height = maat.height;
    gewijzigd = true;
  }
  const st = canvas.style;
  if (st) {
    if (st.width !== maat.cssWidth) { st.width = maat.cssWidth; gewijzigd = true; }
    if (st.height !== maat.cssHeight) { st.height = maat.cssHeight; gewijzigd = true; }
    // Uitsnede: het canvas staat op (clipX, clipY) van de pagina.
    const links = maat.clipX ? `${maat.clipX}px` : '';
    const boven = maat.clipY ? `${maat.clipY}px` : '';
    if ((st.left || '') !== links) { st.left = links; gewijzigd = true; }
    if ((st.top || '') !== boven) { st.top = boven; gewijzigd = true; }
  }
  // Tool previews (tool-transform.js) read the backing ratio from here: on a
  // capped deep-zoom overlay it is below the dpr.
  if (canvas.dataset) {
    const css = parseFloat(maat.cssWidth);
    if (maat.bron === 'pagina' && css > 0) canvas.dataset.backingScale = String(maat.width / css);
    else if (maat.bron === 'viewport' && maat.backingScale > 0) canvas.dataset.backingScale = String(maat.backingScale);
    else delete canvas.dataset.backingScale;
    if (maat.clipX || maat.clipY) {
      canvas.dataset.clipX = String(maat.clipX || 0);
      canvas.dataset.clipY = String(maat.clipY || 0);
      canvas.dataset.paginaCssW = String(maat.paginaCssW);
      canvas.dataset.paginaCssH = String(maat.paginaCssH);
    } else {
      delete canvas.dataset.clipX;
      delete canvas.dataset.clipY;
      delete canvas.dataset.paginaCssW;
      delete canvas.dataset.paginaCssH;
    }
  }
  return gewijzigd;
}
