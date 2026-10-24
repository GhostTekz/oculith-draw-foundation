// Export naar DXF/DWG (#400): verbindt het exportvenster met de Tauri-
// commando's van de crate open-pdf-cad. De rekenregels staan in
// cad-export-logica.js (unit-getest), het venster in CadExportDialog.jsx.

import { invoke, saveFileDialog } from '../core/platform.js';
import { getActiveDocument } from '../core/state.js';
import { getMeasureScale } from '../annotations/measurement.js';
import { pixelsPerUnitFor } from '../annotations/scale-region.js';
import { nativeOcgSelectionForDocument } from './native-ocg-selection.js';
import { beginCadOperation } from './cad-ocg-coordination.js';
import {
  schaalnoemerUitMeetschaal, schaalTekst, weergaveMaat, extensieVoor, basisnaam,
} from './cad-export-logica.js';

let volgnummer = 0;
const activeJobs = new Map();

function trackCadJob(jobId) {
  activeJobs.set(jobId, (activeJobs.get(jobId) || 0) + 1);
  return () => {
    const remaining = activeJobs.get(jobId) - 1;
    if (remaining) activeJobs.set(jobId, remaining);
    else activeJobs.delete(jobId);
  };
}

export const CAD_OCG_SELECTION_ERROR = 'CAD export cannot use the current native PDF layer selection yet. Restore the PDF default layer visibility and try again.';

export function cadOcgSelectionError(doc) {
  return nativeOcgSelectionForDocument(doc).ocgVisibility.length ? CAD_OCG_SELECTION_ERROR : '';
}

function assertCadExportSource(doc, args) {
  if (!doc?.pdfDoc || getActiveDocument() !== doc || doc.filePath !== args.pdfPath) {
    throw new Error('The document changed during CAD export. Start again.');
  }
  const error = cadOcgSelectionError(doc);
  if (error) throw new Error(error);
}

/** Uniek kenmerk voor een telronde of export (om af te breken). */
export function nieuwJobId(soort) {
  volgnummer += 1;
  return `${soort}-${Date.now()}-${volgnummer}`;
}

/**
 * Weergegeven maat van een pagina in punten (/Rotate toegepast).
 * @returns {Promise<{breedte:number, hoogte:number, rotatie:number}>}
 */
export async function paginaMaat(doc, paginaNr) {
  const pagina = await doc.pdfDoc.getPage(paginaNr);
  const [x0, y0, x1, y1] = pagina.view;
  const rotatie = pagina.rotate || 0;
  return { ...weergaveMaat(x1 - x0, y1 - y0, rotatie), rotatie };
}

/**
 * Gebieden op een pagina die de gebruiker kan exporteren: schaalgebieden,
 * viewport-annotaties van de app en viewports uit de PDF zelf (/VP). Rechthoek
 * in app-ruimte; `schaal` is de schaalnoemer van het gebied (of null).
 */
export function gebiedenOpPagina(doc, paginaNr) {
  const uit = [];
  for (const a of doc?.annotations || []) {
    if (a.page !== paginaNr) continue;
    if (a.type === 'scaleRegion') {
      const ppu = pixelsPerUnitFor(a.scaleString, a.units);
      uit.push({
        id: `region:${a.id}`,
        soort: 'region',
        naam: a.label || '',
        rect: { x: a.x, y: a.y, width: a.width, height: a.height },
        schaal: schaalnoemerUitMeetschaal({ pixelsPerUnit: ppu, unit: a.units }),
      });
    } else if (a.type === 'viewport' && a.width && a.height) {
      uit.push({
        id: `viewport:${a.id}`,
        soort: 'viewport',
        naam: a.name || '',
        rect: { x: a.x, y: a.y, width: a.width, height: a.height },
        schaal: schaalnoemerUitMeetschaal({ pixelsPerUnit: a.pixelsPerUnit, unit: a.unit }),
      });
    }
  }
  (doc?.pdfViewports?.[paginaNr] || []).forEach((v, i) => {
    uit.push({
      id: `pdf:${i}`,
      soort: 'pdf',
      naam: v.name || v.ratio || '',
      rect: { x: v.x, y: v.y, width: v.width, height: v.height },
      schaal: schaalnoemerUitMeetschaal({ pixelsPerUnit: v.pixelsPerUnit, unit: v.unit }),
    });
  });
  return uit;
}

/**
 * Meetschaal van de app op een plek van de pagina, als schaalnoemer; het
 * midden van `rect` (app-ruimte), of van de pagina als er geen rechthoek is.
 * null als er geen meetschaal is ingesteld.
 */
export function meetschaalOp(paginaNr, rect, maat) {
  const cx = rect ? rect.x + rect.width / 2 : (maat?.breedte || 0) / 2;
  const cy = rect ? rect.y + rect.height / 2 : (maat?.hoogte || 0) / 2;
  return schaalnoemerUitMeetschaal(getMeasureScale(paginaNr, cx, cy));
}

export { schaalTekst };

/** Telt per laag wat de export van één pagina zou maken. */
export async function scanPagina(jobId, args, doc = getActiveDocument()) {
  assertCadExportSource(doc, args);
  const finish = beginCadOperation(doc, () => annuleer(jobId));
  const finishJob = trackCadJob(jobId);
  try {
    return await invoke('scan_page_for_cad', { jobId, args });
  } finally {
    finishJob();
    finish();
  }
}

/** Exporteert één pagina; geeft het exportverslag terug. */
export async function exporteerPagina(jobId, args, doc = getActiveDocument()) {
  assertCadExportSource(doc, args);
  const finish = beginCadOperation(doc, () => annuleer(jobId));
  const finishJob = trackCadJob(jobId);
  try {
    return await invoke('export_page_to_cad', { jobId, args });
  } finally {
    finishJob();
    finish();
  }
}

/** Breekt een lopende telronde of export af. */
export function annuleer(jobId) {
  // Dialog cleanup and rescans retain completed IDs. Sending those to Rust
  // would create pre-start cancellation tombstones for jobs already finished.
  if (!jobId || !activeJobs.has(jobId)) return Promise.resolve(false);
  return invoke('cancel_cad_export', { jobId }).catch(() => false);
}

/**
 * Luistert naar de voortgang van exports. Geeft een functie terug die het
 * luisteren weer stopt.
 * @param {(p: {jobId:string, phase:string, done:number, total:number}) => void} cb
 */
export async function luisterVoortgang(cb) {
  const ev = window.__TAURI__?.event;
  if (!ev?.listen) return () => {};
  const stop = await ev.listen('cad-export-progress', (e) => cb(e.payload));
  return () => { try { stop(); } catch { /* al gestopt */ } };
}

/** Bestandskeuze voor het doelbestand, met een voorstel naast de PDF. */
export async function kiesDoelbestand(doc, formaat, huidig) {
  const ext = extensieVoor(formaat);
  let voorstel = huidig;
  if (!voorstel) {
    const map = doc?.filePath && !doc?.isUntitled ? doc.filePath.replace(/[^\\/]*$/, '') : '';
    voorstel = `${map}${basisnaam(doc?.fileName || doc?.filePath)}.${ext}`;
  } else {
    voorstel = voorstel.replace(/\.(dxf|dwg)$/i, `.${ext}`);
  }
  return saveFileDialog(voorstel, [{ name: ext.toUpperCase(), extensions: [ext] }]);
}
