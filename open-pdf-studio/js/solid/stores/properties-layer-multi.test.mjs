// Eigenschappenpaneel (the external editor): het veld Laag voor één en meer markeringen, en
// Onderwerp, Auteur, Status en Opmerking bewerkbaar bij een meervoudige
// selectie. Gemengde waarden blijven leeg; een wijziging geldt voor alle
// markeringen en is één undo-stap. (Dat de laag van een markering opslaan en
// heropenen overleeft, toetst pdf/markup-layer-roundtrip.test.mjs.)

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../../core/state.js');
const undo = await import('../../core/undo-manager.js');
const { createAnnotation } = await import('../../annotations/factory.js');
const { addLayer, layerIdOf, getLayers, DEFAULT_LAYER_ID } = await import('../../annotations/annotatie-lagen.js');
const props = await import('./propertiesStore.js');

const vak = (over = {}) => createAnnotation({ type: 'box', page: 1, x: 10, y: 10, width: 40, height: 30, ...over });
const notitie = (text) => createAnnotation({ type: 'comment', page: 1, x: 20, y: 20, width: 20, height: 20, text });

function openen(annotations) {
  state.documents = [{
    id: `props-${Math.random().toString(36).slice(2, 8)}`, filePath: 'C:/p/in.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
    _annotationPagesReady: new Set([1]),
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

function selecteer(doc, anns) {
  doc.selectedAnnotations = anns;
  doc.selectedAnnotation = anns[0] || null;
  if (anns.length > 1) props.storeShowMultiSelection(doc.selectedAnnotations);
  else props.storeShowProperties(doc.selectedAnnotations[0]);
}

test('Laag bij een meervoudige selectie: gemengd is leeg, kiezen verplaatst alles in één undo-stap', async () => {
  const doc = openen([vak({ subject: 'A' }), vak({ subject: 'B' }), vak()]);
  const elek = addLayer(doc, { name: 'Elektra' }).layer;
  doc.annotations[1].layer = elek.id;
  selecteer(doc, [doc.annotations[0], doc.annotations[1]]);
  assert.equal(props.panelMode(), 'multi');
  assert.equal(props.panelLayerId(), '', 'gemengd: leeg');

  assert.equal(await props.setPanelLayer(elek.id), 1, 'alleen wat nog niet op de laag stond');
  assert.equal(layerIdOf(doc.annotations[0]), elek.id);
  assert.equal(layerIdOf(doc.annotations[2]), DEFAULT_LAYER_ID, 'niet geselecteerd');
  assert.equal(props.panelLayerId(), elek.id);
  assert.equal(doc.undoStack.length, 1);

  await undo.undo();
  const na = state.documents[0];
  assert.equal(layerIdOf(na.annotations[0]), DEFAULT_LAYER_ID);
  assert.equal(layerIdOf(na.annotations[1]), elek.id, 'stond er al op');
});

test('Laag bij één markering, en "Nieuwe laag…" maakt een laag en zet de markering erop', async () => {
  const doc = openen([vak()]);
  selecteer(doc, [doc.annotations[0]]);
  assert.equal(props.panelLayerId(), DEFAULT_LAYER_ID);
  const voor = getLayers(doc).length;
  const id = await props.setPanelLayer(props.NEW_LAYER_VALUE);
  assert.ok(typeof id === 'string' && id);
  assert.equal(getLayers(doc).length, voor + 1);
  assert.equal(layerIdOf(doc.annotations[0]), id);
  assert.equal(props.panelLayerId(), id);
  assert.equal(doc.undoStack.length, 1, 'het verplaatsen is één undo-stap');
});

test('Laag: niet voor een vergrendelde markering of de gereedschapsstandaarden', async () => {
  const doc = openen([vak({ locked: true })]);
  const a = addLayer(doc, { name: 'A' }).layer;
  selecteer(doc, [doc.annotations[0]]);
  assert.equal(await props.setPanelLayer(a.id), 0);
  assert.equal(layerIdOf(doc.annotations[0]), DEFAULT_LAYER_ID);
  props.storeShowProperties({ id: '__tool-defaults__', type: 'box' });
  assert.deepEqual(props.panelTargets(), []);
  assert.equal(props.panelLayerId(), '');
});

test('Onderwerp, Auteur en Status bij een meervoudige selectie: gemengd leeg, één undo-stap voor alle', async () => {
  const doc = openen([vak({ subject: 'A', author: 'Jan' }), vak({ subject: 'B', author: 'Jan' }), vak({ subject: 'C' })]);
  selecteer(doc, [doc.annotations[0], doc.annotations[1]]);
  assert.equal(props.annotProps.subject, '');
  assert.equal(props.annotProps.subjectMixed, true);
  assert.equal(props.annotProps.author, 'Jan');
  assert.equal(props.annotProps.authorMixed, false);

  props.updateAnnotProp('subject', 'Wand');
  assert.deepEqual(doc.annotations.map((a) => a.subject), ['Wand', 'Wand', 'C']);
  assert.equal(props.annotProps.subjectMixed, false, 'na bewerken niet meer gemengd');
  assert.equal(doc.undoStack.length, 1);
  props.updateAnnotProp('author', 'Piet');
  props.updateAnnotProp('status', 'accepted');
  assert.deepEqual(doc.annotations.slice(0, 2).map((a) => [a.author, a.status]), [['Piet', 'accepted'], ['Piet', 'accepted']]);
  assert.equal(doc.undoStack.length, 3, 'elke wijziging één stap, niet één per markering');

  await undo.undo();
  await undo.undo();
  await undo.undo();
  assert.deepEqual(state.documents[0].annotations.map((a) => a.subject), ['A', 'B', 'C']);
});

test('Opmerking (inhoud) bij meerdere notities: gedeelde tekst zichtbaar, gemengd leeg, bewerken geldt voor alle', () => {
  const doc = openen([notitie('Controleren'), notitie('Controleren'), notitie('Anders')]);
  selecteer(doc, [doc.annotations[0], doc.annotations[1]]);
  assert.equal(props.sectionVis.content, true);
  assert.equal(props.sectionVis.textGroup, true);
  assert.equal(props.annotProps.text, 'Controleren');
  assert.equal(props.annotProps.textMixed, false);
  selecteer(doc, [doc.annotations[1], doc.annotations[2]]);
  assert.equal(props.annotProps.text, '');
  assert.equal(props.annotProps.textMixed, true);
  props.updateAnnotProp('text', 'Akkoord');
  assert.deepEqual(doc.annotations.map((a) => a.text), ['Controleren', 'Akkoord', 'Akkoord']);
  assert.equal(doc.undoStack.length, 1);
  // Een mix met een vorm: geen inhoudsveld.
  doc.annotations.push(vak());
  selecteer(doc, [doc.annotations[0], doc.annotations[3]]);
  assert.equal(props.sectionVis.content, false);
});

test('het paneel en de eigenschappenbalk tonen de keuzelijst Laag; tekstvelden bij meer markeringen bij verlaten', async () => {
  const { readFileSync } = await import('node:fs');
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const algemeen = lees('../components/properties-panel/GeneralSection.jsx');
  const balk = lees('../components/PropertiesToolbar.jsx');
  const veld = lees('../components/properties-panel/LayerField.jsx');
  assert.match(algemeen, /<LayerField id="prop-layer" \/>/);
  assert.match(balk, /<LayerField id="properties-toolbar-layer" \/>/);
  assert.match(veld, /setPanelLayer\(gekozen\)/);
  assert.match(veld, /NEW_LAYER_VALUE/);
  for (const k of ['subject', 'author', 'altText']) assert.match(algemeen, new RegExp(`textFieldHandlers\\('${k}'\\)`));
  assert.match(lees('../components/properties-panel/ContentSection.jsx'), /textFieldHandlers\('text'\)/);
  const nl = JSON.parse(lees('../../i18n/locales/nl/properties.json'));
  assert.equal(nl.general.layer, 'Laag');
});
