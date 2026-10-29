import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { edition as foundation } from './community.js';
import { composeAddons } from './compose-addons.js';
import { assertEditionContract } from './contract.js';
import { pdfKeyPrefix } from './pdf-hooks.js';
import { carryUnmodeledAnnotationKeys } from '../pdf/saver/unmodeled-annotation-keys.js';

const key = (id, suffix) => `${pdfKeyPrefix(id)}${suffix}`;
const text = (dict, name) => dict.get(PDFName.of(name))?.decodeText();

test('two v2 packages round-trip their own catalog and annotation strings through a real PDF', async () => {
  const first = 'sample.one', second = 'sample-two';
  const firstCatalog = key(first, 'State'), secondCatalog = key(second, 'State');
  const firstAnnotation = key(first, 'Markup'), secondAnnotation = key(second, 'Markup');
  const applied = {};
  const { edition, accepted, rejected } = composeAddons(foundation, [
    { id: first, addon: { apiVersion: 2, id: first, pdf: {
      catalogKeys: [firstCatalog], annotationKeys: [firstAnnotation],
      applyCatalog(doc, fields) { doc.first = fields[firstCatalog]; applied.first = fields; },
      catalogForSave(doc) { return { [firstCatalog]: doc.first }; },
      decorateAnnotation(model, fields) { return { ...model, first: fields[firstAnnotation] }; },
      annotationForSave(model) { return { [firstAnnotation]: model.first }; },
    } } },
    { id: second, addon: { apiVersion: 2, id: second, pdf: {
      catalogKeys: [secondCatalog], annotationKeys: [secondAnnotation],
      applyCatalog(doc, fields) { doc.second = fields[secondCatalog]; applied.second = fields; },
      catalogForSave(doc) { return { [secondCatalog]: doc.second }; },
      decorateAnnotation(model, fields) { return { ...model, second: fields[secondAnnotation] }; },
      annotationForSave(model) { return { [secondAnnotation]: model.second }; },
    } } },
  ]);
  assert.deepEqual(accepted, [first, second]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(edition.pdf.catalogKeys, [firstCatalog, secondCatalog]);
  assert.deepEqual(edition.pdf.annotationKeys, [firstAnnotation, secondAnnotation]);
  assert.equal(assertEditionContract(edition), edition);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const source = { first: 'first catalog ✓', second: 'second catalog', annotations: [] };
  const workspace = edition.pdf.workspaceForSave(source, pdf);
  edition.pdf.saveWorkspace(pdf, workspace);
  const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 20, 20] });
  edition.pdf.writeAnnotation({ first: 'first markup', second: 'second markup' }, annotation,
    { PDFName, pdfTextString: PDFHexString.fromText });
  page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(annotation)]));

  const reopened = await PDFDocument.load(await pdf.save());
  const loaded = {};
  edition.pdf.applyWorkspace(loaded, edition.pdf.readWorkspace(reopened));
  assert.equal(loaded.first, source.first);
  assert.equal(loaded.second, source.second);
  assert.deepEqual(applied.first, { [firstCatalog]: source.first });
  assert.deepEqual(applied.second, { [secondCatalog]: source.second });
  const annots = reopened.context.lookup(reopened.getPages()[0].node.get(PDFName.of('Annots')));
  assert.ok(annots instanceof PDFArray);
  const loadedAnnotation = reopened.context.lookup(annots.get(0));
  assert.equal(text(loadedAnnotation, firstAnnotation), 'first markup');
  assert.equal(text(loadedAnnotation, secondAnnotation), 'second markup');
  const model = edition.pdf.decorateLoadedAnnotation({ id: 'm1' }, { extensionFields: {
    [firstAnnotation]: text(loadedAnnotation, firstAnnotation),
    [secondAnnotation]: text(loadedAnnotation, secondAnnotation),
  } });
  assert.equal(model.first, 'first markup');
  assert.equal(model.second, 'second markup');
});

test('v1 full-edition hooks stay active and an omitted v2 annotation value is carried from its source', async () => {
  const id = 'sample.one';
  const catalogKey = key(id, 'State');
  const annotationKey = key(id, 'Markup');
  const calls = [];
  const base = { ...foundation, pdf: {
    catalogKeys: ['LegacyState'], annotationKeys: ['LegacyMarkup'],
    readWorkspace() { calls.push('read'); return 'legacy'; },
    applyWorkspace(doc, value) { calls.push('apply'); doc.legacy = value; },
    workspaceForSave() { calls.push('prepare'); return 'saved'; },
    saveWorkspace(pdf, value) { calls.push('save'); pdf.catalog.set(PDFName.of('LegacyState'), PDFHexString.fromText(value)); },
    decorateLoadedAnnotation(model) { calls.push('decorate'); return model; },
    writeAnnotation(_model, dict) { calls.push('write'); dict.set(PDFName.of('LegacyMarkup'), PDFHexString.fromText('legacy')); },
  } };
  const { edition, rejected } = composeAddons(base, [{ id, addon: { apiVersion: 2, id, pdf: {
    catalogKeys: [catalogKey], annotationKeys: [annotationKey],
    catalogForSave() { return { [catalogKey]: 'v2' }; },
    annotationForSave() { return {}; },
  } } }]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(edition.pdf.annotationKeysToSkipCarry, ['LegacyMarkup']);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  edition.pdf.saveWorkspace(pdf, edition.pdf.workspaceForSave({}, pdf));
  assert.equal(text(pdf.catalog, 'LegacyState'), 'saved');
  assert.equal(text(pdf.catalog, catalogKey), 'v2');
  edition.pdf.applyWorkspace({}, edition.pdf.readWorkspace(pdf));

  const original = pdf.context.obj({ Subtype: 'Text', NM: PDFHexString.fromText('m1'),
    [annotationKey]: PDFHexString.fromText('preserve me') });
  const ref = pdf.context.register(original);
  const target = pdf.context.obj({ Subtype: 'Text', NM: PDFHexString.fromText('m1') });
  const model = { id: 'm1', pdfSource: { ref: ref.toString(), modelId: 'm1', nm: 'm1' } };
  edition.pdf.writeAnnotation(model, target, { PDFName, pdfTextString: PDFHexString.fromText });
  carryUnmodeledAnnotationKeys(pdf.context, [ref], model, target, edition.pdf.annotationKeysToSkipCarry);
  assert.equal(text(target, 'LegacyMarkup'), 'legacy');
  assert.equal(text(target, annotationKey), 'preserve me');
  assert.deepEqual(calls, ['prepare', 'save', 'read', 'apply', 'write']);
});

test('v2 PDF key ownership and operation limits reject a package without changing prior composition', async () => {
  const id = 'sample.one', owned = key(id, 'State');
  const valid = { id, addon: { apiVersion: 2, id, pdf: { catalogKeys: [owned], catalogForSave: () => ({ [owned]: 'ok' }) } } };
  const bad = [
    { ...valid.addon, pdf: { catalogKeys: ['OPS_MarkupTextValue'] } },
    { ...valid.addon, pdf: { catalogKeys: [owned, owned] } },
    { ...valid.addon, pdf: { catalogKeys: [owned], saveWorkspace() {} } },
    { ...valid.addon, pdf: { catalogKeys: [owned], catalogForSave: () => ({ OtherKey: 'bad' }) } },
  ];
  for (const addon of bad.slice(0, 3)) {
    const result = composeAddons(foundation, [{ id, addon }]);
    assert.deepEqual(result.accepted, []);
    assert.equal(result.edition, foundation);
  }
  const composed = composeAddons(foundation, [valid, { id: 'bad', addon: { apiVersion: 2, id: 'bad',
    pdf: { catalogKeys: [owned] } } }]);
  assert.deepEqual(composed.accepted, [id]);
  assert.equal(composed.rejected.length, 1);
  assert.deepEqual(composed.edition.pdf.catalogKeys, [owned]);
  const pdf = await PDFDocument.create();
  assert.throws(() => composeAddons(foundation, [{ id, addon: bad[3] }]).edition.pdf.workspaceForSave({}, pdf), /unowned/);
  pdf.catalog.set(PDFName.of(owned), PDFHexString.fromText('cannot remap page-specific data'));
  const extracted = await PDFDocument.create();
  assert.throws(() => composed.edition.pdf.carryToExtract(pdf, extracted, [1]), /Cannot extract pages/);
});

test('v2 PDF callbacks reject asynchronous or unowned save data before writing package fields', async () => {
  const id = 'sample.one', owned = key(id, 'State');
  const pdf = await PDFDocument.create();
  const asyncSave = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    catalogKeys: [owned], catalogForSave: async () => ({ [owned]: 'later' }),
  } } }]).edition.pdf;
  assert.throws(() => asyncSave.workspaceForSave({}, pdf), /synchronous object/);
  assert.equal(pdf.catalog.get(PDFName.of(owned)), undefined);

  const ordinary = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    catalogKeys: [owned], catalogForSave: () => ({ [owned]: 'ready' }),
  } } }]).edition.pdf;
  assert.throws(() => ordinary.saveWorkspace(pdf, { addons: { [id]: { OtherKey: 'bad' } } }), /unowned/);
  assert.equal(pdf.catalog.get(PDFName.of('OtherKey')), undefined);

  const asyncLoad = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    annotationKeys: [key(id, 'Markup')], decorateAnnotation: async (model) => model,
  } } }]).edition.pdf;
  assert.throws(() => asyncLoad.decorateLoadedAnnotation({ id: 'm1' }, {}), /must be synchronous/);
});

test('catalog callbacks only run for packages with source fields, and oversized fields are not decoded', async () => {
  const ids = ['sample.one', 'sample.two', 'sample.three'];
  const keys = ids.map((id) => key(id, 'State'));
  const called = [];
  const packages = ids.map((id, index) => ({ id, addon: { apiVersion: 2, id, pdf: {
    catalogKeys: [keys[index]],
    applyCatalog(_doc, fields) {
      called.push(id);
      assert.deepEqual(fields, { [keys[index]]: 'present' });
    },
  } } }));
  const { edition, rejected } = composeAddons(foundation, packages);
  assert.deepEqual(rejected, []);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.catalog.set(PDFName.of(keys[0]), PDFHexString.fromText('present'));
  const reopened = await PDFDocument.load(await pdf.save());
  edition.pdf.applyWorkspace({}, edition.pdf.readWorkspace(reopened));
  assert.deepEqual(called, [ids[0]], 'later packages without source keys are not invoked');

  const oversized = PDFString.of('x'.repeat((256 * 1024 + 1) * 4 + 1));
  oversized.decodeText = () => { throw new Error('decoded oversized catalog value'); };
  reopened.catalog.set(PDFName.of(keys[1]), oversized);
  edition.pdf.applyWorkspace({}, edition.pdf.readWorkspace(reopened));
  assert.deepEqual(called, [ids[0], ids[0]], 'oversized package field is skipped before decode');
});
