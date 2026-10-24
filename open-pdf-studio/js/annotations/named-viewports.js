// Benoemde viewports: een rechthoek op de pagina met een eigen naam en
// schaal. In het model een scaleRegion-annotatie (zodat de meetketen,
// paginabewerkingen, draaien en ongedaan maken ze al kennen); in de PDF een
// /VP-entry (pdf/viewports-vp.js). Geen markering: niet zichtbaar buiten de
// meetgereedschappen (viewport-zichtbaarheid.js), niet in de markeringslijst.
//
// Elke wijziging (toevoegen, hernoemen, schaal, verwijderen, alles wissen)
// rekent de metingen opnieuw uit en is samen met die metingen één
// ongedaan-stap. Binnen een viewport geldt zijn schaal; bij geneste
// viewports de binnenste (scale-region.js).

import { getActiveDocument } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { createScaleRegion, invalidateScaleRegionCache, pixelsPerUnitFor } from './scale-region.js';
import { normalizeRatioInput, SCALE_UNITS } from './scale-entry.js';
import { recalculateAllMeasurements } from './measurement.js';
import { validPrecision } from './measure-precision.js';
import { equationPixelsPerUnit, validEquation } from './scale-presets.js';
import {
  recordAdd, recordBulkModify, recordBulkDelete,
  beginUndoTransaction, endUndoTransaction,
} from '../core/undo-manager.js';

const MEASUREMENT_TYPES = new Set(['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']);

/** De viewports van een pagina, in lijstvolgorde. */
export function viewportsOpPagina(doc, pageNum) {
  return (doc?.annotations || []).filter(a => a.type === 'scaleRegion' && a.page === pageNum);
}

/** Alle viewports van het document. */
export function alleViewports(doc) {
  return (doc?.annotations || []).filter(a => a.type === 'scaleRegion');
}

/** Een naam die op deze pagina nog vrij is: "Viewport 1", "Viewport 2", … */
export function standaardViewportNaam(doc, pageNum, basis = 'Viewport') {
  const namen = new Set(viewportsOpPagina(doc, pageNum).map(v => String(v.label || '').trim()));
  for (let i = 1; ; i++) {
    const naam = `${basis} ${i}`;
    if (!namen.has(naam)) return naam;
  }
}

/**
 * Weergaveprecisie voor de eenheid (measure-precision.js: 0–6 decimalen,
 * 'fN' inchbreuken, 'fiN' voet-inch), anders undefined.
 */
function precisie(p, units) {
  if (typeof p === 'string' && /^\d$/u.test(p)) p = Number(p);
  return validPrecision(p, units) ? p : undefined;
}

/** De vergelijking (1/4 in = 1 ft) waarmee de schaal is ingesteld, als hij erbij past. */
function vergelijking(eq, units, pixelsPerUnit) {
  const e = validEquation(eq);
  if (!e || e.realUnit !== units) return undefined;
  const ppu = equationPixelsPerUnit(e);
  return Math.abs(ppu - pixelsPerUnit) <= 1e-4 * pixelsPerUnit ? { ...e } : undefined;
}

/**
 * Controleert de invoer van "Apply Scale to Viewport". Een naam is verplicht:
 * een viewport zonder naam is in de lijst en in andere programma's niet te
 * herkennen. De schaal is 1:N of een architectenschaal (1/4" = 1'-0").
 * @param {{label?:string, scaleString?:string, units?:string, precision?:number|string, equation?:object}} invoer
 * @returns {{ok:true, waarden:{label:string, scaleString:string, units:string, precision?:number|string, equation?:object}}
 *   | {ok:false, fout:'naam'|'schaal'|'eenheid'}}
 */
export function controleerViewportInvoer(invoer = {}) {
  const label = String(invoer.label ?? '').trim();
  if (!label) return { ok: false, fout: 'naam' };
  const scaleString = normalizeRatioInput(invoer.scaleString);
  if (!scaleString) return { ok: false, fout: 'schaal' };
  const units = invoer.units;
  const ppu = SCALE_UNITS.includes(units) ? pixelsPerUnitFor(scaleString, units) : null;
  if (!ppu) return { ok: false, fout: 'eenheid' };
  const waarden = { label, scaleString, units };
  const p = precisie(invoer.precision, units);
  if (p !== undefined) waarden.precision = p;
  const eq = vergelijking(invoer.equation, units, ppu);
  if (eq) waarden.equation = eq;
  return { ok: true, waarden };
}

const meetSleutel = (a) => JSON.stringify([a.measureValue, a.measureText, a.measureUnit, a.measurePixels]);

/**
 * Voert `wijzig` uit (die de viewports aanpast en vastlegt), rekent de
 * metingen opnieuw uit en maakt van alles één ongedaan-stap.
 */
function metMetingen(doc, wijzig) {
  const metingen = doc.annotations.filter(a => MEASUREMENT_TYPES.has(a.type));
  const voor = metingen.map(a => cloneAnnotation(a));
  const voorSleutels = metingen.map(meetSleutel);
  beginUndoTransaction();
  try {
    wijzig();
    invalidateScaleRegionCache();
    recalculateAllMeasurements();
    const gewijzigd = [];
    const origineel = [];
    metingen.forEach((a, i) => {
      if (meetSleutel(a) !== voorSleutels[i]) { gewijzigd.push(a); origineel.push(voor[i]); }
    });
    recordBulkModify(gewijzigd, origineel);
  } finally {
    endUndoTransaction();
  }
}

function zoek(doc, id) {
  return (doc?.annotations || []).find(a => a.type === 'scaleRegion' && a.id === id) || null;
}

/**
 * Bevestigt een nieuwe viewport (het gereedschap zette hem al in de lijst,
 * zodat hij zichtbaar is terwijl de dialoog openstaat) of past een bestaande
 * aan: naam, schaal, eenheid, precisie.
 * @param {string} id
 * @param {object} invoer  zie controleerViewportInvoer
 * @param {{isNew?:boolean, snapshot?:object}} [opties]  snapshot: de toestand
 *   vóór de dialoog (voor ongedaan maken van een aanpassing)
 */
export function pasViewportToe(id, invoer, opties = {}) {
  const doc = getActiveDocument();
  const ann = zoek(doc, id);
  if (!ann) return { ok: false, fout: 'weg' };
  const check = controleerViewportInvoer(invoer);
  if (!check.ok) return check;
  const voor = opties.snapshot ? cloneAnnotation(opties.snapshot) : cloneAnnotation(ann);
  metMetingen(doc, () => {
    Object.assign(ann, check.waarden);
    if (check.waarden.precision === undefined) delete ann.precision;
    if (check.waarden.equation === undefined) delete ann.equation;
    ann.modifiedAt = new Date().toISOString();
    if (opties.isNew) recordAdd(ann);
    else recordBulkModify([ann], [voor]);
  });
  return { ok: true, viewport: ann };
}

/** Alleen de naam: geen herberekening nodig, wel een ongedaan-stap. */
export function hernoemViewport(id, label) {
  const doc = getActiveDocument();
  const ann = zoek(doc, id);
  const naam = String(label ?? '').trim();
  if (!ann) return { ok: false, fout: 'weg' };
  if (!naam) return { ok: false, fout: 'naam' };
  if (naam === ann.label) return { ok: true, viewport: ann };
  const voor = cloneAnnotation(ann);
  ann.label = naam;
  ann.modifiedAt = new Date().toISOString();
  recordBulkModify([ann], [voor]);
  return { ok: true, viewport: ann };
}

/** Verwijdert viewports; de metingen erin vallen terug op de schaal eromheen. */
export function verwijderViewports(ids) {
  const doc = getActiveDocument();
  if (!doc) return 0;
  const weg = new Set(ids);
  const doelen = doc.annotations.filter(a => a.type === 'scaleRegion' && weg.has(a.id));
  if (!doelen.length) return 0;
  metMetingen(doc, () => {
    // Het commando onthoudt de plaats in de lijst: vóór het weghalen vastleggen.
    recordBulkDelete(doelen);
    for (const a of doelen) {
      const i = doc.annotations.indexOf(a);
      if (i !== -1) doc.annotations.splice(i, 1);
    }
    if (doelen.includes(doc.selectedAnnotation)) doc.selectedAnnotation = null;
    if (Array.isArray(doc.selectedAnnotations)) {
      doc.selectedAnnotations = doc.selectedAnnotations.filter(a => !doelen.includes(a));
    }
  });
  return doelen.length;
}

/**
 * "Clear All": alle viewports van een pagina of van het hele document.
 * @param {'page'|'document'} bereik
 * @param {number} [pageNum]
 */
export function wisViewports(bereik, pageNum) {
  const doc = getActiveDocument();
  if (!doc) return 0;
  const lijst = bereik === 'document' ? alleViewports(doc) : viewportsOpPagina(doc, pageNum ?? doc.currentPage ?? 1);
  return verwijderViewports(lijst.map(a => a.id));
}

/** Een nieuwe viewport die de dialoog afbreekt: weg, zonder ongedaan-stap. */
export function annuleerNieuweViewport(id) {
  const doc = getActiveDocument();
  const ann = zoek(doc, id);
  if (!ann) return;
  const i = doc.annotations.indexOf(ann);
  if (i !== -1) doc.annotations.splice(i, 1);
  invalidateScaleRegionCache();
}

/**
 * De OcuDraw-viewports uit het bestand (leesEigenViewports) als annotaties in
 * het model, bij het openen. Geen ongedaan-stap en geen herberekening: de
 * metingen in het bestand zijn met deze viewports gemaakt. Een id dat al in
 * het model staat, komt niet nog eens binnen.
 * @param {object} doc
 * @param {Array<object>} items
 * @returns {number} aantal toegevoegde viewports
 */
export function neemEigenViewportsOver(doc, items) {
  if (!doc) return 0;
  if (!Array.isArray(doc.annotations)) doc.annotations = [];
  const ids = new Set(doc.annotations.map(a => a.id));
  let n = 0;
  for (const item of items || []) {
    if (item.id && ids.has(item.id)) continue;
    const ann = createScaleRegion(item);
    if (item.id) ann.id = item.id;
    ids.add(ann.id);
    doc.annotations.push(ann);
    n += 1;
  }
  doc._eigenViewportsGelezen = true;
  if (n) invalidateScaleRegionCache();
  return n;
}
