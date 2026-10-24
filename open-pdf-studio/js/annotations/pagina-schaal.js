// Schaal per pagina (doc.pageScales), zoals the external editor hem bewaart. Geen app-state:
// alles werkt op het document dat binnenkomt, zodat node het kan testen.
//
// doc.pageScales = { [paginanummer]: scaleData | null }
//   scaleData: { pixelsPerUnit, unit, method, scaleRatio, label?, precision?, equation? }
//   (precision en equation: Set Scale, zie measure-precision.js en scale-presets.js)
//   null: de gebruiker wiste de schaal van die pagina (ook een paginaschaal
//   die uit de PDF kwam). Een pagina zonder sleutel volgt het bestand: een
//   /VP-viewport over de hele pagina (zie schaal-op-punt.paginaSchaal).
//
// Bij opslaan schrijft pagina-schaal-vp.js elke pagina met een sleutel als
// /VP + /Measure in de PDF; dan is het bestand de bewaarplaats en niet meer
// localStorage.

import { geldigeDocumentSchaal, paginaSchaal } from './schaal-op-punt.js';

/**
 * Paginanummers waarop een schaal toegepast wordt.
 * @param {'all'|'current'|number[]|number|undefined} pages
 * @param {{currentPage?:number, pdfDoc?:{numPages?:number}, pageCount?:number}} doc
 * @returns {number[]}
 */
export function paginasVoorSchaal(pages, doc) {
  if (pages === 'all') {
    const n = Number(doc?.pdfDoc?.numPages) || Number(doc?.pageCount) || 0;
    if (n > 0) return Array.from({ length: n }, (_, i) => i + 1);
    return [Number(doc?.currentPage) || 1];
  }
  const lijst = Array.isArray(pages) ? pages : (pages == null || pages === 'current' ? [doc?.currentPage || 1] : [pages]);
  return [...new Set(lijst.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

/**
 * Nieuwe paginaschaalkaart met `scaleData` (of null) op de gegeven pagina's.
 * @param {Record<number, object|null>|undefined|null} kaart
 * @param {object|null} scaleData
 * @param {number[]} paginas
 */
export function metPaginaSchaal(kaart, scaleData, paginas) {
  const uit = { ...(kaart || {}) };
  for (const p of paginas) uit[p] = scaleData ? { ...scaleData } : null;
  return uit;
}

/**
 * Migratie van de oude documentschaal (localStorage, per bestandspad): elke
 * pagina zonder eigen schaal en zonder paginaviewport in de PDF krijgt hem,
 * gemarkeerd als method 'legacy'. De eerste save schrijft hem dan als /VP.
 * Een schaal die alleen uit de paginatekst geraden is, is geen kalibratie en
 * komt hier niet langs (K-004).
 * @param {object} doc
 * @param {object|null} legacy  de oude doc.measureScale
 * @param {number} aantalPaginas
 * @returns {number} aantal pagina's dat de oude schaal kreeg
 */
export function migreerLegacySchaal(doc, legacy, aantalPaginas) {
  const schaal = geldigeDocumentSchaal(legacy);
  if (!doc || !schaal || !(aantalPaginas > 0)) return 0;
  const kaart = { ...(doc.pageScales || {}) };
  let gezet = 0;
  for (let p = 1; p <= aantalPaginas; p++) {
    if (Object.prototype.hasOwnProperty.call(kaart, p)) continue;
    if (paginaSchaal(doc, p)) continue;
    kaart[p] = { ...legacy, ...schaal, method: 'legacy' };
    gezet += 1;
  }
  if (gezet) doc.pageScales = kaart;
  return gezet;
}

// ── Oude bewaarplaats (localStorage) ────────────────────────────────────────

export function legacySchaalSleutel(filePath) {
  return 'ops_measureScale_' + filePath;
}

/** De oude documentschaal van dit bestand, of null. */
export function leesLegacySchaal(filePath) {
  if (!filePath) return null;
  try {
    const raw = globalThis.localStorage?.getItem(legacySchaalSleutel(filePath));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Na een geslaagde save staat de schaal in de PDF; de oude sleutel mag weg. */
export function vergeetLegacySchaal(filePath) {
  if (!filePath) return;
  try { globalThis.localStorage?.removeItem(legacySchaalSleutel(filePath)); } catch { /* geen opslag */ }
}
