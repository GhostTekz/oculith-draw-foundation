import { $RAW } from 'solid-js/store';
// De schaal op één punt van een pagina, uit de bronnen van het document, in
// één vaste volgorde (#400). Dit is de gedeelde regel achter
// scale-bar.getScaleForPoint, en daarmee achter getMeasureScale én de lichte
// schaalbruggen (stempels, stavenreeks, betonbalk, systeemraster, dynamische
// schaal): de volgorde staat op één plek en loopt niet op vijf plekken uiteen.
//
// Volgorde:
//   1. viewport-annotatie van de app die het punt bevat
//   2. schaalbalk-annotatie op dezelfde pagina
//   3. viewport uit de PDF zelf (/VP + /Measure: CAD-plots, de DWG/DXF-import)
//      die kleiner is dan de pagina
//   4. paginaschaal (paginaSchaal: doc.pageScales, anders een /VP die de hele
//      pagina dekt; the external editor en Acrobat bewaren de schaal per pagina zo)
//   5. documentschaal (doc.measureScale: oude localStorage-schaal of MCP)
//   6. schaalbalk op een andere pagina
// Het schaalgebied (scaleRegion) gaat hier nog vóór; dat zoekt de aanroeper
// op via scale-region.js.
//
// De bronnen worden in één doorloop over de annotaties verzameld
// (verzamelSchaalBronnen); een opzoeking daarna kost alleen nog de bronnen
// van die pagina, niet de hele annotatielijst (#491). Wie veel punten
// opzoekt, verzamelt één keer en vraagt dan schaalOpPuntUitBronnen; zie
// schaal-bronnen.js voor de doorloop die dat voor de app regelt.
//
// Geen app-state: importeert alleen pdf-viewports.js (pdf-lib), zodat de
// regel onder node te testen is en de bruggen hem zonder importcyclus kunnen
// gebruiken.

import { viewportOp, paginaViewport } from '../pdf/pdf-viewports.js';

const MEASURE_UNITS = new Set(['mm', 'cm', 'm', 'in', 'ft']);
export function geldigeSchaal(bron) {
  return Number.isFinite(bron?.pixelsPerUnit) && bron.pixelsPerUnit > 0
    && MEASURE_UNITS.has(bron.unit);
}

// Older document-wide calibrations omitted the unit and meant millimetres.
// A present but unsupported unit must not turn a PDF-point length into a
// physical quantity. Keep this rule shared by measurements and light bridges.
export function geldigeDocumentSchaal(bron) {
  if (!bron) return null;
  const unit = bron.unit == null ? 'mm' : bron.unit;
  return geldigeSchaal({ pixelsPerUnit: bron.pixelsPerUnit, unit })
    ? { pixelsPerUnit: bron.pixelsPerUnit, unit } : null;
}

/**
 * De schaal van een pagina als geheel. Een eigen sleutel in doc.pageScales
 * wint (ook `null`: de gebruiker heeft de schaal van die pagina gewist);
 * zonder sleutel geldt een /VP-viewport uit de PDF die de hele pagina dekt
 * (door OcuDraw geschreven, of door CAD/the external editor), zie pdf-viewports.js.
 * @param {{pageScales?:Record<number, object|null>, pdfViewports?:Record<number, Array<object>>}
 *   | null | undefined} doc
 * @param {number} pageNum
 * @returns {{pixelsPerUnit:number, unit:string, method:string, scaleRatio?:any} | null}
 */
export function paginaSchaal(doc, pageNum) {
  if (!doc) return null;
  const map = doc.pageScales;
  if (map && Object.prototype.hasOwnProperty.call(map, pageNum)) {
    const s = map[pageNum];
    return geldigeSchaal(s) ? { ...s, method: s.method || 'page' } : null;
  }
  const vp = paginaViewport(doc.pdfViewports?.[pageNum]);
  if (!vp) return null;
  return { pixelsPerUnit: vp.pixelsPerUnit, unit: vp.unit, method: vp.method || 'pdfPage',
    scaleRatio: vp.ratio || null, ...(vp.precision != null ? { precision: vp.precision } : {}),
    ...(vp.source ? { source: vp.source } : {}) };
}

/**
 * Of de gebruiker de schaal van deze pagina uitdrukkelijk heeft gewist
 * (`doc.pageScales[page] === null`). Zo'n pagina valt niet terug op de
 * documentschaal: wissen betekent "Scale not set".
 */
export function paginaGewist(doc, pageNum) {
  const map = doc?.pageScales;
  return !!map && Object.prototype.hasOwnProperty.call(map, pageNum) && map[pageNum] == null;
}

/**
 * De paginaschaal, anders de documentschaal: voor wie "de" schaal van een
 * pagina wil tonen of overnemen (dialoog, schaalbalk, paneel), niet voor een
 * meting op een punt (die gebruikt schaalOpPunt).
 */
export function paginaOfDocumentSchaal(doc, pageNum) {
  const pagina = paginaSchaal(doc, pageNum);
  if (pagina) return pagina;
  if (paginaGewist(doc, pageNum)) return null;
  const docSchaal = geldigeDocumentSchaal(doc?.measureScale);
  return docSchaal ? { ...doc.measureScale, ...docSchaal } : null;
}

/**
 * @typedef {object} SchaalBronnen
 * @property {Map<any, Array<object>>} viewports  viewport-annotaties per pagina, in lijstvolgorde
 * @property {Map<any, object>} balkOpPagina       eerste schaalbalk per pagina
 * @property {Array<object>} schaalbalken          alle schaalbalken, in lijstvolgorde
 * @property {Map<any, Array<object>>} gebieden    schaalgebieden per pagina, in lijstvolgorde
 * @property {Map<any, Array<object>>} gesorteerd  schaalgebieden per pagina, kleinste eerst (lui)
 */

function voegToe(map, sleutel, waarde) {
  const lijst = map.get(sleutel);
  if (lijst) lijst.push(waarde);
  else map.set(sleutel, [waarde]);
}

// Zelfde gelijkheid als `a.page === pageNum`: een Map ziet NaN als gelijk aan
// NaN, een strikte vergelijking niet.
function opPagina(map, pageNum) {
  return pageNum === pageNum ? map.get(pageNum) : undefined;
}

/**
 * Alle schaalbronnen van een document in één doorloop over de annotaties.
 * De annotaties zelf worden niet gekopieerd: een opzoeking leest hun actuele
 * maten en schaal, alleen wélke annotaties bron zijn (en op welke pagina)
 * ligt vast op het moment van verzamelen.
 * @param {{annotations?:Array<object>} | null | undefined} doc
 * @returns {SchaalBronnen}
 */
export function verzamelSchaalBronnen(doc) {
  const viewports = new Map();
  const balkOpPagina = new Map();
  const schaalbalken = [];
  const gebieden = new Map();
  const annotaties = doc && Array.isArray(doc.annotations) ? doc.annotations : [];
  // Het type lezen uit de ruwe lijst: via de store ging elke annotatie door
  // een proxy, op 20.000 markeringen een flink deel van het openen. Alleen
  // een bron zelf komt uit de store, zodat een opzoeking haar actuele maten
  // en schaal volgt; de lengte via de store telt toevoegen en verwijderen.
  const ruw = annotaties[$RAW] || annotaties;
  const n = annotaties.length;
  for (let i = 0; i < n; i++) {
    const type = ruw[i]?.type;
    if (type !== 'viewport' && type !== 'scaleBar' && type !== 'scaleRegion') continue;
    const a = annotaties[i];
    if (type === 'viewport') {
      voegToe(viewports, a.page, a);
    } else if (type === 'scaleBar') {
      schaalbalken.push(a);
      const pagina = a.page;
      if (!balkOpPagina.has(pagina) && geldigeSchaal(a)) balkOpPagina.set(pagina, a);
    } else if (type === 'scaleRegion') {
      voegToe(gebieden, a.page, a);
    }
  }
  return { viewports, balkOpPagina, schaalbalken, gebieden, gesorteerd: new Map() };
}

/**
 * De schaalgebieden van een pagina, kleinste oppervlak eerst (het binnenste
 * gebied wint). Bij gelijk oppervlak blijft de lijstvolgorde staan.
 * @param {SchaalBronnen} bronnen
 * @param {number} pageNum
 * @returns {Array<object>}
 */
export function schaalgebiedenOpPagina(bronnen, pageNum) {
  let lijst = bronnen.gesorteerd.get(pageNum);
  if (!lijst) {
    lijst = [...(opPagina(bronnen.gebieden, pageNum) || [])];
    lijst.sort((a, b) => (a.width * a.height) - (b.width * b.height));
    bronnen.gesorteerd.set(pageNum, lijst);
  }
  return lijst;
}

/**
 * schaalOpPunt met vooraf verzamelde bronnen van hetzelfde document.
 * @param {SchaalBronnen} bronnen
 * @param {{pdfViewports?:Record<number, Array<object>>, pageScales?:Record<number, object|null>,
 *   measureScale?:{pixelsPerUnit:number, unit?:string}} | null | undefined} doc
 * @param {number} pageNum
 * @param {number} x
 * @param {number} y
 * @returns {{pixelsPerUnit:number, unit:string, method:string} | null}
 */
export function schaalOpPuntUitBronnen(bronnen, doc, pageNum, x, y) {
  if (!doc) return null;

  const viewports = opPagina(bronnen.viewports, pageNum);
  if (viewports) {
    for (const a of viewports) {
      if (geldigeSchaal(a) && x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height) {
        return { pixelsPerUnit: a.pixelsPerUnit, unit: a.unit, method: 'viewport' };
      }
    }
  }

  const balk = opPagina(bronnen.balkOpPagina, pageNum);
  if (geldigeSchaal(balk)) return { pixelsPerUnit: balk.pixelsPerUnit, unit: balk.unit, method: 'scaleBar' };

  const vp = viewportOp(doc.pdfViewports?.[pageNum], x, y, true);
  if (geldigeSchaal(vp)) return { pixelsPerUnit: vp.pixelsPerUnit, unit: vp.unit, method: 'pdfViewport' };

  const pagina = paginaSchaal(doc, pageNum);
  if (pagina) {
    return { pixelsPerUnit: pagina.pixelsPerUnit, unit: pagina.unit, method: 'page',
      ...(pagina.precision != null ? { precision: pagina.precision } : {}) };
  }
  // De gebruiker heeft de schaal van deze pagina gewist: geen documentschaal
  // of schaalbalk van een andere pagina meer, de pagina is ongekalibreerd.
  if (paginaGewist(doc, pageNum)) return null;

  const docSchaal = geldigeDocumentSchaal(doc.measureScale);
  if (docSchaal) {
    return { ...docSchaal, method: 'document' };
  }

  const eerste = bronnen.schaalbalken.find(geldigeSchaal);
  if (eerste) {
    return { pixelsPerUnit: eerste.pixelsPerUnit, unit: eerste.unit, method: 'scaleBar' };
  }
  return null;
}

/**
 * @param {{annotations?:Array<object>, pdfViewports?:Record<number, Array<object>>,
 *   pageScales?:Record<number, object|null>,
 *   measureScale?:{pixelsPerUnit:number, unit?:string}} | null | undefined} doc
 * @param {number} pageNum
 * @param {number} x
 * @param {number} y
 * @returns {{pixelsPerUnit:number, unit:string, method:string} | null}
 */
export function schaalOpPunt(doc, pageNum, x, y) {
  if (!doc) return null;
  return schaalOpPuntUitBronnen(verzamelSchaalBronnen(doc), doc, pageNum, x, y);
}
