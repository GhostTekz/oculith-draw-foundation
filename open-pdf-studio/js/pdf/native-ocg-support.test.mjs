// PDF layers PDFium cannot show switched are found before a change: the
// support check on real pdf-lib bytes, the panel rows it disables, and the
// selection refusing a change (docs/foundation/PDF-LAYERS.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { ocgRenderSupport, OCG_UNSUPPORTED_REASONS } from './native-ocg-support.js';
import { assertViewSupported, layerPanelRows, OcgViewUnsupported } from './native-ocg-view.js';
import { readCatalogFields } from './pdf-lib-catalog.js';

/** A one-page PDF with two layers; `shape(ctx, { oc, d, groups })` changes its structure. */
async function layeredPdf(shape = () => {}) {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const ctx = pdf.context;
  const groups = ['A-WALL', 'E-LITE'].map(name => ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(name) })));
  const d = ctx.obj({ ON: groups, OFF: [] });
  const oc = ctx.obj({ OCGs: groups, D: d });
  pdf.catalog.set(PDFName.of('OCProperties'), oc);
  shape(ctx, { oc, d, groups, pdf });
  // Real bytes: what the loader reads.
  return PDFDocument.load(await pdf.save({ useObjectStreams: false }), { ignoreEncryption: true });
}

test('ordinary catalog layers, and a PDF without layers, can be switched', async () => {
  assert.deepEqual(ocgRenderSupport(await layeredPdf()), { supported: true });
  const plain = await PDFDocument.create();
  plain.addPage();
  assert.deepEqual(ocgRenderSupport(await PDFDocument.load(await plain.save())), { supported: true });
  // A BaseState of ON or OFF is fine.
  assert.equal(ocgRenderSupport(await layeredPdf((ctx, { d }) => d.set(PDFName.of('BaseState'), PDFName.of('OFF')))).supported, true);
});

test('each structure the render copy refuses is reported with its reason', async () => {
  const cases = {
    indirectProperties: (ctx, { oc, pdf }) => pdf.catalog.set(PDFName.of('OCProperties'), ctx.register(oc)),
    configs: (ctx, { oc }) => oc.set(PDFName.of('Configs'), ctx.obj([ctx.obj({ ON: [] })])),
    indirectDefault: (ctx, { oc, d }) => oc.set(PDFName.of('D'), ctx.register(d)),
    autoState: (ctx, { d, groups }) => d.set(PDFName.of('AS'), ctx.obj([ctx.obj({ Event: 'View', OCGs: groups, Category: ['View'] })])),
    radioGroups: (ctx, { d, groups }) => d.set(PDFName.of('RBGroups'), ctx.obj([groups])),
    locked: (ctx, { d, groups }) => d.set(PDFName.of('Locked'), ctx.obj([groups[0]])),
    baseState: (ctx, { d }) => d.set(PDFName.of('BaseState'), PDFName.of('Unchanged')),
    malformed: (ctx, { oc }) => oc.delete(PDFName.of('D')),
  };
  for (const [reason, shape] of Object.entries(cases)) {
    assert.ok(OCG_UNSUPPORTED_REASONS.includes(reason));
    assert.deepEqual(ocgRenderSupport(await layeredPdf(shape)), { supported: false, reason }, reason);
  }
  // An indirect ON array is not read by the render copy either.
  const onRef = await layeredPdf((ctx, { d, groups }) => d.set(PDFName.of('ON'), ctx.register(ctx.obj(groups))));
  assert.deepEqual(ocgRenderSupport(onRef), { supported: false, reason: 'malformed' });
});

test('an encrypted PDF is reported, and the catalog read carries the result', async () => {
  const encrypted = await layeredPdf((ctx) => {
    ctx.trailerInfo.Encrypt = ctx.register(ctx.obj({ Filter: 'Standard', V: 1, R: 2, O: PDFString.of('x'), U: PDFString.of('y'), P: -4 }));
  });
  assert.deepEqual(ocgRenderSupport(encrypted), { supported: false, reason: 'encrypted' });
  assert.deepEqual(readCatalogFields(await layeredPdf()).ocgRenderSupport, { supported: true });
  assert.deepEqual(readCatalogFields(encrypted).ocgRenderSupport, { supported: false, reason: 'encrypted' });
});

test('the panel rows lose their toggles when the view cannot be shown', () => {
  const regels = [{ kop: true, name: 'E', depth: 0 }, { id: '5R', name: 'E-LITE', depth: 1, visible: true }];
  const states = [{ id: '5R', name: 'E-LITE', defaultVisible: true, visible: true }];
  assert.deepEqual(layerPanelRows(regels, states).map(r => [r.toggleable, r.children]), [[undefined, ['5R']], [true, undefined]]);
  const off = layerPanelRows(regels, states, { supported: false, reason: 'locked' });
  assert.deepEqual(off.map(r => [r.toggleable, r.children]), [[undefined, []], [false, undefined]]);
  // An unknown answer keeps the toggles (as before the check).
  assert.equal(layerPanelRows(regels, states, null)[1].toggleable, true);
});

test('a layer change is refused when the view cannot be shown; the default always passes', () => {
  const hidden = new Map([['5R', false]]);
  assert.throws(() => assertViewSupported(hidden, { supported: false, reason: 'radioGroups' }),
    (error) => error instanceof OcgViewUnsupported && error.name === 'OcgViewUnsupported' && error.reason === 'radioGroups');
  assert.doesNotThrow(() => assertViewSupported(new Map(), { supported: false, reason: 'radioGroups' }));
  assert.doesNotThrow(() => assertViewSupported(hidden, { supported: true }));
  assert.doesNotThrow(() => assertViewSupported(hidden, null));
});
