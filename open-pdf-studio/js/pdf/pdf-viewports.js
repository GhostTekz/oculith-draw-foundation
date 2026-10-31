// Meetschaal uit de PDF zelf: `/VP`-viewports met een `/Measure`-woordenboek
// (ISO 32000, 12.9). CAD-programma's schrijven ze bij het plotten, en de
// DWG/DXF-import van deze app ook (#400). De maatvoering gebruikt ze nu
// meteen, zonder dat de gebruiker hoeft te kalibreren (zie getMeasureScale).
//
// Een viewport die de hele zichtbare pagina dekt, of die OcuDraw zelf als
// paginaschaal schreef (`/OPS_PageScale true`, zie pagina-schaal-vp.js), is
// geen gebied maar de schaal van de pagina: `paginaSchaal: true`. De
// meetketen (schaal-op-punt.js, viewportOp met zonderPagina) slaat die als
// gebied over en gebruikt hem als paginaschaal, ná de
// kleinere viewports (een CAD-detail binnen een plattegrond wint dus).
// Dit bestand leest alleen; schrijven doet pagina-schaal-vp.js. Benoemde
// viewports van OcuDraw (`/OPS_Viewport true`) slaat het over: die leest en
// schrijft viewports-vp.js als scaleRegion-annotaties.

import { PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, PDFBool } from 'pdf-lib';
import { parsePrecision } from '../annotations/measure-precision.js';
import { pageUserUnit } from './page-user-unit.js';

/** Millimeters per eenheid voor de eenheden die in een `/U`-label voorkomen. */
const MM_PER = Object.freeze({ mm: 1, cm: 10, dm: 100, m: 1000, km: 1000000, in: 25.4, ft: 304.8, yd: 914.4, mi: 1609344 });

/**
 * Eenheid uit het vrije `/U`-label van een getalopmaak. Leeg of onbekend geeft
 * null. Alleen een leeg label heeft de historische millimeterbetekenis.
 * @param {string} label
 */
export function eenheidUitLabel(label) {
  const u = String(label ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!u) return null;
  if (u === 'mm' || u === 'millimeter' || u === 'millimetre' || u === 'millimeters' || u === 'millimetres') return 'mm';
  if (u === 'cm' || u === 'centimeter' || u === 'centimetre' || u === 'centimeters' || u === 'centimetres') return 'cm';
  if (u === 'dm' || u === 'decimeter' || u === 'decimetre') return 'dm';
  if (u === 'm' || u === 'meter' || u === 'metre' || u === 'meters' || u === 'metres') return 'm';
  if (u === 'km') return 'km';
  if (u === 'in' || u === 'inch' || u === 'inches' || u === '"' || u === "''") return 'in';
  if (u === 'ft' || u === 'feet' || u === 'foot' || u === "'") return 'ft';
  if (u === 'yd' || u === 'yard' || u === 'yards') return 'yd';
  if (u === 'mi' || u === 'mile' || u === 'miles') return 'mi';
  return null;
}

/**
 * Meetschaal in de vorm van de app uit de eerste getalopmaak van `/X`:
 * `C` eenheden per punt, eenheid uit `U`.
 * @param {number} c
 * @param {string} u
 * @returns {{pixelsPerUnit:number, unit:string, mmPerPoint:number} | null}
 */
export function schaalUitMeasure(c, u) {
  const factor = Number(c);
  if (!(factor > 0) || !Number.isFinite(factor)) return null;
  const label = String(u ?? '').trim();
  const eenheid = label ? eenheidUitLabel(label) : 'mm';
  if (!eenheid) return null;
  const mmPerPoint = factor * MM_PER[eenheid];
  if (!(mmPerPoint > 0) || !Number.isFinite(mmPerPoint)) return null;
  // De app kent mm, cm, m, in en ft; km, yd en mi gaan naar m of ft.
  let pixelsPerUnit;
  let unit;
  switch (eenheid) {
    case 'km': pixelsPerUnit = 1 / (factor * 1000); unit = 'm'; break;
    // De app kent geen decimeters; tien keer zoveel centimeters.
    case 'dm': pixelsPerUnit = 1 / (factor * 10); unit = 'cm'; break;
    case 'yd': pixelsPerUnit = 1 / (factor * 3); unit = 'ft'; break;
    case 'mi': pixelsPerUnit = 1 / (factor * 5280); unit = 'ft'; break;
    default: pixelsPerUnit = 1 / factor; unit = eenheid;
  }
  return Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0
    ? { pixelsPerUnit, unit, mmPerPoint } : null;
}

/**
 * Eén punt uit de PDF-gebruikersruimte naar de app-ruimte (zie naarAppRuimte).
 * @returns {[number, number]}
 */
export function puntNaarAppRuimte(x, y, viewBox, rotatie, userUnit = 1) {
  const [vx0, vy0, vx1, vy1] = viewBox;
  const W = vx1 - vx0;
  const H = vy1 - vy0;
  const r = (((Number(rotatie) || 0) % 360) + 360) % 360;
  const u = x - vx0;
  const v = y - vy0;
  let point;
  switch (r) {
    case 90: point = [v, u]; break;
    case 180: point = [W - u, v]; break;
    case 270: point = [H - v, W - u]; break;
    default: point = [u, H - v];
  }
  return point.map(value => value * userUnit);
}

/**
 * Rechthoek in PDF-gebruikersruimte naar de app-ruimte: de weergegeven pagina
 * (/Rotate toegepast), oorsprong linksboven van de zichtbare box, y omlaag.
 * @param {number[]} bbox     [x0, y0, x1, y1] in gebruikersruimte
 * @param {number[]} viewBox  zichtbare box [x0, y0, x1, y1] (CropBox ∩ MediaBox)
 * @param {number} rotatie    /Rotate
 */
export function naarAppRuimte(bbox, viewBox, rotatie, userUnit = 1) {
  const punt = (x, y) => puntNaarAppRuimte(x, y, viewBox, rotatie, userUnit);
  const a = punt(bbox[0], bbox[1]);
  const b = punt(bbox[2], bbox[3]);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}

function getal(obj) {
  return obj instanceof PDFNumber ? obj.asNumber() : null;
}

function tekst(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try { return obj.decodeText(); } catch { return ''; }
  }
  return '';
}

export function rechthoek(arr) {
  if (!(arr instanceof PDFArray) || arr.size() < 4) return null;
  const v = [0, 1, 2, 3].map((i) => getal(arr.lookup(i)));
  return v.every((n) => n !== null && Number.isFinite(n)) ? v : null;
}

/**
 * Hoogste aantal hoekpunten dat uit een `/OPS_Clip` gelezen wordt; een langere
 * vorm telt niet mee (dan geldt de omhullende).
 */
export const MAX_VEELHOEK = 4096;

/**
 * Hoogste aantal viewports dat van één pagina gelezen wordt — dezelfde grens
 * als de lezer van de terugweg naar CAD (`MAX_VIEWPORTS` in de crate). Erover
 * valt de hele lijst van die pagina weg: een halve lijst zou de keuze van de
 * viewport op een punt veranderen. Deze lezer draait bij elk geopend document,
 * dus een bestand met een absurde lijst mag het openen niet vasthouden.
 */
export const MAX_VIEWPORTS = 1024;

/**
 * De eigen vorm van een viewport (`/OPS_Clip [x0 y0 x1 y1 …]`, geschreven door
 * de DWG/DXF-import bij een niet-rechthoekig venster) als punten in app-ruimte.
 * Alles wat niet klopt (oneven aantal, geen getal, te veel punten) geeft null:
 * dan geldt de omhullende.
 */
function veelhoekUit(arr, viewBox, rotatie, userUnit = 1) {
  if (!(arr instanceof PDFArray)) return null;
  const n = arr.size();
  if (n < 6 || n % 2 !== 0 || n > 2 * MAX_VEELHOEK) return null;
  const punten = [];
  for (let i = 0; i < n; i += 2) {
    const x = getal(arr.lookup(i));
    const y = getal(arr.lookup(i + 1));
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    punten.push(puntNaarAppRuimte(x, y, viewBox, rotatie, userUnit));
  }
  return punten;
}

/** Ligt het punt binnen de veelhoek (even-oneven, rand telt mee als binnen)? */
export function puntInVeelhoek(veelhoek, x, y) {
  let binnen = false;
  for (let i = 0, j = veelhoek.length - 1; i < veelhoek.length; j = i++) {
    const [xi, yi] = veelhoek[i];
    const [xj, yj] = veelhoek[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) binnen = !binnen;
  }
  return binnen;
}

export function doorsnede(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2]));
  const y0 = Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3]));
  const x1 = Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2]));
  const y1 = Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : a;
}

/** Private sleutel op een door OcuDraw geschreven paginaschaal-viewport. */
export const PAGINA_SCHAAL_SLEUTEL = 'OPS_PageScale';

/**
 * Private sleutel op een benoemde viewport die OcuDraw schreef (een
 * scaleRegion-annotatie in de app, zie viewports-vp.js). Die horen bij het
 * model en niet in de lijst van PDF-viewports: ze komen bij het openen als
 * annotatie binnen en worden bij elke save opnieuw geschreven.
 */
export const EIGEN_VIEWPORT_SLEUTEL = 'OPS_Viewport';

/** Is dit /VP-woordenboek een benoemde viewport die OcuDraw schreef? */
export function isEigenViewport(d) {
  if (!(d instanceof PDFDict)) return false;
  const v = d.lookup(PDFName.of(EIGEN_VIEWPORT_SLEUTEL));
  return v instanceof PDFBool && v.asBoolean();
}

/** Speling in punten waarmee een viewport nog als "hele pagina" telt. */
const PAGINA_MARGE = 1;

/**
 * Dekt de viewport (gebruikersruimte) de hele zichtbare box, op een punt na?
 * @param {number[]} bbox
 * @param {number[]} view
 */
export function dektPagina(bbox, view) {
  return Math.min(bbox[0], bbox[2]) <= Math.min(view[0], view[2]) + PAGINA_MARGE
    && Math.min(bbox[1], bbox[3]) <= Math.min(view[1], view[3]) + PAGINA_MARGE
    && Math.max(bbox[0], bbox[2]) >= Math.max(view[0], view[2]) - PAGINA_MARGE
    && Math.max(bbox[1], bbox[3]) >= Math.max(view[1], view[3]) - PAGINA_MARGE;
}

/** Is dit /VP-woordenboek een paginaschaal die OcuDraw schreef? */
export function isEigenPaginaSchaal(d) {
  if (!(d instanceof PDFDict)) return false;
  const v = d.lookup(PDFName.of(PAGINA_SCHAAL_SLEUTEL));
  return v instanceof PDFBool && v.asBoolean();
}

/** Zoekt een geërfde paginasleutel (MediaBox, CropBox, Rotate) op. */
export function geerfd(node, naam) {
  let n = node;
  for (let i = 0; n && i < 32; i++) {
    const v = n.lookup(PDFName.of(naam));
    if (v !== undefined && v !== null) return v;
    const ouder = n.lookup(PDFName.of('Parent'));
    n = ouder instanceof PDFDict ? ouder : null;
  }
  return null;
}

/**
 * De weergaveprecisie van een OcuDraw-paginaschaal (scaleData.precision,
 * zie measure-precision.js): `/OPS_Precision` ("2", "f16", "fi16"). De /D-
 * opmaak die pagina-schaal-vp.js ernaast schrijft is voor andere lezers;
 * oudere bestanden zonder sleutel houden de standaardopmaak.
 * @param {PDFDict} d de viewport
 * @param {string} unit de eenheid van de schaal
 * @returns {number|string|null}
 */
export function precisieVanViewport(d, unit) {
  const raw = tekst(d.lookup(PDFName.of('OPS_Precision'))).trim();
  if (!raw) return null;
  const precisie = /^\d$/u.test(raw) ? Number(raw) : raw;
  return parsePrecision(precisie, unit) ? precisie : null;
}

/**
 * Viewports met een meetschaal van één pdf-lib-pagina, in app-ruimte.
 * @param {import('pdf-lib').PDFPage} pagina
 * @returns {Array<{x:number,y:number,width:number,height:number,
 *   pixelsPerUnit:number, unit:string, mmPerPoint:number, ratio:string, name:string}>}
 */
export function leesViewportsVanPagina(pagina) {
  const lijst = [];
  try {
    const node = pagina.node;
    const vp = node.lookup(PDFName.of('VP'));
    if (!(vp instanceof PDFArray)) return lijst;
    const media = rechthoek(geerfd(node, 'MediaBox'));
    if (!media) return lijst;
    const view = doorsnede(media, rechthoek(geerfd(node, 'CropBox')));
    const rot = getal(geerfd(node, 'Rotate')) || 0;
    const userUnit = pageUserUnit(pagina);
    if (vp.size() > MAX_VIEWPORTS) {
      console.warn(`[pdf-viewports] pagina met ${vp.size()} viewports: meer dan ${MAX_VIEWPORTS}, de lijst wordt overgeslagen`);
      return lijst;
    }
    for (let j = 0; j < vp.size(); j++) {
      const d = vp.lookup(j);
      if (!(d instanceof PDFDict)) continue;
      // Benoemde viewports van OcuDraw zijn annotaties in het model (viewports-vp.js).
      if (isEigenViewport(d)) continue;
      const measure = d.lookup(PDFName.of('Measure'));
      const bbox = rechthoek(d.lookup(PDFName.of('BBox')));
      if (!(measure instanceof PDFDict) || !bbox) continue;
      const sub = measure.lookup(PDFName.of('Subtype'));
      if (sub && sub.toString() !== '/RL') continue;
      const x = measure.lookup(PDFName.of('X'));
      if (!(x instanceof PDFArray) || x.size() < 1) continue;
      const opmaak = x.lookup(0);
      if (!(opmaak instanceof PDFDict)) continue;
      const schaal = schaalUitMeasure(getal(opmaak.lookup(PDFName.of('C'))), tekst(opmaak.lookup(PDFName.of('U'))));
      if (!schaal) continue;
      schaal.pixelsPerUnit *= userUnit;
      const rect = naarAppRuimte(bbox, view, rot, userUnit);
      if (!(rect.width > 0 && rect.height > 0)) continue;
      const viewport = {
        ...rect,
        ...schaal,
        ratio: tekst(measure.lookup(PDFName.of('R'))).trim(),
        name: tekst(d.lookup(PDFName.of('Name'))).trim(),
      };
      const veelhoek = veelhoekUit(d.lookup(PDFName.of('OPS_Clip')), view, rot, userUnit);
      if (veelhoek) viewport.veelhoek = veelhoek;
      // Alleen een viewport met een modelmatrix draagt een terugweg naar CAD;
      // het exportvenster biedt de oorsprong "model" alleen dan aan.
      const matrix = d.lookup(PDFName.of('OPS_ModelMatrix'));
      if (matrix instanceof PDFArray && matrix.size() === 6) viewport.heeftModelMatrix = true;
      if (isEigenPaginaSchaal(d)) {
        viewport.paginaSchaal = true;
        viewport.eigen = true;
        const methode = tekst(d.lookup(PDFName.of('OPS_Method'))).trim();
        if (methode) viewport.method = methode;
        const bron = tekst(d.lookup(PDFName.of('OPS_Source'))).trim();
        if (bron) viewport.source = bron;
        const precisie = precisieVanViewport(d, schaal.unit);
        if (precisie != null) viewport.precision = precisie;
      } else if (dektPagina(bbox, view)) {
        viewport.paginaSchaal = true;
      }
      lijst.push(viewport);
    }
  } catch {
    // Een kapotte viewport op één pagina mag de rest niet tegenhouden.
  }
  return lijst;
}

/**
 * Viewports van een reeks pagina's, genummerd vanaf `eerstePagina`.
 * @param {import('pdf-lib').PDFPage[]} paginas
 * @param {number} eerstePagina  1-gebaseerd nummer van de eerste pagina
 */
export function viewportsVanPaginas(paginas, eerstePagina = 1) {
  const uit = {};
  (paginas || []).forEach((pagina, i) => {
    const lijst = leesViewportsVanPagina(pagina);
    if (lijst.length) uit[eerstePagina + i] = lijst;
  });
  return uit;
}

/**
 * Leest alle viewports met een meetschaal uit een pdf-lib-document.
 * @param {import('pdf-lib').PDFDocument} pdfLibDoc
 * @returns {Record<number, ReturnType<typeof leesViewportsVanPagina>>}
 *   per 1-gebaseerd paginanummer; pagina's zonder viewports ontbreken
 */
export function leesPdfViewports(pdfLibDoc) {
  let paginas;
  try { paginas = pdfLibDoc.getPages(); } catch { return {}; }
  return viewportsVanPaginas(paginas, 1);
}

// ── Achtergrondlezing ───────────────────────────────────────────────────────
// De viewports worden op de achtergrond gelezen (bij openen, na bijsnijden,
// rechtzetten, ongedaan maken). Komt er intussen een andere versie van het
// document, dan mag de oude lezing niet alsnog binnenkomen, en moet wie de
// nieuwe versie zet weten dát er nog een lezing openstond: de tussenwaarde is
// dan afgeleid van viewports die zelf nog niet bijgewerkt waren (#400).

let lezingTeller = 0;

/**
 * Begint een lezing voor dit document en maakt elke eerdere ongeldig.
 * @param {object} doc  het document uit de app-state
 * @returns {number} kenmerk van deze lezing
 */
export function beginViewportLezing(doc) {
  lezingTeller += 1;
  doc._viewportLezing = lezingTeller;
  return lezingTeller;
}

/** Staat er voor dit document nog een lezing open? */
export function viewportLezingLoopt(doc) {
  return doc?._viewportLezing != null;
}

/**
 * Rondt een lezing af. Alleen de laatst begonnen lezing mag haar uitkomst
 * zetten; `viewports` is `null` als het lezen mislukte.
 * @returns {boolean} true als de uitkomst gezet is (of de mislukking verwerkt)
 */
export function rondViewportLezingAf(doc, kenmerk, viewports) {
  if (!doc || doc._viewportLezing !== kenmerk) return false;
  doc._viewportLezing = null;
  if (viewports) doc.pdfViewports = Object.keys(viewports).length ? viewports : undefined;
  return true;
}

/**
 * Viewports na een wijziging in de paginavolgorde (invoegen, verwijderen,
 * verplaatsen, vervangen), zonder het document opnieuw te lezen: de bestaande
 * viewports verhuizen mee volgens `pageMapping` (oud → nieuw, `null` =
 * verdwenen) en de viewports van nieuwe pagina's komen erbij.
 * @param {Record<number, any[]>|undefined} oud
 * @param {Record<number, number|null>} pageMapping
 * @param {Record<number, any[]>} [nieuw]  viewports van nieuwe pagina's, op hun nieuwe nummer
 * @returns {Record<number, any[]>|undefined}  undefined als er geen enkele is
 */
export function herschikViewports(oud, pageMapping, nieuw = {}) {
  const uit = {};
  for (const [pagina, lijst] of Object.entries(oud || {})) {
    const naar = pageMapping?.[pagina];
    if (naar == null) continue;
    uit[naar] = lijst;
  }
  for (const [pagina, lijst] of Object.entries(nieuw || {})) {
    if (lijst?.length) uit[pagina] = lijst;
  }
  return Object.keys(uit).length ? uit : undefined;
}

/**
 * Viewports na een paginarotatie in de app, in de nieuwe weergaveruimte: de
 * rechthoek en de eigen vorm krijgen dezelfde draai als de annotaties
 * (renderer.rotatePage), zodat een maatlijn na het draaien in dezelfde
 * viewport valt als ervoor. Gelijk aan opnieuw lezen met de totale rotatie.
 * @param {Array<object>|undefined} lijst  viewports van één pagina
 * @param {number} delta   draai in graden (veelvoud van 90)
 * @param {number} oudeBreedte  weergegeven paginabreedte vóór de draai
 * @param {number} oudeHoogte   weergegeven paginahoogte vóór de draai
 */
export function draaiViewports(lijst, delta, oudeBreedte, oudeHoogte) {
  if (!Array.isArray(lijst)) return lijst;
  const r = (((Number(delta) || 0) % 360) + 360) % 360;
  if (r === 0) return lijst;
  const punt = ([x, y]) => {
    switch (r) {
      case 90: return [oudeHoogte - y, x];
      case 180: return [oudeBreedte - x, oudeHoogte - y];
      default: return [y, oudeBreedte - x];
    }
  };
  return lijst.map((v) => {
    const a = punt([v.x, v.y]);
    const b = punt([v.x + v.width, v.y + v.height]);
    const uit = {
      ...v,
      x: Math.min(a[0], b[0]),
      y: Math.min(a[1], b[1]),
      width: Math.abs(a[0] - b[0]),
      height: Math.abs(a[1] - b[1]),
    };
    if (Array.isArray(v.veelhoek)) uit.veelhoek = v.veelhoek.map(punt);
    return uit;
  });
}

/**
 * De paginaschaal-viewport van een pagina: een door OcuDraw geschreven eerst
 * (die vervangt bij opslaan een eerdere keuze van de gebruiker), anders de
 * eerste vreemde die de hele pagina dekt. Null als er geen is.
 * @param {Array<object>|undefined} viewports
 */
export function paginaViewport(viewports) {
  if (!Array.isArray(viewports)) return null;
  const bruikbaar = (v) => v?.paginaSchaal === true && Number.isFinite(v.pixelsPerUnit)
    && v.pixelsPerUnit > 0 && ['mm', 'cm', 'm', 'in', 'ft'].includes(v.unit);
  return viewports.find((v) => bruikbaar(v) && v.eigen === true)
    || viewports.find(bruikbaar) || null;
}

/**
 * De binnenste viewport die het punt bevat (kleinste oppervlak eerst), of null.
 * Met `zonderPagina` telt een paginaschaal-viewport (`paginaSchaal`) niet
 * mee: de meetketen (schaal-op-punt.js) neemt die pas als paginaschaal, na
 * een eventuele schaal die de gebruiker voor de pagina koos.
 * Een viewport met een eigen vorm (`veelhoek`) bevat het punt alleen als het
 * binnen die vorm ligt: de lege hoek van zijn omhullende is van de buren.
 * @param {Array<{x:number,y:number,width:number,height:number,veelhoek?:number[][]}>} viewports
 * @param {number} x
 * @param {number} y
 * @param {boolean} [zonderPagina]  paginaschaal-viewports overslaan
 */
export function viewportOp(viewports, x, y, zonderPagina = false) {
  // NaN (de statusbalk vraagt de schaal van de pagina als geheel) ligt nergens binnen.
  if (!Array.isArray(viewports) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  let beste = null;
  for (const v of viewports) {
    if (zonderPagina && v.paginaSchaal === true) continue;
    if (!Number.isFinite(v.pixelsPerUnit) || v.pixelsPerUnit <= 0
      || !['mm', 'cm', 'm', 'in', 'ft'].includes(v.unit)) continue;
    if (x < v.x || x > v.x + v.width || y < v.y || y > v.y + v.height) continue;
    if (Array.isArray(v.veelhoek) && v.veelhoek.length >= 3 && !puntInVeelhoek(v.veelhoek, x, y)) continue;
    if (!beste || v.width * v.height < beste.width * beste.height) beste = v;
  }
  return beste;
}
