import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFRef } from 'pdf-lib';
import { carryUnmodeledAnnotationKeys, hasUnmodeledAnnotationKeys } from '../js/pdf/saver/unmodeled-annotation-keys.js';
import { extractAnnotationColors } from '../js/pdf/loader/color-extraction.js';

const N = (name) => PDFName.of(name);

test('Foundation rewrite preserves unknown catalog and annotation fields through PDF bytes', async () => {
  const original = await PDFDocument.create();
  const page = original.addPage([240, 300]);
  const payload = original.context.obj({ Stage: PDFString.of('reviewed'), Number: 7 });
  const payloadRef = original.context.register(payload);
  const unreadableTag = original.context.register(original.context.obj({ Raw: PDFString.of('opaque') }));
  const catalogWorkspace = original.context.obj({ Version: 1, Data: payloadRef });
  original.catalog.set(N('OPS_ExtensionWorkspaceV1'), original.context.register(catalogWorkspace));
  const source = original.context.obj({
    Type: N('Annot'), Subtype: N('Square'), Rect: [10, 20, 80, 90],
    NM: PDFString.of('markup-1'), OPS_UnknownAddonState: payloadRef,
    X_PrivateState: PDFString.of('retained'),
    OPS_LegacyTextV1: PDFString.of('area-1'), OPS_LegacyOpaqueV1: unreadableTag,
  });
  const sourceRef = original.context.register(source);
  page.node.set(N('Annots'), original.context.obj([sourceRef]));

  const opened = await PDFDocument.load(await original.save());
  const openedPage = opened.getPage(0);
  const refs = opened.context.lookup(openedPage.node.get(N('Annots'))).asArray();
  const replacement = opened.context.obj({
    Type: N('Annot'), Subtype: N('Square'), Rect: [20, 30, 100, 120],
    NM: PDFString.of('markup-1'), Contents: PDFString.of('edited in Foundation'),
  });
  assert.deepEqual(carryUnmodeledAnnotationKeys(opened.context, refs,
    { id: 'model-1', pdfSource: { ref: refs[0].toString(), modelId: 'model-1', nm: 'markup-1' } }, replacement),
  ['OPS_UnknownAddonState', 'X_PrivateState', 'OPS_LegacyTextV1', 'OPS_LegacyOpaqueV1']);
  const replacementRef = opened.context.register(replacement);
  openedPage.node.set(N('Annots'), opened.context.obj([replacementRef]));

  const reopened = await PDFDocument.load(await opened.save());
  const saved = reopened.context.lookup(reopened.context.lookup(reopened.getPage(0).node.get(N('Annots'))).get(0));
  assert.equal(saved.get(N('Contents')).decodeText(), 'edited in Foundation');
  assert.equal(saved.get(N('X_PrivateState')).decodeText(), 'retained');
  assert.equal(saved.get(N('OPS_LegacyTextV1')).decodeText(), 'area-1');
  assert.equal(reopened.context.lookup(saved.get(N('OPS_LegacyOpaqueV1'))).get(N('Raw')).decodeText(), 'opaque');
  const addonPayload = reopened.context.lookup(saved.get(N('OPS_UnknownAddonState')));
  assert.equal(addonPayload.get(N('Stage')).decodeText(), 'reviewed');
  const workspace = reopened.context.lookup(reopened.catalog.get(N('OPS_ExtensionWorkspaceV1')));
  assert.equal(reopened.context.lookup(workspace.get(N('Data'))).get(N('Number')).asNumber(), 7);

  // A later rewrite must use the new reference and retain the same payload.
  const secondRefs = reopened.context.lookup(reopened.getPage(0).node.get(N('Annots'))).asArray();
  const second = reopened.context.obj({ Type: N('Annot'), Subtype: N('Square'),
    Rect: [30, 40, 110, 130], NM: PDFString.of('markup-1') });
  carryUnmodeledAnnotationKeys(reopened.context, secondRefs,
    { id: 'model-1', pdfSource: { ref: secondRefs[0].toString(), modelId: 'model-1', nm: 'markup-1' } }, second);
  reopened.getPage(0).node.set(N('Annots'), reopened.context.obj([reopened.context.register(second)]));
  const third = await PDFDocument.load(await reopened.save());
  const thirdAnnot = third.context.lookup(third.context.lookup(third.getPage(0).node.get(N('Annots'))).get(0));
  assert.equal(third.context.lookup(thirdAnnot.get(N('OPS_UnknownAddonState'))).get(N('Stage')).decodeText(), 'reviewed');
  assert.equal(thirdAnnot.get(N('OPS_LegacyTextV1')).decodeText(), 'area-1');
  assert.equal(third.context.lookup(thirdAnnot.get(N('OPS_LegacyOpaqueV1'))).get(N('Raw')).decodeText(), 'opaque');
  assert.ok(third.catalog.get(N('OPS_ExtensionWorkspaceV1')));
});

test('a copied or mismatched model cannot claim another annotation private fields', async () => {
  const pdf = await PDFDocument.create();
  const source = pdf.context.obj({ Type: N('Annot'), Subtype: N('Square'),
    NM: PDFString.of('first'), X_PrivateState: PDFString.of('secret') });
  assert.equal(hasUnmodeledAnnotationKeys(source), true);
  assert.equal(hasUnmodeledAnnotationKeys(pdf.context.obj({
    Type: N('Annot'), Subtype: N('Square'), NM: PDFString.of('ordinary'),
  })), false);
  const ref = pdf.context.register(source);
  const target = pdf.context.obj({ Type: N('Annot'), Subtype: N('Square') });
  const meta = { ref: ref.toString(), modelId: 'original', nm: 'first' };
  assert.deepEqual(carryUnmodeledAnnotationKeys(pdf.context, [ref],
    { id: 'copy', pdfSource: meta }, target), []);
  assert.equal(target.get(N('X_PrivateState')), undefined);
  const intentionalRemoval = pdf.context.obj({ Type: N('Annot'), Subtype: N('Square') });
  carryUnmodeledAnnotationKeys(pdf.context, [ref],
    { id: 'original', pdfSource: meta }, intentionalRemoval, ['X_PrivateState']);
  assert.equal(intentionalRemoval.get(N('X_PrivateState')), undefined);
  assert.deepEqual(carryUnmodeledAnnotationKeys(pdf.context, [],
    { id: 'original', pdfSource: meta }, target), []);
  assert.equal(target.get(N('X_PrivateState')), undefined);
  assert.rejects(async () => carryUnmodeledAnnotationKeys(pdf.context, [ref],
    { id: 'original', pdfSource: { ...meta, nm: 'different' } }, target),
  /source changed/);
  assert.ok(ref instanceof PDFRef);
});

test('generic annotation extraction transports only declared add-on fields by reference', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const first = pdf.context.register(pdf.context.obj({
    Type: N('Annot'), Subtype: N('Square'), Rect: [10, 20, 50, 60],
    OPS_ExtensionField: PDFString.of('first'),
  }));
  const second = pdf.context.register(pdf.context.obj({
    Type: N('Annot'), Subtype: N('Square'), Rect: [10, 20, 50, 60],
    OPS_ExtensionField: PDFString.of('second'),
  }));
  page.node.set(N('Annots'), pdf.context.obj([first, second]));
  const opened = await PDFDocument.load(await pdf.save());
  const withoutAddon = await extractAnnotationColors(1, opened);
  assert.equal(withoutAddon.get(`@ref:${first.objectNumber}R`)?.extensionFields, undefined);
  const withAddon = await extractAnnotationColors(1, opened,
    { annotationKeys: ['OPS_ExtensionField'] });
  assert.equal(withAddon.get(`@ref:${first.objectNumber}R`).extensionFields.OPS_ExtensionField, 'first');
  assert.equal(withAddon.get(`@ref:${second.objectNumber}R`).extensionFields.OPS_ExtensionField, 'second');
});

test('oversized declared annotation field is skipped before decoding', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const key = N('ODX_sample_State');
  const annotation = pdf.context.obj({ Type: N('Annot'), Subtype: N('Square'), Rect: [10, 20, 50, 60],
    ODX_sample_State: PDFString.of('x'.repeat((16384 + 1) * 4 + 1)) });
  const ref = pdf.context.register(annotation);
  page.node.set(N('Annots'), pdf.context.obj([ref]));
  const opened = await PDFDocument.load(await pdf.save());
  const loaded = opened.context.lookup(opened.context.lookup(opened.getPage(0).node.get(N('Annots'))).get(0));
  loaded.get(key).decodeText = () => { throw new Error('decoded oversized annotation value'); };
  const colors = await extractAnnotationColors(1, opened, { annotationKeys: ['ODX_sample_State'] });
  assert.equal(colors.get(`@ref:${ref.objectNumber}R`)?.extensionFields, undefined);
  loaded.set(key, PDFHexString.fromText('😀'.repeat(5000)));
  const utf8Oversized = await extractAnnotationColors(1, opened, { annotationKeys: ['ODX_sample_State'] });
  assert.equal(utf8Oversized.get(`@ref:${ref.objectNumber}R`)?.extensionFields, undefined,
    'decoded UTF-8 bytes, not just JavaScript length, set the limit');
});
