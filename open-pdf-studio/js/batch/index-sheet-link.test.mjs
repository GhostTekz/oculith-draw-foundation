import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName, PDFArray, PDFDict, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { batchFileList, runBatch } from './runner.js';
import { fingerprintPdfBytes } from '../sets/pdf-fingerprint.js';
import { planIndexSheetLinks, setLinkScanJob, setLinkWriteJob,
  verifySetLinkPreviewSources } from './set-link.js';

async function drawing(index = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([1000, 700]);
  if (index) {
    for (const [id, title, y] of [['A-101', 'FIRST FLOOR PLAN', 600],
      ['S-201', 'STRUCTURAL PLAN', 570], ['D-301', 'ROOF PLAN', 540],
      ['D-301', 'PENTHOUSE PLAN', 510], ['X-999', 'UNREGISTERED PLAN', 480]]) {
      page.drawText(id, { x: 50, y, font, size: 12 });
      page.drawText(title, { x: 200, y, font, size: 12 });
    }
    const second = pdf.addPage([1000, 700]);
    second.drawText('A-101', { x: 50, y: 600, font, size: 12 });
  } else {
    page.drawText('S-201', { x: 50, y: 600, font, size: 12 });
    pdf.addPage([1000, 700]).drawText('D-301', { x: 50, y: 600, font, size: 12 });
  }
  return new Uint8Array(await pdf.save());
}

test('index links cover only exact row IDs, and create guarded local and relative PDF links', async () => {
  const indexBytes = await drawing(true);
  const targetBytes = await drawing(false);
  const indexHash = await fingerprintPdfBytes(indexBytes);
  const targetHash = await fingerprintPdfBytes(targetBytes);
  const paths = ['/set/Index.pdf', '/set/S.pdf'];
  const files = batchFileList(paths);
  const bytes = new Map([[paths[0], indexBytes], [paths[1], targetBytes]]);
  const register = { version: 1, sheets: [
    { id: 'index', label: 'I-001', filePath: paths[0], page: 1, sourceSha256: indexHash },
    { id: 'arch', label: 'A-101', filePath: paths[0], page: 2, sourceSha256: indexHash },
    { id: 'struct', label: 'S-201', filePath: paths[1], page: 1, sourceSha256: targetHash },
    { id: 'detail', label: 'D-301', filePath: paths[1], page: 2, sourceSha256: targetHash },
  ] };
  const source = { ...register.sheets[0] };
  const scanned = await runBatch({ files, readFile: path => bytes.get(path),
    job: setLinkScanJob({ pdfjs, fingerprint: true }) });
  assert(scanned.log.every(entry => entry.ok));
  const scans = files.map(file => scanned.output.byPath.get(file.path.toLocaleLowerCase()));
  const plan = planIndexSheetLinks(scans, files, register, source);
  assert.deepEqual(plan.links.map(link => [link.label, link.file, link.page,
    link.target.file, link.target.page]), [
    ['A-101', 0, 1, 0, 2], ['S-201', 0, 1, 1, 1],
  ]);
  assert(plan.links.every(link => link.rect.x + link.rect.width < 150), 'only sheet ID glyphs are linked');
  assert.equal(plan.review.find(row => row.label === 'D-301').status, 'ambiguous-target');
  assert.equal(plan.review.find(row => row.label === 'X-999').status, 'unregistered-target');
  assert.equal(planIndexSheetLinks(scans, files, { ...register, sheets: register.sheets.map(sheet =>
    sheet.id === 'struct' ? { ...sheet, sourceSha256: null } : sheet) }, source)
    .review.find(row => row.label === 'S-201').status, 'unverified-target');
  assert.throws(() => planIndexSheetLinks(scans, files, register,
    { ...source, sourceSha256: targetHash }), /selected index sheet changed/u);
  assert.throws(() => planIndexSheetLinks([{ ...scans[0], fingerprint: targetHash }, scans[1]],
    files, register, source), /index PDF is missing or changed/u);
  assert.throws(() => planIndexSheetLinks(scans, [files[0], { ...files[0], path: '/set/index.pdf' }, files[1]],
    register, source), /paths that differ only by case/u);
  assert.throws(() => planIndexSheetLinks(scans, [{ ...files[0], path: '/set/index.pdf' }, files[1]],
    register, source), /index PDF is missing or changed/u);
  assert.equal(planIndexSheetLinks(scans, [files[0], { ...files[1], path: '/set/s.pdf' }],
    register, source).review.find(row => row.label === 'S-201').status, 'missing-target');
  assert.throws(() => planIndexSheetLinks(scans, files,
    { ...register, sheets: [...register.sheets, { ...register.sheets[2], id: 'case', filePath: '/set/s.pdf' }] },
    source), /Registered PDF paths differ only by case/u);
  assert.throws(() => planIndexSheetLinks([{ ...scans[0], pages: [] }, scans[1]], files,
    register, source), /complete selectable text scan/u);
  await assert.rejects(verifySetLinkPreviewSources(files, scans, path =>
    path === paths[1] ? drawing(true) : bytes.get(path)), /changed since Find/u);

  const output = await runBatch({ files, readFile: path => bytes.get(path),
    job: setLinkWriteJob({ files, plan, rel: ['Index.pdf', 'S.pdf'], mode: 'create' }) });
  assert.deepEqual(output.log.map(entry => entry.detail.added), [2, 0]);
  assert.equal(await fingerprintPdfBytes(bytes.get(paths[0])), indexHash, 'source index stays unchanged');
  const linked = await PDFDocument.load(output.output[0].bytes);
  const annots = linked.getPages()[0].node.lookup(PDFName.of('Annots'), PDFArray);
  assert.equal(annots.size(), 2);
  const local = linked.context.lookup(annots.get(0), PDFDict);
  const remote = linked.context.lookup(annots.get(1), PDFDict);
  assert.equal(local.lookup(PDFName.of('Dest'), PDFArray).get(0), linked.getPages()[1].ref);
  assert.equal(remote.lookup(PDFName.of('A'), PDFDict).get(PDFName.of('S')).toString(), '/GoToR');
});
