// Scherpe uitsnede boven de PDF.js-pagina (webversie, enkelpagina).
//
// PDF.js tekent de hele pagina als één bitmap, met een plafond op de langste
// zijde (pdfjs-canvas-render.js). Daarboven rekt CSS die bitmap op: bij 400 %
// op een A0/ARCH E-blad is één bitmappixel 2-4 schermpixels en worden
// haarlijnen grijze vegen. an external publisher tekent zo'n blad op elk zoomniveau scherp.
//
// Deze laag tekent alleen het zichtbare deel (plus een rand) op volle
// schermresolutie, in een eigen canvas boven #pdf-canvas — hetzelfde idee als
// PDFPageDetailView in de PDF.js-viewer. Twee dingen maken het snel:
//  - een CPU-canvas (createRasterCanvas), zoals de basisbitmap;
//  - PDF.js' operationsFilter: een eigen index met de omhullende van elk
//    tekenpad (padIndex, één doorloop over de operatorlijst) laat PDF.js alle
//    paden buiten de uitsnede overslaan. Op een blad met 1,8 M lijnstukken:
//    ~40 ms in plaats van 2 s per uitsnede. PDF.js' eigen opname
//    (recordOperations) kost op zo'n blad 6-19 s extra; deze index een fractie.
//
// De rekenregels hieronder zijn puur (node-tests); PdfJsDetailLayer koppelt
// ze aan de DOM.

import { createRasterCanvas } from './pdfjs-canvas-render.js';
import { pageCanvasContext } from './page-canvas-context.js';

/**
 * Plafond (langste zijde, px) van de basisbitmap onder de detaillaag. De
 * basis is alleen nog de achtergrond tijdens pannen en zoomen; 4096 houdt hem
 * snel en klein (2-3 s op een blad met 1,8 M lijnstukken).
 */
export const PDFJS_DETAIL_BASE_MAX_AXIS_PX = 4096;
/** Grootste uitsnede in schermpixels (breedte x hoogte). */
export const DETAIL_MAX_PIXELS = 4096 * 4096;
/** Rand rond het zichtbare deel, als fractie van de zichtbare maat per kant. */
export const DETAIL_OVERFLOW = 0.5;

/** Is een scherpe uitsnede nodig? Alleen als de basisbitmap onder de dpr zit. */
export function detailNodig(baseRatio, dpr) {
  return baseRatio > 0 && baseRatio < (dpr > 0 ? dpr : 1) * 0.999;
}

/**
 * Het zichtbare deel van de pagina in pagina-CSS-px (0,0 = linksboven van de
 * pagina), of null als de pagina niet in beeld is.
 */
export function zichtbaarDeel(paginaRect, containerRect) {
  const minX = Math.max(0, containerRect.left - paginaRect.left);
  const minY = Math.max(0, containerRect.top - paginaRect.top);
  const maxX = Math.min(paginaRect.width, containerRect.right - paginaRect.left);
  const maxY = Math.min(paginaRect.height, containerRect.bottom - paginaRect.top);
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * De uitsnede die getekend wordt: het zichtbare deel plus een rand, binnen de
 * pagina en binnen DETAIL_MAX_PIXELS. Gehele CSS-px, zodat het canvas precies
 * op het pixelraster valt.
 */
export function planUitsnede(zichtbaar, pagina, dpr, { maxPixels = DETAIL_MAX_PIXELS, overflow = DETAIL_OVERFLOW } = {}) {
  const r = dpr > 0 ? dpr : 1;
  const w = zichtbaar.maxX - zichtbaar.minX;
  const h = zichtbaar.maxY - zichtbaar.minY;
  const zichtbarePixels = w * h * r * r;
  const maxLineair = Math.sqrt(maxPixels / Math.max(1, zichtbarePixels));
  const rand = Math.max(0, Math.min(overflow, (maxLineair - 1) / 2));
  let minX = Math.floor(Math.max(0, zichtbaar.minX - w * rand));
  let minY = Math.floor(Math.max(0, zichtbaar.minY - h * rand));
  let maxX = Math.ceil(Math.min(pagina.width, zichtbaar.maxX + w * rand));
  let maxY = Math.ceil(Math.min(pagina.height, zichtbaar.maxY + h * rand));
  // Een venster groter dan het pixelbudget (heel groot scherm): middelpunt houden.
  const schaal = Math.sqrt(maxPixels / Math.max(1, (maxX - minX) * (maxY - minY) * r * r));
  if (schaal < 1) {
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const hw = ((maxX - minX) * schaal) / 2, hh = ((maxY - minY) * schaal) / 2;
    minX = Math.floor(cx - hw); maxX = Math.ceil(cx + hw);
    minY = Math.floor(cy - hh); maxY = Math.ceil(cy + hh);
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** Heeft #pdf-canvas (CSS) de maat van deze viewport? Anders loopt er een zoom. */
export function basisPastBij(base, viewport) {
  const w = parseFloat(base?.style?.width);
  if (!Number.isFinite(w)) return true;
  return Math.abs(w - Math.floor(viewport.width)) <= 1;
}

/** Dekt de getekende uitsnede het zichtbare deel nog? */
export function dektZichtbaar(uitsnede, zichtbaar) {
  if (!uitsnede || !zichtbaar) return false;
  return zichtbaar.minX >= uitsnede.minX - 0.5 && zichtbaar.minY >= uitsnede.minY - 0.5
    && zichtbaar.maxX <= uitsnede.minX + uitsnede.width + 0.5
    && zichtbaar.maxY <= uitsnede.minY + uitsnede.height + 0.5;
}

/** Maat, draaiing en dpr van een viewport: gelijk = dezelfde uitsnede-geometrie. */
export function viewportSig(viewport, dpr) {
  return `${Math.round(viewport.width * 1000)}x${Math.round(viewport.height * 1000)}|${viewport.rotation || 0}|${dpr}`;
}

// PDF.js-operatorcodes (pdfjs-dist 6, src/shared/util.js OPS). Vast in de
// PDF.js-versie; padIndex controleert ze tegen OPS als die meegegeven wordt.
const OP = {
  setLineWidth: 2, setGState: 9, save: 10, restore: 11, transform: 12,
  clip: 29, eoClip: 30, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  beginGroup: 76, endGroup: 77, beginAnnotation: 80, endAnnotation: 81, constructPath: 91,
  stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25,
  closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28,
};
const VERF = new Set([OP.stroke, OP.closeStroke, OP.fill, OP.eoFill, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke]);
const LIJN = new Set([OP.stroke, OP.closeStroke, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke]);

/** Klopt OP met de OPS van deze PDF.js? Anders geen filter (veilig). */
export function opsKloppen(OPS) {
  if (!OPS) return true;
  return Object.entries(OP).every(([k, v]) => OPS[k] === undefined || OPS[k] === v);
}

/**
 * Omhullende (PDF-gebruikersruimte van de pagina) per tekenpad in een
 * operatorlijst: Float32Array met 4 waarden per opdracht; NaN = altijd
 * uitvoeren. Alleen een pad dat geverfd wordt (stroke/fill) krijgt een
 * omhullende; al het andere (toestand, tekst, beelden, knippaden, groepen,
 * annotatie-uiterlijken) blijft staan, zodat overslaan nooit de toestand of
 * het knippen van wat volgt verandert. Lijndikte telt mee als rand.
 *
 * `vanaf`/`tot` + `staat` maken opdelen in stukken mogelijk (lange lijsten).
 */
export function padIndex(fnArray, argsArray, { vanaf = 0, tot = fnArray.length, staat = null, boxen = null } = {}) {
  const n = fnArray.length;
  const uit = boxen || new Float32Array(n * 4).fill(NaN);
  // Toestand: CTM (a b c d e f), lijndikte, stapel, "binnen groep/annotatie"-
  // diepte, en of de vorige opdracht een knippad aankondigde.
  const st = staat || { m: [1, 0, 0, 1, 0, 0], lw: 1, stapel: [], vrij: 0, knip: false };
  for (let i = vanaf; i < tot; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OP.save: st.stapel.push([st.m.slice(), st.lw]); break;
      case OP.restore: { const t = st.stapel.pop(); if (t) { st.m = t[0]; st.lw = t[1]; } break; }
      case OP.transform: st.m = vermenigvuldig(st.m, args); break;
      case OP.setLineWidth: st.lw = args[0]; break;
      case OP.setGState:
        for (const [k, v] of args[0] || []) if (k === 'LW') st.lw = v;
        break;
      case OP.paintFormXObjectBegin:
        st.stapel.push([st.m.slice(), st.lw]);
        if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) st.m = vermenigvuldig(st.m, args[0]);
        break;
      case OP.paintFormXObjectEnd: { const t = st.stapel.pop(); if (t) { st.m = t[0]; st.lw = t[1]; } break; }
      case OP.beginGroup: case OP.beginAnnotation: st.vrij++; break;
      case OP.endGroup: case OP.endAnnotation: st.vrij = Math.max(0, st.vrij - 1); break;
      case OP.clip: case OP.eoClip: st.knip = true; continue;
      case OP.constructPath: {
        const op = args[0];
        const mm = args[2];
        if (!st.knip && st.vrij === 0 && VERF.has(op) && mm && mm.length >= 4 && Number.isFinite(mm[0])) {
          // minMax = [minX, minY, maxX, maxY] in de ruimte van het pad.
          const rand = LIJN.has(op) ? Math.max(0, st.lw) / 2 : 0;
          zetBox(uit, i, st.m, mm[0] - rand, mm[1] - rand, mm[2] + rand, mm[3] + rand);
        }
        break;
      }
      default: break;
    }
    st.knip = false;
  }
  return { boxen: uit, staat: st };
}

function vermenigvuldig(m, t) {
  const [a, b, c, d, e, f] = t;
  return [
    a * m[0] + b * m[2], a * m[1] + b * m[3],
    c * m[0] + d * m[2], c * m[1] + d * m[3],
    e * m[0] + f * m[2] + m[4], e * m[1] + f * m[3] + m[5],
  ];
}

function zetBox(uit, i, m, x0, y0, x1, y1) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const px = m[0] * x + m[2] * y + m[4];
    const py = m[1] * x + m[3] * y + m[5];
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  // Lijndikte 0 (haarlijn) of afronding: een halve punt speling.
  uit[i * 4] = minX - 0.5; uit[i * 4 + 1] = minY - 0.5; uit[i * 4 + 2] = maxX + 0.5; uit[i * 4 + 3] = maxY + 0.5;
}

/**
 * De uitsnede (pagina-CSS-px van de viewport) als rechthoek in de
 * PDF-gebruikersruimte, via de viewport (draaiing en oorsprong inbegrepen).
 */
export function uitsnedeInPdf(viewport, uitsnede) {
  const hoeken = [
    [uitsnede.minX, uitsnede.minY], [uitsnede.minX + uitsnede.width, uitsnede.minY],
    [uitsnede.minX, uitsnede.minY + uitsnede.height], [uitsnede.minX + uitsnede.width, uitsnede.minY + uitsnede.height],
  ].map(([x, y]) => viewport.convertToPdfPoint(x, y));
  const xs = hoeken.map((p) => p[0]), ys = hoeken.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** operationsFilter voor PDF.js: paden buiten de uitsnede overslaan. */
export function maakOperatieFilter(boxen, rect) {
  if (!boxen || !rect) return null;
  const n = boxen.length / 4;
  return (i) => {
    if (i >= n) return true;
    const x0 = boxen[i * 4];
    if (x0 !== x0) return true; // NaN: altijd
    return x0 <= rect.maxX && boxen[i * 4 + 2] >= rect.minX
      && boxen[i * 4 + 1] <= rect.maxY && boxen[i * 4 + 3] >= rect.minY;
  };
}

// Index per pagina-object, per sleutel (draaiing/lagen/render-parameters).
const _indexen = new WeakMap();

/** De index voor deze pagina en sleutel, of null. */
export function indexVoor(page, sleutel) {
  const o = _indexen.get(page);
  return o && o.sleutel === sleutel ? o.boxen : null;
}

/**
 * Bouw de index uit de operatorlijst van een afgeronde PDF.js-render, in
 * stukken (de hoofdthread blijft vrij). `lijst` = { fnArray, argsArray,
 * lastChunk }.
 */
export async function bouwIndex(page, sleutel, lijst, { stuk = 200000, pauze = () => new Promise((r) => setTimeout(r, 0)), OPS = null } = {}) {
  if (!lijst || !lijst.lastChunk || !opsKloppen(OPS)) return null;
  const bestaand = _indexen.get(page);
  if (bestaand && bestaand.sleutel === sleutel) return bestaand.boxen;
  const { fnArray, argsArray } = lijst;
  let r = { boxen: null, staat: null };
  for (let vanaf = 0; vanaf < fnArray.length; vanaf += stuk) {
    r = padIndex(fnArray, argsArray, { vanaf, tot: Math.min(fnArray.length, vanaf + stuk), staat: r.staat, boxen: r.boxen });
    if (vanaf + stuk < fnArray.length) await pauze();
  }
  const boxen = r.boxen || new Float32Array(0);
  _indexen.set(page, { sleutel, boxen });
  return boxen;
}

/**
 * De scherpe laag zelf. Eén exemplaar voor #pdf-canvas in de
 * enkelpagina-weergave.
 */
export class PdfJsDetailLayer {
  constructor({ getBaseCanvas, getContainer, now = () => performance.now(), OPS = null, canvasClass = null }) {
    this._OPS = OPS;
    // Doorlopende weergave: één laag per pagina, canvas met een klasse in de
    // paginacontainer in plaats van het ene #pdf-detail-canvas.
    this._canvasClass = canvasClass;
    this._getBaseCanvas = getBaseCanvas;
    this._getContainer = getContainer;
    this._now = now;
    this._canvas = null;
    this._bron = null;      // { page, viewport, dpr, baseRatio, sleutel, ocg, renderParams }
    this._uitsnede = null;  // getekende uitsnede (pagina-CSS-px) + sleutel
    this._taak = null;      // lopende PDF.js RenderTask
    this._gen = 0;
    this._timer = null;
  }

  _zorgVoorCanvas() {
    const base = this._getBaseCanvas();
    if (!base || !base.parentElement) return null;
    if (this._canvas && this._canvas.parentElement === base.parentElement) return this._canvas;
    let c = base.parentElement.querySelector(this._canvasClass ? `:scope > canvas.${this._canvasClass}` : ':scope > #pdf-detail-canvas');
    if (!c) {
      c = document.createElement('canvas');
      pageCanvasContext(c);
      if (this._canvasClass) c.className = this._canvasClass;
      else c.id = 'pdf-detail-canvas';
      c.setAttribute('aria-hidden', 'true');
      c.style.display = 'none';
      base.insertAdjacentElement('afterend', c);
    }
    this._canvas = c;
    return c;
  }

  /** Verberg de laag en stop een lopende render (paginawissel, andere weergave). */
  wis() {
    this._gen++;
    this._bron = null;
    this._uitsnede = null;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    try { this._taak?.cancel(); } catch { /* al klaar */ }
    this._taak = null;
    if (this._canvas) this._canvas.style.display = 'none';
  }

  /** Laag weg én het geheugen van het canvas vrij (pagina uit beeld). */
  vrijgeven() {
    this.wis();
    if (this._canvas) { this._canvas.width = 0; this._canvas.height = 0; }
  }

  /** Is de pagina van deze laag in beeld? */
  inBeeld() {
    const base = this._getBaseCanvas();
    const container = this._getContainer();
    if (!base || !container || !base.isConnected) return false;
    return !!zichtbaarDeel(base.getBoundingClientRect(), container.getBoundingClientRect());
  }

  /** Verberg de laag zonder de bron te vergeten (zoom in uitvoering). */
  verberg() {
    this._uitsnede = null;
    try { this._taak?.cancel(); } catch { /* al klaar */ }
    this._taak = null;
    if (this._canvas) this._canvas.style.display = 'none';
  }

  /**
   * Nieuwe of bijgewerkte pagina (na elke render van de basisbitmap).
   * viewportVoor(schaal) geeft de PDF.js-viewport met dezelfde draaiing.
   */
  zetPagina({ page, viewport, viewportVoor, dpr, baseRatio, sleutel, optionalContentConfigPromise = null, renderParams = null, operatorList = null, rasterizer = null }) {
    const oud = this._bron;
    const zelfde = oud && oud.page === page && oud.sleutel === sleutel
      && viewportSig(oud.viewport, oud.dpr) === viewportSig(viewport, dpr);
    const zelfdeGeometrie = oud && oud.page === page && viewportSig(oud.viewport, oud.dpr) === viewportSig(viewport, dpr);
    this._bron = { page, viewport, viewportVoor, dpr, baseRatio, sleutel, ocg: optionalContentConfigPromise, renderParams, rasterizer };
    // Andere zoom/draaiing: de oude uitsnede staat op de verkeerde plek, weg
    // ermee. Alleen een andere sleutel (lagen, /AP-markeringen): de oude
    // uitsnede blijft staan tot de nieuwe klaar is, zonder te knipperen.
    if (!zelfdeGeometrie) this.verberg();
    else if (!zelfde) { this._uitsnede = null; try { this._taak?.cancel(); } catch { /* al klaar */ } this._taak = null; }
    if (!detailNodig(baseRatio, dpr)) { this.verberg(); return; }
    // De basisrender had dezelfde parameters: zijn operatorlijst geeft de
    // index al, zodat ook de eerste uitsnede gefilterd is.
    if (operatorList && !indexVoor(page, sleutel)) {
      bouwIndex(page, sleutel, operatorList, { OPS: this._OPS })
        .then(() => { if (this._bron?.page === page && this._bron?.sleutel === sleutel && !this._uitsnede?.gefilterd) { this._uitsnede = null; this.werkBij(); } })
        .catch(() => {});
      // Klein moment voor de index (een paar honderd ms op 1,8 M opdrachten)
      // in plaats van seconden ongefilterd tekenen.
      if (operatorList.fnArray?.length > 200000) return;
    }
    this.werkBij();
  }

  /** Na scrollen: even wachten tot het scrollen stilvalt, dan bijwerken. */
  planBijwerken(ms = 90) {
    if (!this._bron) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this.werkBij(); }, ms);
  }

  werkBij() {
    const bron = this._bron;
    if (!bron || !detailNodig(bron.baseRatio, bron.dpr)) return;
    const base = this._getBaseCanvas();
    const container = this._getContainer();
    const canvas = this._zorgVoorCanvas();
    if (!base || !container || !canvas) return;
    // Zoom in uitvoering (CSS opgerekt, nieuwe render onderweg): de uitsnede
    // zou bij de oude schaal horen. Wachten op zetPagina van de nieuwe render.
    if (!basisPastBij(base, bron.viewport)) return;
    const zichtbaar = zichtbaarDeel(base.getBoundingClientRect(), container.getBoundingClientRect());
    if (!zichtbaar) return;
    if (this._uitsnede && this._uitsnede.sleutel === bron.sleutel && this._uitsnede.vpSig === viewportSig(bron.viewport, bron.dpr)
        && dektZichtbaar(this._uitsnede, zichtbaar)) return;
    this._teken(bron, planUitsnede(zichtbaar, bron.viewport, bron.dpr));
  }

  async _teken(bron, uitsnede) {
    const gen = ++this._gen;
    try { this._taak?.cancel(); } catch { /* al klaar */ }
    const dpr = bron.dpr;
    const breedte = Math.max(1, Math.round(uitsnede.width * dpr));
    const hoogte = Math.max(1, Math.round(uitsnede.height * dpr));
    const t0 = this._now();
    // Een andere rasteraar (PDFium als WebAssembly, pdfium-web/) mag eerst;
    // levert die niets, dan tekent PDF.js met het padfilter.
    let doel = null;
    let boxen = null;
    if (bron.rasterizer) {
      doel = await bron.rasterizer.renderUitsnede({ page: bron.page, viewport: bron.viewport, uitsnede, dpr,
        breedte, hoogte, renderParams: bron.renderParams });
      if (gen !== this._gen || this._bron !== bron) return;
    }
    const motor = doel ? (bron.rasterizer.naam || 'extern') : 'pdfjs';
    if (!doel) {
      const raster = createRasterCanvas(breedte, hoogte);
      doel = raster.canvas;
      const ctx = raster.ctx;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, breedte, hoogte);
      boxen = indexVoor(bron.page, bron.sleutel);
      const taak = bron.page.render({
        canvasContext: ctx,
        canvas: doel,
        viewport: bron.viewport,
        transform: [dpr, 0, 0, dpr, -uitsnede.minX * dpr, -uitsnede.minY * dpr],
        annotationMode: 0,
        optionalContentConfigPromise: bron.ocg,
        ...(bron.renderParams || {}),
        operationsFilter: boxen ? maakOperatieFilter(boxen, uitsnedeInPdf(bron.viewport, uitsnede)) : null,
      });
      this._taak = taak;
      try {
        await taak.promise;
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') console.warn('[detail] uitsnede tekenen mislukt:', e);
        return;
      } finally {
        if (this._taak === taak) this._taak = null;
      }
      // De eerste (ongefilterde) uitsnede levert de operatorlijst; daaruit de
      // index voor alle volgende (zelfde render-parameters = zelfde lijst).
      if (!boxen) {
        bouwIndex(bron.page, bron.sleutel, taak._internalRenderTask?.operatorList, { OPS: this._OPS }).catch(() => {});
      }
    }
    if (gen !== this._gen || this._bron !== bron) return;
    const zicht = this._zorgVoorCanvas();
    if (!zicht || !basisPastBij(this._getBaseCanvas(), bron.viewport)) return;
    zicht.width = breedte;
    zicht.height = hoogte;
    zicht.getContext('2d').drawImage(doel, 0, 0);
    const base = this._getBaseCanvas();
    Object.assign(zicht.style, {
      display: 'block',
      left: `${(base?.offsetLeft || 0) + uitsnede.minX}px`,
      top: `${(base?.offsetTop || 0) + uitsnede.minY}px`,
      width: `${uitsnede.width}px`,
      height: `${uitsnede.height}px`,
    });
    this._uitsnede = { ...uitsnede, sleutel: bron.sleutel, vpSig: viewportSig(bron.viewport, dpr), ms: Math.round(this._now() - t0), gefilterd: !!boxen };
    zicht.dataset.renderMs = String(this._uitsnede.ms);
    zicht.dataset.filtered = boxen ? '1' : '0';
    zicht.dataset.engine = motor;
    // Kwam er tijdens het tekenen een scroll bij die buiten de uitsnede valt:
    // meteen nog een ronde.
    this.werkBij();
  }
}
