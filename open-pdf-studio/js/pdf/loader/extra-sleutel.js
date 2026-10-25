// De extra annotatiegegevens die pdf-lib uitleest (extractAnnotationColors)
// zijn gesleuteld op de RAUWE /Rect uit het bestand. De lezer levert een
// genormaliseerde /Rect, en soms een iets opgerekte. Deze zoekroutine legt de
// twee bij elkaar.

const sleutel = (r) => `${r[0]},${r[1]},${r[2]},${r[3]}`;

/**
 * De extra gegevens van een annotatie zoals pdf.js haar levert: eerst op
 * objectverwijzing (plugin-annotaties, #467 — daar is de /Rect niet uniek),
 * anders op de /Rect.
 */
export function extraVoorAnnotatie(annotColorMap, annot) {
  if (!annotColorMap || !annot) return undefined;
  // Eén keer per annotatie: de omzetter vraagt het tot tien keer op, en op
  // een pagina zonder eigen sleutels liep elke vraag de hele pagina af.
  let perAnnot = gevonden.get(annotColorMap);
  if (!perAnnot) { perAnnot = new WeakMap(); gevonden.set(annotColorMap, perAnnot); }
  if (perAnnot.has(annot)) return perAnnot.get(annot);
  const extra = (annot.id && annotColorMap.get(`@ref:${annot.id}`)) || zoekExtraKleuren(annotColorMap, annot.rect);
  perAnnot.set(annot, extra);
  return extra;
}
const gevonden = new WeakMap(); // annotColorMap -> WeakMap(annot -> extra)

// De vage match zocht door alle sleutels van de pagina, per annotatie:
// kwadratisch op een pagina met tienduizenden markeringen. Nu een raster van
// 8 pt-cellen op de linkeronderhoek, per kaart één keer opgebouwd.
const CEL = 8;
const rasters = new WeakMap(); // annotColorMap -> { size, cellen }
function rasterVan(annotColorMap) {
  let r = rasters.get(annotColorMap);
  if (r && r.size === annotColorMap.size) return r.cellen;
  const cellen = new Map();
  for (const [k, v] of annotColorMap.entries()) {
    if (k.startsWith('@ref:')) continue;
    const delen = k.split(',').map(Number);
    if (delen.length !== 4 || !delen.every(Number.isFinite)) continue;
    const c = `${Math.floor(delen[0] / CEL)},${Math.floor(delen[1] / CEL)}`;
    if (!cellen.has(c)) cellen.set(c, []);
    cellen.get(c).push([delen, v]);
  }
  rasters.set(annotColorMap, { size: annotColorMap.size, cellen });
  return cellen;
}

export function zoekExtraKleuren(annotColorMap, rect) {
  if (!annotColorMap || !rect || rect.length < 4) return undefined;
  const exact = annotColorMap.get(sleutel(rect));
  if (exact) return exact;

  // Omgekeerde hoeken: tekenpakketten schrijven /Rect ook wel als
  // [rechts onder links boven]. De lezer draait die om, dus zoek ook op de
  // gespiegelde varianten — anders missen zulke annotaties al hun extra
  // gegevens.
  const [x1, y1, x2, y2] = rect;
  for (const gespiegeld of [[x2, y1, x1, y2], [x1, y2, x2, y1], [x2, y2, x1, y1]]) {
    const treffer = annotColorMap.get(sleutel(gespiegeld));
    if (treffer) return treffer;
  }

  // Vage match: de lezer rekt /Rect soms met de lijndikte op (tot enkele
  // punten) bij annotaties zonder appearance.
  // Afstand < 8 betekent dat de linkeronderhoek binnen 8 pt ligt: alleen de
  // cellen rond die hoek kunnen een treffer hebben.
  let beste;
  let besteAfstand = Infinity;
  const cellen = rasterVan(annotColorMap);
  const cx = Math.floor(x1 / CEL), cy = Math.floor(y1 / CEL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const [delen, v] of cellen.get(`${cx + dx},${cy + dy}`) || []) {
      const d = Math.abs(delen[0] - x1) + Math.abs(delen[1] - y1)
        + Math.abs(delen[2] - x2) + Math.abs(delen[3] - y2);
      if (d < besteAfstand && d < 8) {
        besteAfstand = d;
        beste = v;
      }
    }
  }
  return beste;
}
