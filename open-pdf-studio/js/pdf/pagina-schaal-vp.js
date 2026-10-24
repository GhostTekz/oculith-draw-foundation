// Paginaschaal in de PDF zelf: per gekalibreerde pagina één `/VP`-viewport
// met een `/Measure`-woordenboek (ISO 32000-1, 12.9). the external editor en Acrobat lezen
// de schaal van een pagina uit zo'n viewport; pdf-viewports.js leest hem bij
// het openen terug als paginaschaal.
//
// Wat hier geschreven wordt:
//   << /Type /Viewport /BBox [zichtbare box] /Name (…) /OPS_PageScale true
//      /OPS_Method (ratio)
//      /Measure << /Type /Measure /Subtype /RL /R (1 in = 4 ft)
//                  /X [<< /Type /NumberFormat /U (ft) /C 0.0555… /F /D /D 100 >>]
//                  /D [<< /Type /NumberFormat /U (ft) /C 1 /F /D /D 100 >>]
//                  /A [<< /Type /NumberFormat /U (sq ft) /C 1 /F /D /D 100 >>] >> >>
//
// Met een precisie uit Set Scale wordt /D een breuk (/F /F /D 16 in inch)
// of voet-inch ([<< /U (ft) /F /T >> << /U (in) /C 12 /F /F /D 16 >>]);
// De precisie zelf staat in /OPS_Precision; pdf-viewports.js leest die
// terug als scaleData.precision.
//
// /BBox is de zichtbare box (MediaBox ∩ CropBox) in standaard-gebruikers-
// ruimte, dus met de oorsprong van de CropBox en zonder /Rotate. /C in /X is
// eenheden per gebruikerseenheid (1/72 inch op papier) = 1 / pixelsPerUnit;
// /D en /A rekenen vanaf de /X-eenheid (C 1). Rotatie verandert geen van
// beide.
//
// Alleen viewports met `/OPS_PageScale true` zijn van OcuDraw: die worden bij
// elke save vervangen, nooit verdubbeld. Andere viewports (CAD-plots, the external editor)
// blijven precies staan.

import { PDFName, PDFArray, PDFString, PDFBool, PDFNumber } from 'pdf-lib';
import { PAGINA_SCHAAL_SLEUTEL, isEigenPaginaSchaal, geerfd, rechthoek, doorsnede } from './pdf-viewports.js';
import { geldigeSchaal } from '../annotations/schaal-op-punt.js';
import { ratioFromPixelsPerUnit } from '../annotations/scale-entry.js';
import { parsePrecision } from '../annotations/measure-precision.js';
import { equationText, equationPixelsPerUnit, validEquation } from '../annotations/scale-presets.js';
import { pageUserUnit } from './page-user-unit.js';

const INCHES_PER_UNIT = { mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254, in: 1, ft: 12 };

function getal(n) {
  return Number(n.toPrecision(10));
}

/**
 * Leesbare schaal voor `/R`: een papiereenheid gelijk aan een werkelijke
 * lengte. Imperiaal op een inch papier ("1 in = 4 ft" voor 1:48), metrisch
 * op een millimeter papier ("1 mm = 100 mm", "1 mm = 0.1 m").
 * @param {{pixelsPerUnit:number, unit:string}} schaal
 * @returns {string}
 */
export function schaalTekst(schaal) {
  // Set Scale keeps the equation the user typed ("1 in = 8 ft", "0.25 in = 1 ft").
  const eq = validEquation(schaal.equation);
  const ppu = eq && eq.realUnit === schaal.unit ? equationPixelsPerUnit(eq) : null;
  if (ppu && Math.abs(ppu - schaal.pixelsPerUnit) <= 1e-9 * ppu) return equationText(eq);
  const n = ratioFromPixelsPerUnit(schaal.pixelsPerUnit, schaal.unit);
  if (!n) return '';
  const papier = schaal.unit === 'in' || schaal.unit === 'ft' ? 'in' : 'mm';
  const werkelijk = (INCHES_PER_UNIT[papier] * n) / INCHES_PER_UNIT[schaal.unit];
  return `1 ${papier} = ${Number(werkelijk.toPrecision(6))} ${schaal.unit}`;
}

function getalOpmaak(context, eenheid, c, decimalen) {
  return opmaak(context, eenheid, c, 'D', 10 ** decimalen);
}

// /F: D decimaal (/D = 10^n), F breuk (/D = noemer), T afkappen (de grotere
// eenheid van een samengestelde opmaak, zoals de voeten van 23'-10 1/2").
function opmaak(context, eenheid, c, f, d) {
  const velden = {
    Type: PDFName.of('NumberFormat'),
    U: PDFString.of(eenheid),
    C: PDFNumber.of(c),
    F: PDFName.of(f),
  };
  if (d != null) velden.D = PDFNumber.of(d);
  return context.obj(velden);
}

/**
 * /D van een paginaschaal: de afstandsopmaak die bij de precisie van Set
 * Scale hoort. Breuken als /F /F met de noemer in /D; voet-inch als twee
 * opmaken, voeten afgekapt en de rest in inch (ISO 32000-1, 12.9.2).
 */
function afstandOpmaak(context, schaal, decimalen) {
  const p = parsePrecision(schaal.precision, schaal.unit);
  if (p?.kind === 'fraction') return [opmaak(context, 'in', 1, 'F', p.denominator)];
  if (p?.kind === 'feetInches') {
    return [opmaak(context, 'ft', schaal.unit === 'ft' ? 1 : 1 / 12, 'T'),
      opmaak(context, 'in', 12, 'F', p.denominator)];
  }
  return [getalOpmaak(context, schaal.unit, 1, decimalen)];
}

/**
 * Het /Measure-woordenboek van een paginaschaal.
 * @param {import('pdf-lib').PDFContext} context
 * @param {{pixelsPerUnit:number, unit:string, precision?:number|string, equation?:object}} schaal
 */
export function measureVoorSchaal(context, schaal, userUnit = 1) {
  const p = Number.isInteger(schaal.precision) && schaal.precision >= 0 && schaal.precision <= 6
    ? schaal.precision : 2;
  return context.obj({
    Type: PDFName.of('Measure'),
    Subtype: PDFName.of('RL'),
    R: PDFString.of(schaalTekst(schaal)),
    X: context.obj([getalOpmaak(context, schaal.unit, getal(userUnit / schaal.pixelsPerUnit), p)]),
    D: context.obj(afstandOpmaak(context, schaal, p)),
    A: context.obj([getalOpmaak(context, `sq ${schaal.unit}`, 1, p)]),
  });
}

/** Zichtbare box van een pdf-lib-pagina in standaard-gebruikersruimte. */
export function zichtbareBox(pagina) {
  const media = rechthoek(geerfd(pagina.node, 'MediaBox'));
  if (!media) return null;
  const view = doorsnede(media, rechthoek(geerfd(pagina.node, 'CropBox')));
  return [Math.min(view[0], view[2]), Math.min(view[1], view[3]),
    Math.max(view[0], view[2]), Math.max(view[1], view[3])];
}

/**
 * Schrijft de paginaschalen in de pagina's van een pdf-lib-document. Alleen
 * pagina's met een eigen sleutel in `pageScales` worden aangeraakt: hun
 * OcuDraw-viewports gaan eruit en de huidige schaal (als die er is) komt
 * erbij. `null` wist de paginaschaal. Een schaal die zelf uit een vreemde
 * paginaviewport komt (method 'pdfPage') staat al in het bestand en wordt
 * niet nog eens geschreven.
 * @param {import('pdf-lib').PDFDocument} pdfDocLib
 * @param {Record<number, object|null>|undefined|null} pageScales
 * @param {{naam?:string}} [opties]
 * @returns {number} aantal geschreven viewports
 */
export function schrijfPaginaSchalen(pdfDocLib, pageScales, opties = {}) {
  if (!pageScales || typeof pageScales !== 'object') return 0;
  const context = pdfDocLib.context;
  const paginas = pdfDocLib.getPages();
  let geschreven = 0;
  for (const sleutel of Object.keys(pageScales)) {
    const nr = Number(sleutel);
    const pagina = Number.isInteger(nr) ? paginas[nr - 1] : null;
    if (!pagina) continue;
    const node = pagina.node;
    const oud = node.lookup(PDFName.of('VP'));
    const blijft = [];
    if (oud instanceof PDFArray) {
      for (let i = 0; i < oud.size(); i++) {
        if (!isEigenPaginaSchaal(oud.lookup(i))) blijft.push(oud.get(i));
      }
    }
    const schaal = pageScales[sleutel];
    const box = zichtbareBox(pagina);
    if (geldigeSchaal(schaal) && schaal.method !== 'pdfPage' && box) {
      const vp = context.obj({
        Type: PDFName.of('Viewport'),
        BBox: context.obj(box),
        Name: PDFString.of(String(schaal.label || opties.naam || 'Page scale')),
        Measure: measureVoorSchaal(context, schaal, pageUserUnit(pagina)),
      });
      vp.set(PDFName.of(PAGINA_SCHAAL_SLEUTEL), PDFBool.True);
      if (schaal.method) vp.set(PDFName.of('OPS_Method'), PDFString.of(String(schaal.method)));
      if (parsePrecision(schaal.precision, schaal.unit)) {
        vp.set(PDFName.of('OPS_Precision'), PDFString.of(String(schaal.precision)));
      }
      blijft.push(vp);
      geschreven += 1;
    }
    const zelfde = oud instanceof PDFArray && blijft.length === oud.size()
      && blijft.every((obj, i) => obj === oud.get(i));
    if (zelfde) continue;
    if (blijft.length) node.set(PDFName.of('VP'), context.obj(blijft));
    else node.delete(PDFName.of('VP'));
  }
  return geschreven;
}
