// Opruimen na het herschrijven van annotaties.
//
// De saver haalt elke markering die hij beheert uit /Annots en schrijft hem uit
// het model opnieuw, met een nieuwe appearance. pdf-lib schrijft bij save()
// ELK object uit de context, ook als niets er nog naar wijst; zonder opruimen
// bleven de oude dicts, hun appearances, antwoorden en de oude /Annots-array
// staan en groeide het bestand bij elke save (ook zonder wijziging).
//
// Alleen objecten die vanaf de vervangen annotaties (of als nieuw object van
// deze save) bereikbaar zijn komen in aanmerking, en daarvan alleen wat vanaf
// de trailer NIET meer bereikbaar is. Wat nog ergens anders gebruikt wordt
// (gedeelde XObjects, fonts, pagina-inhoud, formuliervelden, links, een popup
// van een ander programma die naar de oude notitie wijst) blijft dus staan.
// Oud afval in een bestand van een ander programma laten we ook ongemoeid.

import { PDFRef, PDFDict, PDFArray, PDFStream } from 'pdf-lib';

/**
 * Alle indirecte objecten die vanaf `starts` bereikbaar zijn.
 * @param {import('pdf-lib').PDFContext} context
 * @param {Array} starts
 * @returns {Map<string, PDFRef>} tag -> ref
 */
export function bereikbaar(context, starts) {
  const gezien = new Map();
  const stapel = [...starts];
  while (stapel.length) {
    let o = stapel.pop();
    if (o instanceof PDFRef) {
      if (gezien.has(o.tag)) continue;
      gezien.set(o.tag, o);
      o = context.lookup(o);
      if (!o) continue;
    }
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stapel.push(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) stapel.push(v);
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stapel.push(v);
  }
  return gezien;
}

/**
 * Verwijdert wat vanaf `kandidaten` (en de objecten boven `nieuwVanaf`)
 * bereikbaar is maar vanaf de trailer niet meer. Aanroepen vlak voor
 * doc.save(), NA `await doc.flush()`.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {Array} kandidaten  refs die deze save uit het document haalde
 * @param {{nieuwVanaf?: number}} [opties]  objectnummers boven deze grens zijn
 *   in deze save aangemaakt
 * @returns {number} aantal verwijderde objecten
 */
export function ruimOnbereikbaarOp(doc, kandidaten = [], { nieuwVanaf } = {}) {
  const context = doc.context;
  const starts = [...kandidaten];
  if (Number.isFinite(nieuwVanaf)) {
    for (const [ref] of context.enumerateIndirectObjects()) {
      if (ref.objectNumber > nieuwVanaf) starts.push(ref);
    }
  }
  if (!starts.length) return 0;
  const t = context.trailerInfo;
  const levend = bereikbaar(context, [t.Root, t.Info, t.Encrypt, t.ID].filter(Boolean));
  let verwijderd = 0;
  for (const [tag, ref] of bereikbaar(context, starts)) {
    if (levend.has(tag)) continue;
    if (context.delete(ref)) verwijderd++;
  }
  return verwijderd;
}
