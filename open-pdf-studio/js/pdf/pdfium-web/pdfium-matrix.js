// Rekenwerk voor PDFium-renders in de webversie (puur, node-tests).
//
// PDFium's FPDF_RenderPageBitmapWithMatrix werkt in de weergaveruimte van de
// pagina: punten, y omlaag vanaf linksboven, ná de eigen /Rotate van de
// pagina (zie pdfium-worker/src/render.rs render_region). PDF.js-viewports
// zijn diezelfde ruimte, geschaald, en eventueel verder gedraaid: de
// gebruikersrotatie en de weergaverotatie komen bovenop /Rotate.

/** Extra draaiing (0/90/180/270) van een PDF.js-viewport bovenop de /Rotate van de pagina. */
export function extraRotatie(viewportRotatie, paginaRotatie) {
  return ((((viewportRotatie || 0) - (paginaRotatie || 0)) % 360) + 360) % 360;
}

/**
 * Matrix [a, b, c, d, e, f] (x' = a·x + c·y + e, y' = b·x + d·y + f) van de
 * weergaveruimte van de pagina (punten, na /Rotate; breedte W, hoogte H) naar
 * bitmap-pixels, voor een uitsnede van een viewport.
 *
 * @param {object} o
 * @param {number} o.W  paginabreedte in punten (na /Rotate)
 * @param {number} o.H  paginahoogte in punten (na /Rotate)
 * @param {number} o.rotatie  extra draaiing met de klok mee (0/90/180/270)
 * @param {number} o.schaal  CSS-px per punt (viewport.scale)
 * @param {number} o.k  bitmap-px per CSS-px (dpr, of de afgetopte ratio)
 * @param {number} [o.minX]  linkerkant van de uitsnede in viewport-CSS-px
 * @param {number} [o.minY]  bovenkant van de uitsnede in viewport-CSS-px
 */
export function pdfiumMatrix({ W, H, rotatie = 0, schaal, k, minX = 0, minY = 0 }) {
  let r;
  switch (((rotatie % 360) + 360) % 360) {
    case 90: r = [0, 1, -1, 0, H, 0]; break;
    case 180: r = [-1, 0, 0, -1, W, H]; break;
    case 270: r = [0, -1, 1, 0, 0, W]; break;
    default: r = [1, 0, 0, 1, 0, 0];
  }
  const f = schaal * k;
  return [r[0] * f, r[1] * f, r[2] * f, r[3] * f, r[4] * f - minX * k, r[5] * f - minY * k];
}

/** Breng een punt met een matrix over (voor tests en controles). */
export function pasToe(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
