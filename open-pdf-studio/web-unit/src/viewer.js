// De kijker van de web-unit: een document openen, een pagina tekenen, zoomen.
//
// PDF.js levert de structuur en tekent de pagina in deze browser-unit.
// De studio tekent met PDFium.

// PDF.js komt pas bij het EERSTE document binnen, niet bij het laden van het
// unit-script. Dat scheelt de gastheer een paar honderd kB op een pagina waar
// nog geen tekening staat.
let _pdfjs = null;
async function pdfjs() {
  if (!_pdfjs) {
    _pdfjs = await import('pdfjs-dist');
    _pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs', import.meta.url,
    ).href;
  }
  return _pdfjs;
}

/** Zoomstand ('fit' | 'fit-width' | factor) omzetten naar een schaalgetal. */
export function schaalVoorZoom(zoom, paginaPt, vak) {
  const { breedte: pb, hoogte: ph } = paginaPt;
  if (!(pb > 0) || !(ph > 0)) return 1;
  if (zoom === 'fit') return Math.min(vak.breedte / pb, vak.hoogte / ph);
  if (zoom === 'fit-width') return vak.breedte / pb;
  const f = Number(zoom);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

export function maakViewer({ canvas, motor = 'pdfjs' }) {
  const ctx = canvas.getContext('2d');
  let pdfDoc = null;
  let bronBytes = null;
  let huidigeSchaal = 1;
  let paginaPt = { breedte: 0, hoogte: 0 };

  async function laad(bytes) {
    bronBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // PDF.js neemt de buffer over; geef hem een eigen kopie zodat `bronBytes`
    // bruikbaar blijft voor het opslaan.
    const lib = await pdfjs();
    pdfDoc = await lib.getDocument({ data: bronBytes.slice() }).promise;
    const p = await pdfDoc.getPage(1);
    const v = p.getViewport({ scale: 1 });
    paginaPt = { breedte: v.width, hoogte: v.height };
    return { paginas: pdfDoc.numPages, breedtePt: v.width, hoogtePt: v.height };
  }

  async function tekenPdfjs(nummer, schaal) {
    const p = await pdfDoc.getPage(nummer);
    const vp = p.getViewport({ scale: schaal });
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    await p.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  }

  /**
   * Eén pagina tekenen.
   * @param {number} nummer 1-gebaseerd
   * @param {'fit'|'fit-width'|number} zoom
   * @param {{breedte:number,hoogte:number}} vak beschikbare ruimte in px
   */
  async function teken(nummer, zoom, vak) {
    if (!pdfDoc) throw new Error('geen document geladen');
    const p = await pdfDoc.getPage(nummer);
    const v = p.getViewport({ scale: 1 });
    paginaPt = { breedte: v.width, hoogte: v.height };
    huidigeSchaal = schaalVoorZoom(zoom, paginaPt, vak);
    await tekenPdfjs(nummer, huidigeSchaal);
    return huidigeSchaal;
  }

  function vrijgeven() {
    try { pdfDoc?.destroy(); } catch { /* het document was al weg */ }
    pdfDoc = null;
  }

  return {
    laad,
    teken,
    vrijgeven,
    zetMotor(m) { if (m === 'pdfjs' || m === 'pdfium') motor = m; },
    get schaal() { return huidigeSchaal; },
    get paginaPt() { return paginaPt; },
    get paginas() { return pdfDoc ? pdfDoc.numPages : 0; },
    get bytes() { return bronBytes; },
    get motor() { return motor; },
  };
}
