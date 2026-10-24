// Ingelezen externe markeringen uit hun eigen /AP (ap-render-state.js): welke
// markeringen de pagina-render tekent, welke pdf.js overslaat, en dat een
// bewerking, verbergen of verwijderen de markering terug geeft aan OcuDraw.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.ts');
const { vingerafdruk } = await import('./ext-interop.js');
const ap = await import('./ap-render-state.js');

function maakDoc() {
  const transport = new (class Transport {})();
  const modellen = [
    { id: 'a', type: 'circle', page: 1, x: 1, y: 2, width: 3, height: 3 },
    { id: 'b', type: 'textbox', page: 1, x: 5, y: 5, width: 9, height: 4, text: 'EAST' },
    { id: 'c', type: 'line', page: 2, x1: 0, y1: 0, x2: 9, y2: 9 },
    { id: 'eigen', type: 'box', page: 1, x: 0, y: 0, width: 1, height: 1 },
  ];
  const doc = {
    annotations: modellen,
    viewMode: 'single',
    currentPage: 1,
    _annotationPagesReady: new Set([1, 2]),
    // Een klasse-instantie, zoals PDFDocumentProxy: de store wikkelt hem niet in.
    pdfDoc: Object.assign(new (class PdfDoc {})(), { _transport: transport, annotationStorage: new (class Opslag {})() }),
    _extBron: new Map(),
  };
  const bron = (m, ref, eigenAp = true) => doc._extBron.set(m.id, { ref, nm: m.id, subtype: '/X', eigenAp, sig: vingerafdruk(m) });
  bron(modellen[0], '10 0 R');
  bron(modellen[1], '11 0 R');
  bron(modellen[2], '12 0 R');
  bron(modellen[3], '13 0 R', false); // door OcuDraw herschreven: geen eigen /AP
  return { doc, transport, modellen };
}

function pagina(transport, nummer, ids) {
  return { _transport: transport, pageNumber: nummer, getAnnotations: async () => ids.map((id) => ({ id })) };
}

test('pdf.js-id uit een bronverwijzing', () => {
  assert.equal(ap.pdfjsIdUitRef('12 0 R'), '12R');
  assert.equal(ap.pdfjsIdUitRef('12 3 R'), '12R3');
  assert.equal(ap.pdfjsIdUitRef('rommel'), null);
});

test('alleen onbewerkte, zichtbare externe markeringen met eigen /AP gaan naar de pagina-render', async () => {
  const { doc, transport, modellen } = maakDoc();
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  state.preferences.originalMarkupAppearance = true;
  const d = state.documents[0];
  const g = ap.gedelegeerd(d);
  assert.deepEqual([...g.keys()].sort(), ['a', 'b', 'c']);

  const p1 = pagina(transport, 1, ['10R', '11R', '13R', '99R']); // 99R: link of formulierveld
  const opties = await ap.apRenderOpties(p1);
  assert.equal(opties.annotationMode, 1);
  // pdf.js slaat alles over behalve 10R en 11R (12R ligt op een andere pagina
  // die nog niet getekend is).
  const over = d.pdfDoc.annotationStorage.modifiedIds;
  assert.deepEqual([...over.ids].sort(), ['13R', '99R']);
  assert.ok(over.hash);
  ap.apRenderKlaar(p1, true);
  assert.deepEqual([...ap.apInBitmap(d, 1)].sort(), ['a', 'b']);

  // Bewerkt (de geselecteerde markering, zoals bij slepen): OcuDraw tekent
  // hem meteen weer zelf en pdf.js slaat hem over.
  d.selectedAnnotation = modellen[0];
  modellen[0].x += 10;
  await new Promise((r) => setTimeout(r, 40)); // cache van één tik
  assert.deepEqual([...ap.apInBitmap(d, 1)], ['b']);
  assert.ok(d.pdfDoc.annotationStorage.modifiedIds.ids.has('10R'));
  assert.notEqual(d.pdfDoc.annotationStorage.modifiedIds.hash, over.hash);

  // Verwijderd: idem.
  d.annotations = d.annotations.filter((m) => m.id !== 'b');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ap.apInBitmap(d, 1).size, 0);
  assert.ok(d.pdfDoc.annotationStorage.modifiedIds.ids.has('11R'));
});

test('een render die niet doorgaat verandert niets aan wat de bitmap tekent', async () => {
  const { doc, transport } = maakDoc();
  state.documents = [doc];
  const d = state.documents[0];
  const p1 = pagina(transport, 1, ['10R', '11R']);
  await ap.apRenderOpties(p1);
  ap.apRenderKlaar(p1, false);
  assert.equal(ap.apInBitmap(d, 1).size, 0);
});

test('voorkeur uit: geen /AP-render, alles door OcuDraw', async () => {
  const { doc, transport } = maakDoc();
  state.documents = [doc];
  state.preferences.originalMarkupAppearance = false;
  try {
    const d = state.documents[0];
    const p1 = pagina(transport, 1, ['10R', '11R']);
    assert.deepEqual(await ap.apRenderOpties(p1), {});
    ap.apRenderKlaar(p1, true);
    assert.equal(ap.apInBitmap(d, 1).size, 0);
    assert.equal(ap.apRenderKeyPart(d), '');
  } finally {
    state.preferences.originalMarkupAppearance = true;
  }
});

test('PDFium-weergave: /NM-lijst per pagina, miniaturen zonder, bewerkt valt eruit', async () => {
  const { doc, modellen } = maakDoc();
  doc.filePath = '/tmp/ext.pdf';
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  const d = state.documents[0];
  assert.deepEqual(ap.nativeAnnotArgs('/tmp/ext.pdf', 0), { annotAppearance: ['a', 'b'] });
  assert.deepEqual([...ap.apInBitmap(d, 1)].sort(), ['a', 'b']);
  assert.deepEqual(ap.nativeAnnotArgs('/tmp/ext.pdf', 1), { annotAppearance: ['c'] });
  assert.equal(ap.nativeAnnotArgs('/tmp/onbekend.pdf', 0), null);

  // engine-router: weergave krijgt de lijst, een miniatuur (annotAppearance: null) niet.
  const calls = [];
  window.__TAURI__ = { core: { invoke: async (command, args) => { calls.push({ command, args }); return new Uint8Array([1]); } } };
  try {
    const { renderPdfPage } = await import('./engine-router.js');
    await renderPdfPage({ path: '/tmp/ext.pdf', pageIndex: 0, scale: 1 });
    await renderPdfPage({ path: '/tmp/ext.pdf', pageIndex: 0, scale: 0.1, annotAppearance: null });
    assert.deepEqual(calls[0].args.annotAppearance, ['a', 'b']);
    assert.equal('annotAppearance' in calls[1].args, false);
  } finally {
    delete window.__TAURI__;
  }

  // Bewerkt via de ongedaan-maken-geschiedenis: niet meer in de lijst.
  modellen[1].text = 'WEST';
  d.undoStack = [...(d.undoStack || []), { type: 'modify', id: 'b' }];
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(ap.nativeAnnotArgs('/tmp/ext.pdf', 0), { annotAppearance: ['a'] });
});

test('zonder of met dubbele /NM: PDF.js op object, PDFium op /Annots-plek zolang het bestand dezelfde versie is', async () => {
  const { beginSourceWrite } = await import('./source-render-revision.js');
  const { doc, transport } = maakDoc();
  doc.filePath = '/tmp/zonder-nm.pdf';
  doc._pdfLibBronRevisie = 0;
  doc._extBron.get('a').nm = '';          // geen /NM
  doc._extBron.get('a').annotsIndex = 4;
  doc._extBron.get('b').nm = 'tweeling';  // dubbel
  doc._extBron.get('b').annotsIndex = 7;
  doc._extBron.get('c').nm = 'tweeling';
  doc._extBron.get('c').annotsIndex = 9;
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  const d = state.documents[0];
  // PDF.js: alle drie, op object.
  assert.deepEqual([...ap.gedelegeerd(d).keys()].sort(), ['a', 'b', 'c']);
  const { renderParams, ids } = await ap.apRenderParams(pagina(transport, 1, ['10R', '11R', '13R']));
  assert.equal(renderParams.annotationMode, 1);
  assert.deepEqual([...ids].sort(), ['10R', '11R']);
  // PDFium: op plek in /Annots.
  assert.deepEqual(ap.nativeAnnotArgs('/tmp/zonder-nm.pdf', 0), { annotAppearance: [], annotAppearanceIndex: [4, 7] });
  assert.deepEqual([...ap.apInBitmap(d, 1)].sort(), ['a', 'b']);

  // Na opslaan kan de rij anders liggen: plekken tellen niet meer, OcuDraw
  // tekent die markeringen weer zelf (en de bitmap moet opnieuw).
  const klaar = beginSourceWrite('/tmp/zonder-nm.pdf');
  klaar();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ap.nativeAnnotArgs('/tmp/zonder-nm.pdf', 0), null);
  assert.equal(ap.apInBitmap(d, 1).size, 0);
  // PDF.js houdt het geladen document en blijft op object delegeren.
  assert.deepEqual([...ap.gedelegeerd(d).keys()].sort(), ['a', 'b', 'c']);
});

test('apOverslaan (MultiView): eigen bitmap, zonder gedeelde staat', () => {
  const { doc, modellen } = maakDoc();
  state.documents = [doc];
  const d = state.documents[0];
  let r = ap.apOverslaan(d, 1, new Set(['10R', '11R']));
  assert.deepEqual([...r.overslaan].sort(), ['a', 'b']);
  assert.equal(r.klopt, true);
  // Een bitmap van vóór het laden van de markeringen: opnieuw tekenen.
  r = ap.apOverslaan(d, 1, new Set());
  assert.equal(r.overslaan.size, 0);
  assert.equal(r.klopt, false);
  modellen[0].hidden = true;
  return new Promise((res) => setTimeout(res, 40)).then(() => {
    r = ap.apOverslaan(d, 1, new Set(['10R', '11R']));
    assert.deepEqual([...r.overslaan], ['b']);
    assert.equal(r.klopt, false);
  });
});

test('een bewerking buiten selectie en geschiedenis valt binnen een seconde op, niet tijdens slepen', async () => {
  const { doc, modellen } = maakDoc();
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  const d = state.documents[0];
  assert.ok(ap.gedelegeerd(d).has('a'));
  modellen[0].x += 10; // niet geselecteerd, niet vastgelegd
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(ap.gedelegeerd(d).has('a'), 'binnen het vangnet: nog uit het geheugen');
  state.isDragging = true;
  try {
    await new Promise((r) => setTimeout(r, 1100));
    assert.ok(ap.gedelegeerd(d).has('a'), 'tijdens een gebaar geen volledige controle');
  } finally {
    state.isDragging = false;
  }
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ap.gedelegeerd(d).has('a'), false, 'na het gebaar valt de bewerking op');
});
