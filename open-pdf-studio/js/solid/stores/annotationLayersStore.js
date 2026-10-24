// Store voor de markeringslagen (#468) in het paneel Lagen (links).
//
// De lagen zelf staan op het document (doc.annotationLayers, zie
// annotations/annotatie-lagen.js voor de regels); deze store houdt een
// versieteller bij waarmee het paneel opnieuw rekent na een wijziging. Elke
// actie werkt op het actieve document, hertekent het canvas en haalt
// markeringen die niet meer aanklikbaar zijn (laag uit of op slot) uit de
// selectie.
//
// Er is één paneel Lagen, zoals in the external editor: bovenaan de markeringslagen
// (bewerkbaar), daaronder de lagen van de PDF zelf (alleen-lezen, K-001). Het
// is de tab "layers" van het linkerpaneel; Beeld > Panelen > Markeringslagen
// en "Nieuwe laag…" in het contextmenu openen die tab.
//
// Vanilla JS gebruikt deze store via bridge.ts.

import { createSignal } from 'solid-js';
import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { openDialog } from './dialogStore.js';
import { panelShown, switchToLeftPanelTab } from './leftPanelStore.js';
import {
  DEFAULT_LAYER_ID,
  addLayer, renameLayer, updateLayer, updateAllLayers, moveLayer, deleteLayer,
  getLayers, findLayer, layerDisplayName, nextLayerName,
  annotationsOnLayer, assignLayer, setCurrentLayer, layerIdOf, annotationsInDocument,
} from '../../annotations/annotatie-lagen.js';

/** De tab "layers" van het linkerpaneel. */
export const LAYERS_TAB = 'layers';

const [layersVersion, setLayersVersion] = createSignal(0);
// Een laag die het paneel bij openen meteen laat hernoemen (een nieuwe laag
// vanuit het contextmenu). Het paneel leest en wist dit.
const [renameRequest, setRenameRequest] = createSignal(null);

/** Het paneel opnieuw laten rekenen (lagen, aantallen, huidige laag). */
export function refreshAnnotationLayers() {
  setLayersVersion((v) => v + 1);
}

/** Staat het paneel Lagen open (actief in zijn paneelhost en die host uitgeklapt)? */
export function panelVisible() {
  return panelShown(LAYERS_TAB);
}

/**
 * Het paneel Lagen openen (niet wisselen): voor Beeld > Panelen en het
 * contextmenu. Met `renameId` start het paneel het hernoemen van die laag.
 */
export function showAnnotationLayersPanel({ renameId = null } = {}) {
  switchToLeftPanelTab(LAYERS_TAB);
  if (renameId) setRenameRequest(renameId);
  refreshAnnotationLayers();
  // Ook de PDF-lagen in de onderste sectie bijwerken.
  import('../../ui/panels/layers.js').then((m) => m.updateLayersList()).catch(() => {});
}

/** De weergavenaam van de standaardlaag in de huidige taal. */
export function defaultLayerName() {
  return i18next.t('ribbon:annotationLayers.defaultName');
}

// Herteken de annotatie-overlay (enkel of doorlopend), zoals elementVisibilityStore.
function redraw() {
  import('../../annotations/rendering.js').then((m) => {
    if (getActiveDocument()?.viewMode === 'continuous') m.redrawContinuous();
    else m.redrawAnnotations();
  }).catch(() => { /* renderer nog niet geladen */ });
}

// Een uitgezette of vergrendelde laag is niet aanklikbaar; wat al geselecteerd
// was, gaat eruit — anders kun je het nog verslepen of verwijderen.
async function snoeiSelectie(doc) {
  if (!doc || !Array.isArray(doc.selectedAnnotations) || doc.selectedAnnotations.length === 0) return;
  const { isAnnotationPickableInView } = await import('../../annotations/view-filters.js');
  const over = doc.selectedAnnotations.filter((a) => isAnnotationPickableInView(a));
  if (over.length === doc.selectedAnnotations.length) return;
  doc.selectedAnnotations = over;
  doc.selectedAnnotation = over.length ? over[over.length - 1] : null;
  const panel = await import('../../ui/panels/properties-panel.js');
  if (over.length === 0) panel.hideProperties();
  else if (over.length === 1) panel.showProperties(over[0]);
  else panel.showMultiSelectionProperties();
}

function markeerGewijzigd() {
  import('../../ui/chrome/tabs.js').then((m) => m.markDocumentModified()).catch(() => {});
}

function lijstBijwerken() {
  import('../../ui/panels/annotations-list.js').then((m) => m.updateAnnotationsList()).catch(() => {});
}

async function naWijziging(doc, { gewijzigd = true } = {}) {
  if (gewijzigd) markeerGewijzigd();
  refreshAnnotationLayers();
  redraw();
  await snoeiSelectie(doc);
  redraw();
}

/**
 * Voor vanilla JS (de MCP-brug): na een wijziging aan de lagen van het actieve
 * document het paneel, het canvas en de selectie bijwerken. `modified: false`
 * voor een wijziging die de tekening zelf niet raakt (de huidige laag).
 */
export function annotationLayersChanged({ modified = true } = {}) {
  lijstBijwerken();
  return naWijziging(getActiveDocument(), { gewijzigd: modified });
}

/** Nieuwe laag achteraan, met de eerste vrije naam. Geeft het id terug. */
export function addAnnotationLayer() {
  const doc = getActiveDocument();
  if (!doc) return null;
  const naam = nextLayerName(doc, i18next.t('ribbon:annotationLayers.newName'));
  const r = addLayer(doc, { name: naam });
  if (!r.ok) return null;
  naWijziging(doc);
  return r.layer.id;
}

/** @returns {string|null} een foutcode (name-empty, name-taken, …) of null */
export function renameAnnotationLayer(id, naam) {
  const doc = getActiveDocument();
  if (!doc) return 'not-found';
  const huidig = findLayer(doc, id);
  if (huidig && huidig.name === String(naam ?? '').trim()) return null;
  const r = renameLayer(doc, id, naam);
  if (!r.ok) return r.error;
  naWijziging(doc);
  lijstBijwerken();
  return null;
}

/** Zichtbaar, afdrukbaar of vergrendeld aan- of uitzetten. */
export function setAnnotationLayerFlag(id, sleutel, waarde) {
  if (!['visible', 'printable', 'locked'].includes(sleutel)) return;
  const doc = getActiveDocument();
  if (!doc) return;
  if (!updateLayer(doc, id, { [sleutel]: !!waarde }).ok) return;
  naWijziging(doc);
  // De ogen in de Markups List (groepskop per laag, rij-oog) lezen dezelfde
  // laag: die lijst rekent mee, zodat paneel en lijst gelijk blijven.
  lijstBijwerken();
}

/**
 * Dezelfde schakelaar op alle markeringslagen: Alles tonen / verbergen /
 * vergrendelen / ontgrendelen in de werkbalk van het paneel.
 */
export function setAllAnnotationLayersFlag(sleutel, waarde) {
  if (!['visible', 'printable', 'locked'].includes(sleutel)) return;
  const doc = getActiveDocument();
  if (!doc) return;
  const r = updateAllLayers(doc, { [sleutel]: !!waarde });
  if (r.ok && r.changed > 0) { naWijziging(doc); lijstBijwerken(); }
}

export function setAnnotationLayerColor(id, kleur) {
  const doc = getActiveDocument();
  if (!doc) return;
  if (updateLayer(doc, id, { color: kleur }).ok) naWijziging(doc);
}

/** Een laag één plek omhoog (-1) of omlaag (+1). */
export function moveAnnotationLayerBy(id, stap) {
  const doc = getActiveDocument();
  if (!doc) return;
  const i = getLayers(doc).findIndex((l) => l.id === id);
  if (i < 0) return;
  const naar = i + stap;
  if (naar < 0 || naar >= getLayers(doc).length) return;
  if (moveLayer(doc, id, naar).ok) naWijziging(doc);
}

/**
 * De huidige laag kiezen: daar landen nieuwe markeringen. Bewaard bij de
 * volgende keer opslaan, maar geen wijziging aan de tekening zelf.
 */
export function setCurrentAnnotationLayer(id) {
  const doc = getActiveDocument();
  if (!doc) return;
  if (setCurrentLayer(doc, id).ok) naWijziging(doc, { gewijzigd: false });
}

/**
 * Een laag verwijderen. Een lege laag gaat meteen weg; een laag met
 * markeringen vraagt eerst wat ermee moet gebeuren.
 */
export function requestDeleteAnnotationLayer(id) {
  const doc = getActiveDocument();
  if (!doc || id === DEFAULT_LAYER_ID) return;
  const laag = findLayer(doc, id);
  if (!laag) return;
  const op = annotationsOnLayer(doc, id);
  if (op.length === 0) {
    deleteAnnotationLayer(id, 'move');
    return;
  }
  openDialog('annotation-layer-delete', {
    layerId: id,
    name: layerDisplayName(laag, defaultLayerName()),
    count: op.length,
  });
}

/**
 * Een laag verwijderen en haar markeringen verplaatsen naar `doelId`
 * (keuze 'move') of mee verwijderen (keuze 'delete'). Het verplaatsen of
 * verwijderen van de markeringen is één undo-stap.
 */
export async function deleteAnnotationLayer(id, keuze = 'move', doelId = DEFAULT_LAYER_ID) {
  const doc = getActiveDocument();
  if (!doc || id === DEFAULT_LAYER_ID || !findLayer(doc, id)) return false;
  const doel = doelId !== id && findLayer(doc, doelId) ? doelId : DEFAULT_LAYER_ID;
  const op = annotationsOnLayer(doc, id);
  if (op.length > 0) {
    const undo = await import('../../core/undo-manager.js');
    if (keuze === 'delete') {
      undo.recordBulkDelete(op);
      // Op id, niet op objectidentiteit.
      const weg = new Set(op.map((a) => a.id));
      const isWeg = (a) => !!a && weg.has(a.id);
      // Ter plekke uit de lijst van het document halen (achteraan beginnen):
      // geen nieuwe lijst toewijzen, want het document bewaart daar een kopie
      // van en de verwijzingen hieronder zouden dan naar losse objecten wijzen.
      for (let i = doc.annotations.length - 1; i >= 0; i--) {
        if (isWeg(doc.annotations[i])) doc.annotations.splice(i, 1);
      }
      doc.selectedAnnotations = (doc.selectedAnnotations || []).filter((a) => !isWeg(a));
      if (isWeg(doc.selectedAnnotation)) {
        doc.selectedAnnotation = doc.selectedAnnotations[0] || null;
      }
    } else {
      const { cloneAnnotation } = await import('../../annotations/factory.js');
      const voor = op.map(cloneAnnotation);
      assignLayer(op, doel);
      undo.recordBulkModify(op, voor);
    }
  }
  deleteLayer(doc, id);
  await naWijziging(doc);
  lijstBijwerken();
  return true;
}

/**
 * Markeringen naar een laag verplaatsen, als één undo-stap. Wat op een
 * uitgezette of vergrendelde laag belandt, gaat uit de selectie.
 * @returns {Promise<number>} hoeveel markeringen er verplaatst zijn
 */
export async function moveAnnotationsToAnnotationLayer(anns, id) {
  const doc = getActiveDocument();
  if (!doc || !findLayer(doc, id)) return 0;
  // De annotaties van het document zelf: een selectie of menu kan een ander
  // object vasthouden, en dan zou de nieuwe laag niet in het document landen.
  // A group stays on one layer (the external editor): a member brings its whole group.
  const { expandToGroups } = await import('../../annotations/markup-groups.js');
  const te = expandToGroups(doc.annotations, annotationsInDocument(doc, anns)).filter((a) => layerIdOf(a) !== id);
  if (te.length === 0) return 0;
  const { cloneAnnotation } = await import('../../annotations/factory.js');
  const voor = te.map(cloneAnnotation);
  const n = assignLayer(te, id);
  const nu = new Date().toISOString();
  for (const a of te) a.modifiedAt = nu;
  const undo = await import('../../core/undo-manager.js');
  undo.recordBulkModify(te, voor);
  await naWijziging(doc, { gewijzigd: false });
  lijstBijwerken();
  return n;
}

/**
 * Nieuwe laag en de markeringen er meteen op: "Nieuwe laag…" in het
 * contextmenu. Het verplaatsen is één undo-stap (het aanmaken zelf, net als
 * in het paneel, niet). Daarna opent het paneel met de naam in bewerking.
 * @returns {Promise<string|null>} het id van de nieuwe laag
 */
export async function moveAnnotationsToNewAnnotationLayer(anns) {
  const doc = getActiveDocument();
  const te = annotationsInDocument(doc, (anns || []).filter(Boolean));
  if (!doc || te.length === 0) return null;
  const id = addAnnotationLayer();
  if (!id) return null;
  await moveAnnotationsToAnnotationLayer(te, id);
  showAnnotationLayersPanel({ renameId: id });
  return id;
}

/** De geselecteerde markeringen naar een laag. */
export function moveSelectionToAnnotationLayer(id) {
  const doc = getActiveDocument();
  return moveAnnotationsToAnnotationLayer([...(doc?.selectedAnnotations || [])], id);
}

/**
 * Laag-ids van het anker tot de aangeklikte laag, in de volgorde van de
 * Markups List. Shift-klik op een laagkop. Het anker telt alleen zolang die
 * laag nog helemaal geselecteerd is; anders is de eerste geselecteerde laag
 * het anker. Zonder anker blijft het de aangeklikte laag.
 * @param {{ layerId: string, sectionSelected?: boolean }[]} headers
 * @param {string|null} anchorId
 * @param {string} clickedId
 * @returns {string[]}
 */
export function layerRangeIds(headers, anchorId, clickedId) {
  const rows = (headers || []).filter((h) => h && h.layerId);
  const ids = rows.map((h) => h.layerId);
  if (!clickedId || !ids.includes(clickedId)) return clickedId ? [clickedId] : [];
  const selected = rows.filter((h) => h.sectionSelected).map((h) => h.layerId);
  const anchor = selected.includes(anchorId) ? anchorId : (selected[0] || null);
  if (!anchor) return [clickedId];
  const a = ids.indexOf(anchor);
  const b = ids.indexOf(clickedId);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return ids.slice(lo, hi + 1);
}

/**
 * Markeringen op deze lagen selecteren, in de opgegeven volgorde. Alleen wat
 * aanklikbaar is: een uitgezette of vergrendelde laag levert niets, de
 * andere lagen in het bereik blijven meetellen. Een onbekende laag wijzigt
 * de selectie niet.
 * @param {string[]} ids
 * @returns {Promise<number>}
 */
export async function selectAnnotationsOnLayers(ids) {
  const doc = getActiveDocument();
  const wanted = [];
  for (const id of ids || []) if (id && !wanted.includes(id)) wanted.push(id);
  if (!doc || !wanted.some((id) => findLayer(doc, id))) return 0;
  const { isAnnotationPickableInView } = await import('../../annotations/view-filters.js');
  const op = [];
  const gezien = new Set();
  for (const id of wanted) {
    if (!findLayer(doc, id)) continue;
    for (const a of annotationsOnLayer(doc, id)) {
      if (!a || a.type === '__tool-defaults__' || !isAnnotationPickableInView(a) || gezien.has(a.id)) continue;
      gezien.add(a.id);
      op.push(a);
    }
  }
  doc.selectedAnnotations = op;
  doc.selectedAnnotation = op.length ? op[0] : null;
  try {
    const panel = await import('../../ui/panels/properties-panel.js');
    if (op.length === 0) panel.hideProperties();
    else if (op.length === 1) panel.showProperties(op[0]);
    else panel.showMultiSelectionProperties();
  } catch { /* paneel nog niet geladen */ }
  redraw();
  try {
    const listStore = await import('./panels/annotationsStore.js');
    const list = await import('../../ui/panels/annotations-list.js');
    if (listStore.sortMode() === 'layer') {
      for (const a of op) listStore.expandGroup(list.markupLayerName(doc, a));
    }
    list.updateAnnotationsList();
    queueMicrotask(() => {
      const row = globalThis.document?.querySelector?.('.annotations-list-content .annotation-list-item.selected');
      row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  } catch { /* lijst nog niet geladen */ }
  return op.length;
}

/**
 * Alle markeringen op een laag selecteren. Een klik op de rij in het
 * lagenpaneel doet dit, net als "Alle markeringen op deze laag selecteren".
 * Alleen wat aanklikbaar is: op een uitgezette of vergrendelde laag wordt
 * niets geselecteerd. De Markups List krijgt dezelfde selectie, zodat die
 * rijen als geselecteerd oplichten.
 * @returns {Promise<number>} hoeveel markeringen er geselecteerd zijn
 */
export async function selectAnnotationsOnLayer(id) {
  const doc = getActiveDocument();
  if (!doc || !findLayer(doc, id)) return 0;
  return selectAnnotationsOnLayers([id]);
}

export { layersVersion, renameRequest, setRenameRequest };
