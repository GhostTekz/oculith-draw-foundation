// Inzet van een rechthoek- of ellipsmarkering binnen haar /Rect.
//
// Een /Square of /Circle met /RD (Rectangle Differences) tekent zijn vorm niet
// op de rand van /Rect maar erbinnen. /Rect min /RD is de buitenkant van wat
// je ziet, de rand meegerekend; het pad zelf ligt nog een halve lijndikte
// verder naar binnen, zodat de streek precies tot /Rect min /RD reikt. Zo
// schrijft the external editor het (gemeten: /RD = w/2 rondom, pad op w van de /Rect-rand),
// en zo leest de PDF-norm /RD voor deze twee subtypes.
//
// Zonder deze inzet tekende OcuDraw de vorm op /Rect zelf: een externe cirkel
// van 4,26 pt met een rand van 1 pt werd bijna twee keer zo groot als in
// the external editor, met veel meer vulling zichtbaar (een geel rondje in plaats van een
// zwart bolletje).
//
// Zonder /RD verandert er niets: OcuDraw schrijft zelf geen /RD en zet het pad
// op /Rect, dus opslaan en heropenen blijft gelijk. Een wolkrand (/BE) heeft
// een eigen /RD-betekenis (de uitstulping) en valt hier buiten.

/**
 * @param {object} o
 * @param {number[]|null|undefined} o.rd     /RD: [links, onder, rechts, boven] in PDF-eenheden
 * @param {number|null|undefined} o.lijndikte  /BS /W (standaard 1)
 * @param {boolean} [o.wolk]                 /BE wolkrand
 * @returns {{links:number, onder:number, rechts:number, boven:number}|null}
 */
export function vormInzet({ rd, lijndikte, wolk = false }) {
  if (wolk || !Array.isArray(rd) || rd.length !== 4) return null;
  if (!rd.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
  const w = typeof lijndikte === 'number' && Number.isFinite(lijndikte) && lijndikte >= 0 ? lijndikte : 1;
  const half = w / 2;
  const [links, onder, rechts, boven] = rd;
  if (links + onder + rechts + boven === 0 && half === 0) return null;
  return { links: links + half, onder: onder + half, rechts: rechts + half, boven: boven + half };
}

/**
 * Pas de inzet toe op een vak in weergaveruimte (y naar beneden).
 * `schaal` = weergave-eenheden per PDF-eenheid. Bij een gedraaide vorm liggen
 * links/rechts niet meer langs x; dan geldt de gemiddelde inzet rondom.
 * Een inzet die niets van de vorm overlaat, wordt niet toegepast.
 *
 * @param {{x:number,y:number,width:number,height:number}} vak
 * @param {ReturnType<typeof vormInzet>} inzet
 * @param {number} schaal
 * @param {boolean} [gedraaid]
 */
export function pasVormInzetToe(vak, inzet, schaal, gedraaid = false) {
  if (!inzet || !(schaal > 0)) return vak;
  let { links, onder, rechts, boven } = inzet;
  if (gedraaid) {
    const m = (links + onder + rechts + boven) / 4;
    links = onder = rechts = boven = m;
  }
  const breedte = vak.width - (links + rechts) * schaal;
  const hoogte = vak.height - (onder + boven) * schaal;
  if (!(breedte > 0) || !(hoogte > 0)) return vak;
  return { x: vak.x + links * schaal, y: vak.y + boven * schaal, width: breedte, height: hoogte };
}
