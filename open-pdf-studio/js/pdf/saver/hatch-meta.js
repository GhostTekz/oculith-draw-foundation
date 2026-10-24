// Arceringsgegevens van een vlak: schrijven naar de annotatie en teruglezen.
//
// De arcering staat als lijnen in de appearance, zodat elke lezer hem toont.
// Om hem in de app te kunnen blijven bewerken moeten de parameters er ook als
// eigen sleutels bij: zonder die sleutels kent het model na heropenen geen
// arcering meer en schrijft de volgende save het vlak zonder arcering weg.

import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';
import { getCustomHatchPattern, isCustomHatchId } from '../../annotations/hatch-registry.js';

/** Zet OPS_HatchPattern/Color/Scale/Angle op de annotatie (niets bij 'none'). */
export function schrijfHatchMeta(annotDict, ann, context) {
  if (!ann?.hatchPattern || ann.hatchPattern === 'none') return false;
  annotDict.set(PDFName.of('OPS_HatchPattern'), pdfTextString(ann.hatchPattern));
  if (ann.hatchColor) annotDict.set(PDFName.of('OPS_HatchColor'), pdfTextString(ann.hatchColor));
  if (ann.hatchScale != null) annotDict.set(PDFName.of('OPS_HatchScale'), context.obj(ann.hatchScale));
  // 0 is the loader's default: not written, so a reopened area saves the same.
  if (ann.hatchAngle) annotDict.set(PDFName.of('OPS_HatchAngle'), context.obj(ann.hatchAngle));
  // Een geïmporteerd .PAT-patroon gaat zelf mee, zodat het bestand ook op een
  // machine zonder die import weer met hetzelfde patroon opent.
  const eigen = isCustomHatchId(ann.hatchPattern) ? getCustomHatchPattern(ann.hatchPattern) : null;
  if (eigen) annotDict.set(PDFName.of('OPS_HatchDef'), pdfTextString(JSON.stringify(eigen)));
  return true;
}

/** De arceringsvelden voor het annotatiemodel, uit de gelezen OPS_-sleutels. */
export function hatchUitExtra(extra, standaardKleur = '#000000') {
  const e = extra || {};
  return {
    hatchPattern: e.opsHatchPattern || 'none',
    hatchColor: e.opsHatchColor || standaardKleur,
    hatchScale: e.opsHatchScale ?? 100,
    hatchAngle: e.opsHatchAngle ?? 0,
  };
}
