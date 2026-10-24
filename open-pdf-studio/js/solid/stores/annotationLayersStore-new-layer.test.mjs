// "Nieuwe laag…" in het contextmenu en Beeld > Panelen > Markeringslagen: de
// store maakt een laag, zet de markeringen erop in één undo-stap en opent de
// tab Lagen van het linkerpaneel met de nieuwe laag in bewerking.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const { getLayers, layerIdOf, DEFAULT_LAYER_ID } = await import('../../annotations/annotatie-lagen.js');
const store = await import('./annotationLayersStore.js');
const links = await import('./leftPanelStore.js');

// Het paneel Lagen dicht: een andere tab actief.
const sluitPaneel = () => { links.setActiveTab('thumbnails'); links.setCollapsed(false); };

const vak = (id) => ({ id, type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5 });

function openen(annotations) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('nieuwe laag vanuit het contextmenu: laag erbij, markeringen erop, één undo-stap, paneel open met hernoemen', async () => {
  sluitPaneel();
  store.setRenameRequest(null);
  const doc = openen([vak('a'), vak('b'), vak('c')]);
  const lagenVoor = getLayers(doc).length;
  // Een kopie zoals een menu die kan vasthouden: de store zoekt de echte op.
  const id = await store.moveAnnotationsToNewAnnotationLayer([{ ...doc.annotations[0] }, doc.annotations[2]]);
  assert.ok(id, 'een nieuwe laag');
  assert.equal(getLayers(doc).length, lagenVoor + 1);
  assert.equal(layerIdOf(doc.annotations[0]), id);
  assert.equal(layerIdOf(doc.annotations[1]), DEFAULT_LAYER_ID, 'niet aangeklikt: blijft staan');
  assert.equal(layerIdOf(doc.annotations[2]), id);
  assert.equal(doc.undoStack.length, 1, 'het verplaatsen is één undo-stap');
  assert.equal(store.panelVisible(), true, 'het paneel Lagen gaat open');
  assert.equal(links.activeTab(), 'layers', 'de tab Lagen van het linkerpaneel');
  assert.equal(store.renameRequest(), id, 'met de nieuwe laag in bewerking');

  await undo.undo();
  assert.equal(layerIdOf(state.documents[0].annotations[0]), DEFAULT_LAYER_ID);
  assert.equal(layerIdOf(state.documents[0].annotations[2]), DEFAULT_LAYER_ID);
});

test('zonder markeringen maakt het contextmenu geen lege laag', async () => {
  sluitPaneel();
  const doc = openen([vak('a')]);
  const lagenVoor = getLayers(doc).length;
  assert.equal(await store.moveAnnotationsToNewAnnotationLayer([]), null);
  assert.equal(await store.moveAnnotationsToNewAnnotationLayer([vak('elders')]), null, 'niet van dit document');
  assert.equal(getLayers(doc).length, lagenVoor);
  assert.equal(store.panelVisible(), false);
});

test('Beeld > Panelen opent de tab Lagen, ook ingeklapt, en wisselt niet', () => {
  sluitPaneel();
  store.showAnnotationLayersPanel();
  assert.equal(store.panelVisible(), true);
  store.showAnnotationLayersPanel();
  assert.equal(store.panelVisible(), true, 'een tweede klik sluit het niet');
  links.setCollapsed(true);
  assert.equal(store.panelVisible(), false, 'ingeklapt telt als dicht');
  store.showAnnotationLayersPanel();
  assert.equal(links.collapsed(), false, 'openen klapt het linkerpaneel uit');
  assert.equal(store.panelVisible(), true);
});

const vakOp = (id, layer) => ({ ...vak(id), layer });

test('alle lagen tonen, verbergen, vergrendelen en ontgrendelen', async () => {
  const doc = openen([vak('a')]);
  const id = store.addAnnotationLayer();
  store.setAllAnnotationLayersFlag('visible', false);
  assert.ok(getLayers(doc).every((l) => !l.visible), 'alles verborgen');
  store.setAllAnnotationLayersFlag('visible', true);
  store.setAllAnnotationLayersFlag('locked', true);
  assert.ok(getLayers(doc).every((l) => l.visible && l.locked), 'alles zichtbaar en op slot');
  store.setAllAnnotationLayersFlag('locked', false);
  assert.ok(getLayers(doc).every((l) => !l.locked));
  store.setAllAnnotationLayersFlag('name', 'x');
  assert.equal(getLayers(doc).find((l) => l.id === id).name.startsWith('x'), false, 'alleen de schakelaars');
});

test('alle markeringen op een laag selecteren: alleen wat aanklikbaar is', async () => {
  const doc = openen([]);
  const id = store.addAnnotationLayer();
  doc.annotations.push(vakOp('a', id), vak('b'), vakOp('c', id));
  assert.equal(await store.selectAnnotationsOnLayer(id), 2);
  assert.deepEqual(doc.selectedAnnotations.map((a) => a.id), ['a', 'c']);
  assert.equal(await store.selectAnnotationsOnLayer(DEFAULT_LAYER_ID), 1);
  assert.deepEqual(doc.selectedAnnotations.map((a) => a.id), ['b']);
  store.setAnnotationLayerFlag(id, 'locked', true);
  assert.equal(await store.selectAnnotationsOnLayer(id), 0, 'vergrendeld: niets');
  store.setAnnotationLayerFlag(id, 'locked', false);
  store.setAnnotationLayerFlag(id, 'visible', false);
  assert.equal(await store.selectAnnotationsOnLayer(id), 0, 'verborgen: niets');
  assert.equal(doc.selectedAnnotations.length, 0);
  assert.equal(await store.selectAnnotationsOnLayer('onbekend'), 0);
});

test('shift van een geselecteerde laag naar een andere pakt de lagen ertussen', async () => {
  const headers = [
    { layerId: 'a', sectionSelected: true },
    { layerId: 'b', sectionSelected: false },
    { layerId: 'c', sectionSelected: false },
  ];
  assert.deepEqual(store.layerRangeIds(headers, 'a', 'c'), ['a', 'b', 'c']);
  assert.deepEqual(store.layerRangeIds([
    { layerId: 'a', sectionSelected: false },
    { layerId: 'b', sectionSelected: false },
    { layerId: 'c', sectionSelected: true },
  ], 'c', 'a'), ['a', 'b', 'c']);
  assert.deepEqual(store.layerRangeIds(headers, 'a', 'a'), ['a']);
  assert.deepEqual(store.layerRangeIds([
    { layerId: 'a', sectionSelected: true },
    { layerId: 'b', sectionSelected: true },
    { layerId: 'c', sectionSelected: true },
  ], 'a', 'b'), ['a', 'b']);
  const verplaatst = [
    { layerId: 'a', sectionSelected: false },
    { layerId: 'b', sectionSelected: true },
    { layerId: 'c', sectionSelected: false },
  ];
  assert.deepEqual(store.layerRangeIds(verplaatst, 'a', 'c'), ['b', 'c']);
  const geen = headers.map((h) => ({ ...h, sectionSelected: false }));
  assert.deepEqual(store.layerRangeIds(geen, 'a', 'c'), ['c']);

  const doc = openen([]);
  const a = store.addAnnotationLayer();
  const b = store.addAnnotationLayer();
  const c = store.addAnnotationLayer();
  doc.annotations.push(vakOp('a1', a), vakOp('b1', b), vakOp('c1', c), vak('d'));
  store.setAnnotationLayerFlag(b, 'locked', true);
  assert.equal(await store.selectAnnotationsOnLayers([a, b, c]), 2);
  assert.deepEqual(doc.selectedAnnotations.map((x) => x.id).sort(), ['a1', 'c1']);
  store.setAnnotationLayerFlag(b, 'locked', false);
  assert.equal(await store.selectAnnotationsOnLayers([c, a]), 2);
  assert.deepEqual(doc.selectedAnnotations.map((x) => x.id), ['c1', 'a1']);
  assert.equal(await store.selectAnnotationsOnLayers(['onbekend']), 0);
  assert.deepEqual(doc.selectedAnnotations.map((x) => x.id), ['c1', 'a1'], 'een onbekende laag laat de selectie staan');
});
