// Benoemde viewports van OcuDraw in de PDF zelf: per viewport één `/VP`-
// entry op de pagina (ISO 32000-1, 12.9), zoals ook CAD-plots en andere
// meetprogramma's ze schrijven, in plaats van de vroegere zichtbare
// streeplijn-Square-annotatie met OPS_ScaleString.
//
// Wat hier geschreven wordt:
//   << /Type /Viewport /BBox [x0 y0 x1 y1] /Name (Plattegrond)
//      /Measure << /Type /Measure /Subtype /RL /R (1 in = 4 ft) /X […] /D […] /A […] >>
//      /OPS_Viewport true /OPS_Id (…) /OPS_ScaleString (1:48) /OPS_Units (ft) >>
//
// /BBox is de rechthoek in standaard-gebruikersruimte (CropBox-oorsprong,
// zonder /Rotate). /Measure is dat van de paginaschaal (measureVoorSchaal in
// pagina-schaal-vp.js). Een viewport zonder geldige schaal krijgt geen
// /Measure: hij is dan geen kalibratie, ook niet voor een andere lezer.
//
// Eigendom: alleen entries met `/OPS_Viewport true` zijn van OcuDraw. Die
// worden bij elke save vervangen door de viewports van het model, nooit
// verdubbeld. Vreemde viewports en de paginaschaal (`/OPS_PageScale`) blijven
// staan. Overlappen viewports, dan komt de grootste eerst en de kleinste
// laatst: lezers die de lijst van achteren af doorzoeken vinden zo de
// binnenste, net als de app (innermost wins).
//
// Bij het openen leest leesEigenViewports ze terug als scaleRegion-annotaties
// (het model van een viewport in de app); pdf-viewports.js slaat ze in de
// lijst van PDF-viewports over, zodat ze niet dubbel meetellen.

import { PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, PDFBool } from 'pdf-lib';
import { geerfd, rechthoek, doorsnede, naarAppRuimte, schaalUitMeasure, isEigenViewport,
  EIGEN_VIEWPORT_SLEUTEL, MAX_VIEWPORTS } from './pdf-viewports.js';
import { measureVoorSchaal } from './pagina-schaal-vp.js';
import { pixelsPerUnitFor } from '../annotations/scale-string.js';
import { ratioFromPixelsPerUnit } from '../annotations/scale-entry.js';
import { validPrecision } from '../annotations/measure-precision.js';
import { pageUserUnit } from './page-user-unit.js';

function getal(obj) {
  return obj instanceof PDFNumber ? obj.asNumber() : null;
}

function tekst(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try { return obj.decodeText(); } catch { return ''; }
  }
  return '';
}

function rotatieVan(r) {
  return (((Number(r) || 0) % 360) + 360) % 360;
}

/**
 * Eén punt uit de app-ruimte (weergegeven pagina, y omlaag, oorsprong
 * linksboven) terug naar standaard-gebruikersruimte: het omgekeerde van
 * puntNaarAppRuimte in pdf-viewports.js.
 * @returns {[number, number]}
 */
export function puntUitAppRuimte(ax, ay, viewBox, rotatie, userUnit = 1) {
  const [vx0, vy0, vx1, vy1] = viewBox;
  const W = vx1 - vx0;
  const H = vy1 - vy0;
  let u;
  let v;
  ax /= userUnit;
  ay /= userUnit;
  switch (rotatieVan(rotatie)) {
    case 90: u = ay; v = ax; break;
    case 180: u = W - ax; v = ay; break;
    case 270: u = W - ay; v = H - ax; break;
    default: u = ax; v = H - ay;
  }
  return [u + vx0, v + vy0];
}

/** App-rechthoek naar een genormaliseerde /BBox in gebruikersruimte. */
export function bboxUitAppRuimte(rect, viewBox, rotatie, userUnit = 1) {
  const a = puntUitAppRuimte(rect.x, rect.y, viewBox, rotatie, userUnit);
  const b = puntUitAppRuimte(rect.x + rect.width, rect.y + rect.height, viewBox, rotatie, userUnit);
  const r = (n) => Number(n.toFixed(4));
  return [r(Math.min(a[0], b[0])), r(Math.min(a[1], b[1])), r(Math.max(a[0], b[0])), r(Math.max(a[1], b[1]))];
}

function zichtbaarVan(node) {
  const media = rechthoek(geerfd(node, 'MediaBox'));
  if (!media) return null;
  const v = doorsnede(media, rechthoek(geerfd(node, 'CropBox')));
  return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
}

/** Schaal van een viewport-annotatie, of null als hij geen kalibratie is. */
export function viewportSchaal(region) {
  const pixelsPerUnit = pixelsPerUnitFor(region?.scaleString, region?.units);
  if (!pixelsPerUnit) return null;
  const uit = { pixelsPerUnit, unit: region.units };
  if (validPrecision(region.precision, region.units)) uit.precision = region.precision;
  return uit;
}

function viewportDict(context, region, box, rotatie, userUnit) {
  const vp = context.obj({
    Type: PDFName.of('Viewport'),
    BBox: context.obj(bboxUitAppRuimte(region, box, rotatie, userUnit)),
  });
  const naam = String(region.label || '').trim();
  if (naam) vp.set(PDFName.of('Name'), PDFHexString.fromText(naam));
  const schaal = viewportSchaal(region);
  if (schaal) vp.set(PDFName.of('Measure'), measureVoorSchaal(context, schaal, userUnit));
  vp.set(PDFName.of(EIGEN_VIEWPORT_SLEUTEL), PDFBool.True);
  if (region.id) vp.set(PDFName.of('OPS_Id'), PDFString.of(String(region.id)));
  vp.set(PDFName.of('OPS_ScaleString'), PDFString.of(String(region.scaleString || '')));
  vp.set(PDFName.of('OPS_Units'), PDFString.of(String(region.units || '')));
  if (Number.isInteger(region.precision)) vp.set(PDFName.of('OPS_Precision'), PDFNumber.of(region.precision));
  else if (validPrecision(region.precision, region.units)) vp.set(PDFName.of('OPS_Precision'), PDFString.of(region.precision));
  if (region.tekeningtypeId) vp.set(PDFName.of('OPS_Tekeningtype'), PDFHexString.fromText(String(region.tekeningtypeId)));
  return vp;
}

function geldigeRechthoek(r) {
  return [r?.x, r?.y, r?.width, r?.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
}

/**
 * Schrijft de benoemde viewports (scaleRegion-annotaties) als /VP-entries.
 * Met `volledig` (de viewports uit het bestand staan in het model) gaan
 * eerst alle OcuDraw-viewports van elke pagina eruit: een verwijderde
 * viewport verdwijnt dan ook uit het bestand. Zonder `volledig` (het lezen
 * liep nog) blijven de bestaande staan, behalve die met een id uit het model.
 * @param {import('pdf-lib').PDFDocument} pdfDocLib
 * @param {Array<object>} regions  scaleRegion-annotaties
 * @param {{extraRotatie?:Record<number, number>, volledig?:boolean}} [opties]
 *   extraRotatie: draai in de app per pagina (bovenop /Rotate), zoals de
 *   annotatieruimte hem kent
 * @returns {number} aantal geschreven viewports
 */
export function schrijfEigenViewports(pdfDocLib, regions, opties = {}) {
  const volledig = opties.volledig !== false;
  const context = pdfDocLib.context;
  const paginas = pdfDocLib.getPages();
  const perPagina = new Map();
  const modelIds = new Set();
  for (const r of regions || []) {
    if (!r || r.type !== 'scaleRegion' || !geldigeRechthoek(r)) continue;
    const nr = Number(r.page);
    if (!Number.isInteger(nr) || nr < 1 || nr > paginas.length) continue;
    if (!perPagina.has(nr)) perPagina.set(nr, []);
    perPagina.get(nr).push(r);
    if (r.id) modelIds.add(String(r.id));
  }
  let geschreven = 0;
  paginas.forEach((pagina, i) => {
    const nr = i + 1;
    const node = pagina.node;
    const oud = node.lookup(PDFName.of('VP'));
    const nieuw = perPagina.get(nr) || [];
    const heeftEigen = oud instanceof PDFArray
      && Array.from({ length: oud.size() }, (_, j) => oud.lookup(j)).some(isEigenViewport);
    if (!nieuw.length && !heeftEigen) return;
    const blijft = [];
    if (oud instanceof PDFArray) {
      for (let j = 0; j < oud.size(); j++) {
        const d = oud.lookup(j);
        if (isEigenViewport(d)) {
          if (volledig) continue;
          const id = tekst(d.lookup(PDFName.of('OPS_Id')));
          if (id && modelIds.has(id)) continue;
        }
        blijft.push(oud.get(j));
      }
    }
    const box = zichtbaarVan(node);
    if (box && nieuw.length) {
      const rotatie = rotatieVan(pagina.getRotation().angle + (Number(opties.extraRotatie?.[nr]) || 0));
      // Grootste eerst, binnenste laatst (zie de kop).
      const volgorde = [...nieuw].sort((a, b) => (b.width * b.height) - (a.width * a.height));
      for (const r of volgorde) {
        blijft.push(context.register(viewportDict(context, r, box, rotatie, pageUserUnit(pagina))));
        geschreven += 1;
      }
    }
    if (blijft.length) node.set(PDFName.of('VP'), context.obj(blijft));
    else node.delete(PDFName.of('VP'));
  });
  return geschreven;
}

function precisieUit(d, measure, units) {
  const eigen = getal(d.lookup(PDFName.of('OPS_Precision')));
  if (Number.isInteger(eigen) && eigen >= 0 && eigen <= 6) return eigen;
  // Breuken en voet-inch (measure-precision.js) als tekst: 'f16', 'fi16'.
  const tekstPrecisie = tekst(d.lookup(PDFName.of('OPS_Precision'))).trim();
  if (tekstPrecisie && validPrecision(tekstPrecisie, units)) return tekstPrecisie;
  const x = measure instanceof PDFDict ? measure.lookup(PDFName.of('X')) : null;
  const opmaak = x instanceof PDFArray && x.size() ? x.lookup(0) : null;
  const den = opmaak instanceof PDFDict ? getal(opmaak.lookup(PDFName.of('D'))) : null;
  if (!(den >= 1)) return undefined;
  const p = Math.round(Math.log10(den));
  return p >= 0 && p <= 6 && 10 ** p === den ? p : undefined;
}

/**
 * De schaal (1:N + eenheid) van een eigen viewport: uit de eigen sleutels als
 * die een geldige schaal geven (zo blijft de invoer van de gebruiker, zoals
 * 1:48 in ft, letterlijk staan), anders afgeleid uit /Measure.
 */
function schaalUit(d, measure, userUnit = 1) {
  const scaleString = tekst(d.lookup(PDFName.of('OPS_ScaleString'))).trim();
  const units = tekst(d.lookup(PDFName.of('OPS_Units'))).trim();
  if (pixelsPerUnitFor(scaleString, units)) return { scaleString, units };
  if (measure instanceof PDFDict) {
    const x = measure.lookup(PDFName.of('X'));
    const opmaak = x instanceof PDFArray && x.size() ? x.lookup(0) : null;
    if (opmaak instanceof PDFDict) {
      const s = schaalUitMeasure(getal(opmaak.lookup(PDFName.of('C'))), tekst(opmaak.lookup(PDFName.of('U'))));
      const n = s ? ratioFromPixelsPerUnit(s.pixelsPerUnit * userUnit, s.unit) : null;
      if (n) return { scaleString: `1:${Number(n.toPrecision(6))}`, units: s.unit };
    }
  }
  return { scaleString, units };
}

/**
 * De OcuDraw-viewports van een pdf-lib-document, in app-ruimte, als
 * eigenschappen voor createScaleRegion.
 * @param {import('pdf-lib').PDFDocument} pdfLibDoc
 * @returns {Array<{page:number, x:number, y:number, width:number, height:number,
 *   label:string, scaleString:string, units:string, precision?:number, id?:string,
 *   tekeningtypeId?:string}>}
 */
export function leesEigenViewports(pdfLibDoc) {
  const uit = [];
  let paginas;
  try { paginas = pdfLibDoc.getPages(); } catch { return uit; }
  paginas.forEach((pagina, i) => {
    try {
      const node = pagina.node;
      const vp = node.lookup(PDFName.of('VP'));
      if (!(vp instanceof PDFArray) || vp.size() > MAX_VIEWPORTS) return;
      const media = rechthoek(geerfd(node, 'MediaBox'));
      if (!media) return;
      const view = doorsnede(media, rechthoek(geerfd(node, 'CropBox')));
      const rot = getal(geerfd(node, 'Rotate')) || 0;
      const userUnit = pageUserUnit(pagina);
      for (let j = 0; j < vp.size(); j++) {
        const d = vp.lookup(j);
        if (!isEigenViewport(d)) continue;
        const bbox = rechthoek(d.lookup(PDFName.of('BBox')));
        if (!bbox) continue;
        const rect = naarAppRuimte(bbox, view, rot, userUnit);
        if (!(rect.width > 0 && rect.height > 0)) continue;
        const measure = d.lookup(PDFName.of('Measure'));
        const item = {
          page: i + 1,
          ...rect,
          label: tekst(d.lookup(PDFName.of('Name'))).trim(),
          ...schaalUit(d, measure, userUnit),
        };
        const precisie = precisieUit(d, measure, item.units);
        if (precisie !== undefined) item.precision = precisie;
        const id = tekst(d.lookup(PDFName.of('OPS_Id'))).trim();
        if (id) item.id = id;
        const tt = tekst(d.lookup(PDFName.of('OPS_Tekeningtype'))).trim();
        if (tt) item.tekeningtypeId = tt;
        uit.push(item);
      }
    } catch {
      // Een kapotte viewport op één pagina mag de rest niet tegenhouden.
    }
  });
  return uit;
}
