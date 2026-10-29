import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { edition as foundation } from './community.js';
import { composeAddons } from './compose-addons.js';
import { assertEditionContract } from './contract.js';
import { pdfKeyPrefix } from './pdf-hooks.js';
import { extractPdfLibPages } from '../pdf/extract-pages-core.js';
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

test('an independent package claims an exact legacy text key without replacing unreadable source data', async () => {
  const id = 'sample.legacy', legacy = 'LAB_DrawingStateV1';
  const contribution = { legacyCatalogKeys: [legacy],
    applyCatalog(doc, fields) { doc.state = fields[legacy]; },
    catalogForSave(doc, source) {
      assert.ok(Object.isFrozen(source) && Object.isFrozen(source.fields)
        && Object.isFrozen(source.presentKeys));
      assert.deepEqual(Object.keys(source.fields).filter((key) => key !== legacy), []);
      return doc.state ? { [legacy]: doc.state } : {};
    },
  };
  const { edition, rejected } = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: contribution } }]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(edition.pdf.catalogKeys, [legacy]);

  const pdf = await PDFDocument.create();
  pdf.addPage();
  const large = 'x'.repeat(300 * 1024);
  edition.pdf.saveWorkspace(pdf, edition.pdf.workspaceForSave({ state: large }, pdf));
  const reopened = await PDFDocument.load(await pdf.save());
  const loaded = {};
  edition.pdf.applyWorkspace(loaded, edition.pdf.readWorkspace(reopened));
  assert.equal(loaded.state, large);
  assert.equal(new TextDecoder('utf-16be').decode(reopened.catalog.get(PDFName.of(legacy)).asBytes()), large);

  const invalid = reopened.context.obj({ Data: PDFHexString.fromText('opaque') });
  reopened.catalog.set(PDFName.of(legacy), reopened.context.register(invalid));
  assert.throws(() => edition.pdf.saveWorkspace(reopened,
    edition.pdf.workspaceForSave({ state: 'replace' }, reopened)), /unreadable/);
  assert.equal(reopened.context.lookup(reopened.catalog.get(PDFName.of(legacy))), invalid);
  edition.pdf.saveWorkspace(reopened, edition.pdf.workspaceForSave({}, reopened));
  assert.equal(reopened.context.lookup(reopened.catalog.get(PDFName.of(legacy))), invalid);
});

test('an explicit v2 catalog deletion removes only the claimed readable key after save and reopen', async () => {
  const first = 'sample.delete', second = 'sample.keep';
  const removed = 'LAB_DrawingStateV1', kept = key(second, 'State');
  const unclaimed = 'LAB_UnknownStateV1';
  const seen = [];
  const { edition, rejected } = composeAddons(foundation, [
    { id: first, addon: { apiVersion: 2, id: first, pdf: {
      legacyCatalogKeys: [removed],
      catalogForSave(doc, source) {
        seen.push(source);
        return doc.remove ? { [removed]: null } : {};
      },
    } } },
    { id: second, addon: { apiVersion: 2, id: second, pdf: {
      catalogKeys: [kept], catalogForSave: () => ({}),
    } } },
  ]);
  assert.deepEqual(rejected, []);

  const source = await PDFDocument.create();
  source.addPage();
  source.catalog.set(PDFName.of(removed), PDFHexString.fromText('undo this'));
  source.catalog.set(PDFName.of(kept), PDFHexString.fromText('keep this'));
  source.catalog.set(PDFName.of(unclaimed), PDFHexString.fromText('unknown source'));
  let pdf = await PDFDocument.load(await source.save());
  edition.pdf.saveWorkspace(pdf, edition.pdf.workspaceForSave({}, pdf));
  pdf = await PDFDocument.load(await pdf.save());
  assert.equal(text(pdf.catalog, removed), 'undo this', 'omission preserves source bytes');
  assert.equal(text(pdf.catalog, kept), 'keep this');
  assert.equal(text(pdf.catalog, unclaimed), 'unknown source');
  assert.deepEqual(seen.at(-1).presentKeys, [removed]);
  assert.deepEqual(seen.at(-1).fields, { [removed]: 'undo this' });

  edition.pdf.saveWorkspace(pdf, edition.pdf.workspaceForSave({ remove: true }, pdf));
  pdf = await PDFDocument.load(await pdf.save());
  assert.equal(pdf.catalog.get(PDFName.of(removed)), undefined);
  assert.equal(text(pdf.catalog, kept), 'keep this');
  assert.equal(text(pdf.catalog, unclaimed), 'unknown source');

  assert.throws(() => edition.pdf.saveWorkspace(pdf, { addons: {
    [first]: { [unclaimed]: null },
  } }), /unowned/);
  assert.equal(text(pdf.catalog, unclaimed), 'unknown source');
});

test('v2 catalog deletion refuses an unreadable claimed value and leaves its source intact', async () => {
  const id = 'sample.delete', owned = 'LAB_DrawingStateV1';
  const { edition } = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyCatalogKeys: [owned], catalogForSave: () => ({ [owned]: null }),
  } } }]);
  const source = await PDFDocument.create();
  source.addPage();
  const unreadable = source.context.obj({ Data: PDFHexString.fromText('opaque') });
  source.catalog.set(PDFName.of(owned), source.context.register(unreadable));
  const pdf = await PDFDocument.load(await source.save());
  assert.throws(() => edition.pdf.saveWorkspace(pdf, edition.pdf.workspaceForSave({}, pdf)), /Cannot delete unreadable/);
  const reopened = await PDFDocument.load(await pdf.save());
  assert.ok(reopened.catalog.get(PDFName.of(owned)));
  assert.equal(reopened.context.lookup(reopened.catalog.get(PDFName.of(owned))).get(PDFName.of('Data')).decodeText(), 'opaque');
});

test('legacy decoding matches short pdf-lib strings and preserves malformed large UTF-16', async () => {
  const id = 'sample.legacy', key = 'LAB_DrawingStateV1';
  const { edition } = composeAddons(foundation, [{ id, addon: {
    apiVersion: 2, id, pdf: { legacyCatalogKeys: [key] },
  } }]);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  for (const raw of [PDFHexString.fromText('valid 😀'), PDFHexString.of('FEFFD8000041')]) {
    pdf.catalog.set(PDFName.of(key), raw);
    assert.equal(edition.pdf.readWorkspace(pdf).addons[id][key], raw.decodeText());
  }
  const malformed = PDFHexString.fromText('x'.repeat(70 * 1024));
  malformed.value = `${malformed.value.slice(0, -4)}D800`;
  pdf.catalog.set(PDFName.of(key), malformed);
  const before = malformed.toString();
  assert.deepEqual(edition.pdf.readWorkspace(pdf).addons[id], {});
  assert.throws(() => edition.pdf.saveWorkspace(pdf, {
    addons: { [id]: { [key]: 'replacement' } },
  }), /unreadable/);
  assert.equal(pdf.catalog.get(PDFName.of(key)).toString(), before);
  const reopened = await PDFDocument.load(await pdf.save());
  assert.equal(reopened.catalog.get(PDFName.of(key)).toString(), before);
});

test('legacy claims reject editor and structural keys; unknown versioned data blocks extract', async () => {
  for (const legacy of ['Pages', 'OPS_MarkupStatusSetV1', 'LAB_State']) {
    const id = 'sample.legacy';
    const candidate = { apiVersion: 2, id, pdf: { legacyCatalogKeys: [legacy] } };
    const result = composeAddons(foundation, [{ id, addon: candidate }]);
    assert.equal(result.accepted.length, 0);
  }
  const source = await PDFDocument.create();
  source.addPage();
  source.catalog.set(PDFName.of('LAB_DrawingStateV1'), PDFHexString.fromText('page-specific'));
  await assert.rejects(extractPdfLibPages(source, [1]), /unclaimed legacy PDF data/);
  assert.equal(text(source.catalog, 'LAB_DrawingStateV1'), 'page-specific');
});

test('an extraction-only legacy tag claim gives a bounded source-page snapshot', async () => {
  const id = 'sample.legacy', catalog = 'LAB_DrawingStateV1', tag = 'LAB_AreaTagV1';
  const seen = [];
  const pdf = { legacyCatalogKeys: [catalog], extractAnnotationKeys: [tag],
    catalogForExtract(source) {
      assert.equal(Object.isFrozen(source), true);
      assert.equal(Object.isFrozen(source.pages), true);
      assert.equal(Object.isFrozen(source.pages[0].fields[tag]), true);
      seen.push(source.pages.map((page) => [page.sourcePage, page.targetPage, page.fields[tag]]));
      return { [catalog]: `${source.fields[catalog]}:extracted` };
    } };
  const { edition, rejected } = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf } }]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(edition.pdf.annotationKeys, [], 'extraction claim does not grant annotation editing');
  const source = await PDFDocument.create();
  const first = source.addPage([200, 200]);
  const second = source.addPage([200, 200]);
  first.node.addAnnot(source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10], [tag]: PDFHexString.fromText('first'),
  })));
  second.node.addAnnot(source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10], [tag]: PDFHexString.fromText('second'),
  })));
  source.catalog.set(PDFName.of(catalog), PDFHexString.fromText('source'));
  const target = await PDFDocument.create();
  for (const page of await target.copyPages(source, [1, 0])) target.addPage(page);
  edition.pdf.carryToExtract(source, target, [2, 1]);
  const reopened = await PDFDocument.load(await target.save());
  assert.equal(text(reopened.catalog, catalog), 'source:extracted');
  assert.deepEqual(seen, [[[2, 1, ['second']], [1, 2, ['first']]]]);
  assert.equal(text(source.catalog, catalog), 'source');
  const collision = composeAddons({ ...foundation, pdf: { annotationKeys: [tag] } },
    [{ id, addon: { apiVersion: 2, id, pdf } }]);
  assert.equal(collision.accepted.length, 0);
});

test('exact legacy annotation claims are bounded and reject stale source identity', async () => {
  const id = 'sample.legacy';
  const tag = 'LAB_AreaTagV1';
  const { edition, rejected } = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyAnnotationKeys: [tag],
    decorateAnnotation(model, fields) { model.area = fields[tag]; return model; },
    annotationForSave(model) { return model.pdfSource ? {} : { [tag]: model.area }; },
  } } }]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(edition.pdf.annotationKeys, [tag]);
  assert.equal(edition.pdf.decorateLoadedAnnotation({ type: 'polygon' },
    { extensionFields: { [tag]: 'area-1', OtherTag: 'hidden' } }).area, 'area-1');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const raw = pdf.context.obj({ Type: 'Annot', Subtype: 'Polygon', NM: PDFString.of('area-markup'),
    [tag]: PDFHexString.fromText('area-1') });
  const ref = pdf.context.register(raw);
  page.node.set(PDFName.of('Annots'), pdf.context.obj([ref]));
  const model = { id: 'area-markup', area: 'area-1', pdfSource: {
    ref: ref.toString(), modelId: 'area-markup', nm: 'area-markup',
  } };
  const target = pdf.context.obj({ Type: 'Annot', Subtype: 'Polygon', NM: PDFString.of('area-markup') });
  const tools = { PDFName, pdfTextString: PDFHexString.fromText,
    sourceContext: pdf.context, sourceRefs: [ref] };
  edition.pdf.writeAnnotation(model, target, tools);
  carryUnmodeledAnnotationKeys(pdf.context, [ref], model, target, edition.pdf.annotationKeysToSkipCarry);
  assert.equal(target.get(PDFName.of(tag)), raw.get(PDFName.of(tag)), 'unchanged tag retains raw PDF object');
  const writing = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyAnnotationKeys: [tag], annotationForSave: (markup) => ({ [tag]: markup.area }),
  } } }]).edition.pdf;
  for (const changed of [
    { ...model, pdfSource: { ...model.pdfSource, ref: '9999 0 R' } },
    { ...model, pdfSource: { ...model.pdfSource, nm: 'forged' } },
    { ...model, pdfSource: { ...model.pdfSource, modelId: 'other' } },
  ]) assert.throws(() => writing.writeAnnotation(changed, target, tools), /source changed/);
  const tooLarge = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyAnnotationKeys: [tag], annotationForSave: () => ({ [tag]: '😀'.repeat(5000) }),
  } } }]).edition.pdf;
  assert.throws(() => tooLarge.writeAnnotation({ id: 'new' }, target, tools), /oversized/);
  const editorOwned = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyAnnotationKeys: ['OPS_MarkupIdV1'],
  } } }]);
  assert.equal(editorOwned.accepted.length, 0);
  const unreadable = pdf.context.obj({ Data: PDFString.of('opaque') });
  raw.set(PDFName.of(tag), pdf.context.register(unreadable));
  const untouched = pdf.context.obj({ Type: 'Annot', Subtype: 'Polygon', NM: PDFString.of('area-markup') });
  edition.pdf.writeAnnotation(model, untouched, tools);
  carryUnmodeledAnnotationKeys(pdf.context, [ref], model, untouched, edition.pdf.annotationKeysToSkipCarry);
  assert.equal(pdf.context.lookup(untouched.get(PDFName.of(tag))), unreadable);
  const replacing = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyAnnotationKeys: [tag], annotationForSave: () => ({ [tag]: 'replacement' }),
  } } }]).edition.pdf;
  assert.throws(() => replacing.writeAnnotation(model, untouched, tools), /unreadable/);
  const unrelated = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Stamp',
    NM: PDFString.of('external-image') }));
  const externalModel = { id: 'external-image', pdfSource: {
    ref: '9999 0 R', modelId: 'external-image', nm: 'external-image',
  } };
  assert.doesNotThrow(() => edition.pdf.writeAnnotation(externalModel,
    pdf.context.obj({ Type: 'Annot', Subtype: 'Square' }),
    { ...tools, sourceRefs: [unrelated] }), 'an unrelated stale source does not block the save');
  const full = composeAddons({ ...foundation, pdf: { annotationKeys: [tag] } },
    [{ id, addon: { apiVersion: 2, id, pdf: { legacyAnnotationKeys: [tag] } } }]);
  assert.equal(full.accepted.length, 0);
});

test('legacy extraction rejects missing ownership, partial output, and malformed tags', async () => {
  const id = 'sample.legacy', catalog = 'LAB_DrawingStateV1', tag = 'LAB_AreaTagV1';
  const invalid = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyCatalogKeys: [catalog], extractAnnotationKeys: [tag],
  } } }]);
  assert.equal(invalid.accepted.length, 0);
  const editorKey = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyCatalogKeys: [catalog], extractAnnotationKeys: ['OPS_MarkupIdV1'],
    catalogForExtract: () => ({ [catalog]: 'out' }),
  } } }]);
  assert.equal(editorKey.accepted.length, 0);
  const source = await PDFDocument.create();
  const page = source.addPage([200, 200]);
  source.catalog.set(PDFName.of(catalog), PDFHexString.fromText('source'));
  const target = await PDFDocument.create();
  target.addPage((await target.copyPages(source, [0]))[0]);
  const partial = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyCatalogKeys: [catalog], catalogForExtract: () => ({}),
  } } }]).edition.pdf;
  assert.throws(() => partial.carryToExtract(source, target, [1]), /did not remap every owned catalog field/);
  assert.equal(target.catalog.get(PDFName.of(catalog)), undefined);
  page.node.addAnnot(source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10], [tag]: 42,
  })));
  const claimed = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyCatalogKeys: [catalog], extractAnnotationKeys: [tag],
    catalogForExtract: () => ({ [catalog]: 'out' }),
  } } }]).edition.pdf;
  assert.throws(() => claimed.carryToExtract(source, target, [1]), /Unreadable PDF extraction tag/);
  assert.equal(target.catalog.get(PDFName.of(catalog)), undefined);
});

test('legacy extraction refuses a target page whose claimed tags differ from the selected source', async () => {
  const id = 'sample.legacy', catalog = 'LAB_DrawingStateV1', tag = 'LAB_AreaTagV1';
  const { edition } = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, pdf: {
    legacyCatalogKeys: [catalog], extractAnnotationKeys: [tag],
    catalogForExtract: () => ({ [catalog]: 'remapped' }),
  } } }]);
  const source = await PDFDocument.create();
  const page = source.addPage([200, 200]);
  page.node.addAnnot(source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10], [tag]: PDFHexString.fromText('must-survive'),
  })));
  source.catalog.set(PDFName.of(catalog), PDFHexString.fromText('source'));
  const wrongTarget = await PDFDocument.create();
  wrongTarget.addPage([200, 200]);
  assert.throws(() => edition.pdf.carryToExtract(source, wrongTarget, [1]), /lost an owned extraction tag/);
  assert.equal(wrongTarget.catalog.get(PDFName.of(catalog)), undefined);
});
