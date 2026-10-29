// Extract Pages, the pdf-lib part: Document ▸ Extract Pages (page-manager.js)
// and Batch ▸ Split (js/batch/ops.js) copy pages into a new PDF with this.
//
// Copying pages alone loses what the catalog holds for them: the optional
// content groups (the markup layers and the drawing's own layers) are only
// layers while /OCProperties lists them, so other readers showed the
// markups outside any layer. The groups the copied pages use come along,
// with their names, visibility, order and print rules, and the app's own
// layer list (/OPS_AnnotLayers).
// The edition carries its own catalog data for the pages (carryToExtract).
import { PDFDocument, PDFObjectCopier, PDFPage, PDFName, PDFArray, PDFDict, PDFRef, PDFStream } from 'pdf-lib';
import { edition } from '../editions/active.js';
import { unclaimedAddonCatalogKeys, unclaimedLegacyCatalogKeys } from '../editions/pdf-hooks.js';

const N = (s) => PDFName.of(s);
const LAGEN_SLEUTEL = 'OPS_AnnotLayers';

function opgezocht(context, raw) {
  return raw instanceof PDFRef ? context.lookup(raw) : raw;
}

function isOcg(dict) {
  return dict instanceof PDFDict && String(dict.get(N('Type'))) === '/OCG';
}

/** The OCG refs a page uses: its resources, its annotations' /OC (or OCMD). */
function ocgsOpPagina(context, node, uit) {
  const gezien = new Set();
  const loop = (raw, diepte) => {
    if (diepte > 64 || raw === undefined || raw === null) return;
    let v = raw;
    if (raw instanceof PDFRef) {
      if (gezien.has(raw.tag)) return;
      gezien.add(raw.tag);
      v = context.lookup(raw);
      if (isOcg(v)) { uit.add(raw); return; }
    }
    if (v instanceof PDFStream) v = v.dict;
    if (v instanceof PDFDict) {
      for (const [k, w] of v.entries()) {
        // /Parent and /P lead back to the page tree, not to what the page shows.
        const naam = k.asString();
        if (naam === '/Parent' || naam === '/P') continue;
        loop(w, diepte + 1);
      }
    } else if (v instanceof PDFArray) {
      for (const w of v.asArray()) loop(w, diepte + 1);
    }
  };
  loop(node.getInheritableAttribute(N('Resources')), 0);
  loop(node.get(N('Annots')), 0);
}

/**
 * A copy of `array` with only the kept OCGs, mapped to the new document.
 * Nested arrays (/Order groups, /RBGroups) are filtered the same way; one
 * left without an OCG goes. Strings (an /Order group's label) stay.
 */
function gefilterd(srcContext, array, map, destContext) {
  const uit = [];
  let heeftOcg = false;
  for (const e of array.asArray()) {
    if (e instanceof PDFRef) {
      const nieuw = map.get(e);
      if (nieuw) { uit.push(nieuw); heeftOcg = true; }
      continue;
    }
    const genest = opgezocht(srcContext, e);
    if (genest instanceof PDFArray) {
      const kind = gefilterd(srcContext, genest, map, destContext);
      if (kind) { uit.push(kind); heeftOcg = true; }
    } else if (!(genest instanceof PDFDict)) {
      uit.push(e.clone ? e.clone(destContext) : e);
    }
  }
  return heeftOcg ? destContext.obj(uit) : null;
}

/** /OCProperties and /OPS_AnnotLayers for the OCGs the copied pages use. */
function neemLagenMee(srcDoc, destDoc, gebruikt, copier) {
  const src = srcDoc.context;
  const dest = destDoc.context;
  const oc = opgezocht(src, srcDoc.catalog.get(N('OCProperties')));
  if (!(oc instanceof PDFDict) || gebruikt.size === 0) return;
  const ocgs = opgezocht(src, oc.get(N('OCGs')));
  if (!(ocgs instanceof PDFArray)) return;
  // In the order of /OCGs; the copier already copied each with the pages.
  const map = new Map();
  for (const r of ocgs.asArray()) {
    if (r instanceof PDFRef && gebruikt.has(r)) map.set(r, copier.copy(r));
  }
  if (map.size === 0) return;
  const nieuw = dest.obj({ OCGs: [...map.values()] });
  const d = opgezocht(src, oc.get(N('D')));
  const nd = dest.obj({});
  if (d instanceof PDFDict) {
    for (const sleutel of ['Name', 'Creator', 'BaseState', 'Intent', 'ListMode']) {
      const v = opgezocht(src, d.get(N(sleutel)));
      if (v !== undefined && !(v instanceof PDFDict)) nd.set(N(sleutel), v.clone(dest));
    }
    for (const sleutel of ['Order', 'ON', 'OFF', 'Locked', 'RBGroups']) {
      const a = opgezocht(src, d.get(N(sleutel)));
      const f = a instanceof PDFArray ? gefilterd(src, a, map, dest) : null;
      if (f) nd.set(N(sleutel), f);
    }
    const as = opgezocht(src, d.get(N('AS')));
    if (as instanceof PDFArray) {
      const regels = [];
      for (const raw of as.asArray()) {
        const regel = opgezocht(src, raw);
        const regelOcgs = regel instanceof PDFDict ? opgezocht(src, regel.get(N('OCGs'))) : null;
        const f = regelOcgs instanceof PDFArray ? gefilterd(src, regelOcgs, map, dest) : null;
        if (!f) continue;
        const kopie = dest.obj({});
        for (const [k, v] of regel.entries()) {
          if (k.asString() === '/OCGs') continue;
          const w = opgezocht(src, v);
          kopie.set(k, w instanceof PDFDict ? copier.copy(w) : w.clone(dest));
        }
        kopie.set(N('OCGs'), f);
        regels.push(kopie);
      }
      if (regels.length) nd.set(N('AS'), dest.obj(regels));
    }
  }
  if (!nd.get(N('Order'))) nd.set(N('Order'), dest.obj([...map.values()]));
  nieuw.set(N('D'), nd);
  destDoc.catalog.set(N('OCProperties'), nieuw);

  // The app's own layer list: the panel order and the current layer.
  const eigen = opgezocht(src, srcDoc.catalog.get(N(LAGEN_SLEUTEL)));
  const lijst = eigen instanceof PDFDict ? opgezocht(src, eigen.get(N('Layers'))) : null;
  if (lijst instanceof PDFArray) {
    const lagen = lijst.asArray().map((r) => (r instanceof PDFRef ? map.get(r) : null)).filter(Boolean);
    if (lagen.length) {
      const kopie = dest.obj({ Layers: lagen });
      const huidig = opgezocht(src, eigen.get(N('Current')));
      if (huidig !== undefined) kopie.set(N('Current'), huidig.clone(dest));
      destDoc.catalog.set(N(LAGEN_SLEUTEL), kopie);
    }
  }
}

/** A new PDF with `pageNumbers` (1-based, in this order) of `srcDoc`. */
export async function extractPdfLibPages(srcDoc, pageNumbers) {
  // Independent add-ons own these catalog entries. Without the owning add-on,
  // the host cannot know which page references or state must be remapped.
  // Refuse before copying any pages, including when no add-on is installed.
  if (unclaimedAddonCatalogKeys(srcDoc, edition.pdf?.catalogKeys).length) {
    throw new Error('Cannot extract pages with add-on PDF data until its catalog can be remapped.');
  }
  if (unclaimedLegacyCatalogKeys(srcDoc, edition.pdf?.catalogKeys).length) {
    throw new Error('Cannot extract pages with unclaimed legacy PDF data until its catalog can be remapped.');
  }
  const extractDoc = await PDFDocument.create();
  await srcDoc.flush();
  const src = srcDoc.context;
  const dest = extractDoc.context;
  const copier = PDFObjectCopier.for(src, dest);
  const srcPages = srcDoc.getPages();
  const gekozen = pageNumbers.map((p) => srcPages[p - 1]);
  // A markup's /P names its page: point it at the copy, else the copier
  // pulls the whole page tree of the source along.
  const nieuweRefs = gekozen.map((page) => {
    const ref = dest.nextRef();
    if (!copier.traversedObjects.has(page.ref)) copier.traversedObjects.set(page.ref, ref);
    return ref;
  });
  const gebruikt = new Set();
  gekozen.forEach((page, i) => {
    ocgsOpPagina(src, page.node, gebruikt);
    const node = copier.copy(page.node);
    const ref = copier.traversedObjects.get(page.ref) === nieuweRefs[i] ? nieuweRefs[i] : dest.register(node);
    if (ref === nieuweRefs[i]) dest.assign(ref, node);
    extractDoc.addPage(PDFPage.of(node, ref, extractDoc));
  });
  neemLagenMee(srcDoc, extractDoc, gebruikt, copier);
  edition.pdf?.carryToExtract?.(srcDoc, extractDoc, pageNumbers);
  return extractDoc;
}
