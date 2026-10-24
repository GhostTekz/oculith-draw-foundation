// the external editor measurement text: the /NumberFormat chain of a /Measure dictionary
// (ISO 32000-1, 12.9.2), as the external editor shows it. A feet-inches distance is two
// formats, feet truncated and the rest in inches with a fraction:
//
//   /D [ << /U (') /C 1 /F /F /D 8 /PS () /SS (-) >>
//        << /U (") /C 12 /F /F /D 8 /PS () /SS () >> ]   ->  123'-6 1/2"
//   /A [ << /U (sf) /C 1 /D 100 /SS () >> ]              ->  1,234.7 sf
//
// Before this module OcuDraw showed only the first unit with decimals
// (123.54 '), and wrote that text back into an edited the external editor measurement.

import { PDFDict, PDFArray, PDFRef, PDFNumber, PDFName, PDFString, PDFHexString } from 'pdf-lib';

const N = (s) => PDFName.of(s);

function opgezocht(context, raw) {
  return raw instanceof PDFRef ? context.lookup(raw) : raw;
}

function tekst(context, raw) {
  const v = opgezocht(context, raw);
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
}

function getal(context, raw) {
  const v = opgezocht(context, raw);
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

/**
 * A /NumberFormat array as plain objects: { u, c, f, d, ps, ss, rt, rd }.
 * Absent strings keep their spec defaults (PS and SS one space, RT ',', RD '.').
 * @returns {Array<object>|null}
 */
export function leesGetalOpmaak(context, raw) {
  const arr = opgezocht(context, raw);
  if (!(arr instanceof PDFArray) || arr.size() === 0) return null;
  const uit = [];
  for (const el of arr.asArray()) {
    const d = opgezocht(context, el);
    if (!(d instanceof PDFDict)) return null;
    const c = getal(context, d.get(N('C')));
    if (!(c > 0)) return null;
    const f = opgezocht(context, d.get(N('F')));
    const stap = { u: tekst(context, d.get(N('U'))) ?? '', c, f: f instanceof PDFName ? f.decodeText() : 'D' };
    const noemer = getal(context, d.get(N('D')));
    if (noemer > 0) stap.d = noemer;
    for (const [k, sleutel] of [['ps', 'PS'], ['ss', 'SS'], ['rt', 'RT'], ['rd', 'RD']]) {
      const t = tekst(context, d.get(N(sleutel)));
      if (t !== undefined) stap[k] = t;
    }
    uit.push(stap);
  }
  return uit;
}

// Decimal places of a decimal format. the external editor's /D is one place more than it
// shows (/D 1000 -> two places, /D 100 -> one place) and it cuts the rest
// off: observed on external plan-review files area texts (x.779 shown as x.77).
function extDecimalenVan(stap) {
  return stap.d > 1 ? Math.max(0, Math.min(6, Math.round(Math.log10(stap.d)) - 1)) : 0;
}

function afgekapt(x, dec) {
  const f = 10 ** dec;
  return Math.floor(x * f + 1e-7) / f;
}

function groepeer(geheel, rt) {
  const s = String(geheel);
  return rt ? s.replace(/\B(?=(\d{3})+(?!\d))/g, rt) : s;
}

function ggd(a, b) {
  return b ? ggd(b, a % b) : a;
}

/** One number in the last format of the chain (decimals or a fraction). */
function laatsteGetal(x, stap) {
  const rt = stap.rt ?? ',';
  const rd = stap.rd ?? '.';
  if (stap.f === 'F') {
    const noemer = stap.d > 0 ? Math.round(stap.d) : 1;
    let heel = Math.floor(x + 1e-9);
    let teller = Math.round((x - heel) * noemer);
    if (teller >= noemer) { heel += 1; teller = 0; }
    if (!teller) return groepeer(heel, rt);
    const g = ggd(teller, noemer);
    const breuk = `${teller / g}/${noemer / g}`;
    return heel ? `${groepeer(heel, rt)} ${breuk}` : breuk;
  }
  if (stap.f === 'R') return groepeer(Math.round(x), rt);
  if (stap.f === 'T') return groepeer(Math.trunc(x), rt);
  const dec = extDecimalenVan(stap);
  const [heel, rest] = afgekapt(x, dec).toFixed(dec).split('.');
  // the external editor leaves trailing zeros out (1,234.7 sf, not 1,234.70 sf).
  const r = (rest || '').replace(/0+$/, '');
  return groepeer(heel, rt) + (r ? rd + r : '');
}

/**
 * The text the external editor shows for `waarde` (in the unit before the chain, e.g. the
 * /X unit) with a /NumberFormat chain from leesGetalOpmaak.
 * @param {number} waarde
 * @param {Array<object>} keten
 * @returns {string}
 */
export function formatGetalOpmaak(waarde, keten) {
  if (!Number.isFinite(waarde) || !Array.isArray(keten) || keten.length === 0) return '';
  const teken = waarde < 0 ? '-' : '';
  // Everything in the smallest unit first, rounded to its precision, so a
  // rest that rounds up carries into the larger unit (11 15/16" -> 1'-0").
  const factoren = [];
  let f = 1;
  for (const stap of keten) { f *= stap.c; factoren.push(f); }
  const laatste = keten[keten.length - 1];
  let rest = Math.abs(waarde) * f;
  if (laatste.f === 'F') rest = Math.round(rest * (laatste.d > 0 ? laatste.d : 1)) / (laatste.d > 0 ? laatste.d : 1);
  else if (laatste.f !== 'R' && laatste.f !== 'T') rest = afgekapt(rest, extDecimalenVan(laatste));
  const delen = [];
  for (let i = 0; i < keten.length; i++) {
    const stap = keten[i];
    const ps = stap.ps ?? ' ';
    const ss = stap.ss ?? ' ';
    if (i < keten.length - 1) {
      // In units of this step: what is left in the smallest unit, divided by
      // the factor between this step and the last one.
      const perEenheid = f / factoren[i];
      const heel = Math.floor(rest / perEenheid + 1e-9);
      rest -= heel * perEenheid;
      delen.push(`${groepeer(heel, stap.rt ?? ',')}${ps}${stap.u}${ss}`);
    } else {
      delen.push(`${laatsteGetal(rest, stap)}${ps}${stap.u}${ss}`);
    }
  }
  return teken + delen.join('').trim();
}
