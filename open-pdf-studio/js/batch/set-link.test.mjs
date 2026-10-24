// Set Batch Link on real PDF bytes: three files (A-, S-, M- sheets) in
// sibling folders, through the runner. "SEE S-201" on an A sheet becomes a
// /GoToR with a relative file spec and the page index; a reference inside a
// file stays a /Dest. The written folder is moved and every link still
// resolves to the labelled sheet. Remove deletes only the batch links;
// bookmarks equal the labels in page order. Plus the path rules of
// remote-link.js and the output writer's refusals.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { state } = await import('../core/state.js');
const { savePDF } = await import('../pdf/saver.js');
const { convertPdfAnnotation } = await import('../pdf/loader/annotation-converter.js');
const { extractAnnotationColors } = await import('../pdf/loader/color-extraction.js');
const { writePageLabels } = await import('../pdf/page-labels.js');
const { runBatch, batchFileList } = await import('./runner.js');
const {
  setLinkScanJob, setLinkWriteJob, planSetLinks, setLinkTargets, setOutputLayout, writeSetOutputs, setOutputPath,
} = await import('./set-link.js');
const {
  isSafeRelativePdfPath, relativePdfPath, resolveRelativePdfPath, parseRemotePdfLink, commonDirectory, isInsideDirectory, pathInside,
} = await import('../pdf/remote-link.js');

test('relative PDF paths: only plain relative paths to a .pdf', () => {
  for (const ok of ['S.pdf', '../struct/S-201.PDF', 'a b/(rev 2).pdf']) assert.ok(isSafeRelativePdfPath(ok), ok);
  for (const bad of ['', '/etc/x.pdf', 'C:/x.pdf', 'file:x.pdf', 'a\\b.pdf', 'x.exe', 'a//b.pdf', './a.pdf', 'a/../..', `a\u0000.pdf`, '..']) {
    assert.ok(!isSafeRelativePdfPath(bad), bad);
  }
  assert.equal(relativePdfPath('arch/A.pdf', 'struct/S.pdf'), '../struct/S.pdf');
  assert.equal(relativePdfPath('A.pdf', 'S.pdf'), 'S.pdf');
  assert.equal(relativePdfPath('a/b/A.pdf', 'a/S.pdf'), '../S.pdf');
  assert.equal(relativePdfPath('A.pdf', 'sub/S.pdf'), 'sub/S.pdf');
  assert.equal(resolveRelativePdfPath('/p/set/arch/A.pdf', '../struct/S.pdf'), '/p/set/struct/S.pdf');
  assert.equal(resolveRelativePdfPath('C:\\p\\arch\\A.pdf', '../S.pdf'), 'C:\\p\\S.pdf');
  assert.equal(resolveRelativePdfPath('/A.pdf', '../S.pdf'), null, 'cannot climb above the root');
  assert.equal(resolveRelativePdfPath('/p/A.pdf', '/etc/S.pdf'), null);
  assert.equal(commonDirectory(['/p/set/arch/A.pdf', '/p/set/struct/S.pdf']), '/p/set');
  assert.equal(commonDirectory(['C:/p/A.pdf', 'c:/P/b/S.pdf']), 'C:/p');
  assert.equal(commonDirectory(['C:/p/A.pdf', 'D:/p/S.pdf']), '');
  assert.equal(pathInside('/p/set/arch/A.pdf', '/p/set'), 'arch/A.pdf');
  assert.ok(isInsideDirectory('/p/set/x/../arch/A.pdf', '/p/set'));
  assert.ok(!isInsideDirectory('/p/set/../other/A.pdf', '/p/set'));
  assert.ok(!isInsideDirectory('/p/settle/A.pdf', '/p/set'));
});

test('PDF.js remote targets parse to a file and a page or a named destination', () => {
  assert.deepEqual(parseRemotePdfLink('../S.pdf#[1,{"name":"Fit"}]'), { file: '../S.pdf', page: 2 });
  assert.deepEqual(parseRemotePdfLink('S.pdf#S-201'), { file: 'S.pdf', dest: 'S-201' });
  assert.deepEqual(parseRemotePdfLink('S.pdf#page=3'), { file: 'S.pdf', page: 3 });
  assert.deepEqual(parseRemotePdfLink('S.pdf'), { file: 'S.pdf', page: 1 });
  assert.equal(parseRemotePdfLink('https://x.test/S.pdf'), null);
  assert.equal(parseRemotePdfLink('javascript:alert(1)'), null);
  assert.equal(parseRemotePdfLink('/abs/S.pdf#[0]'), null);
});

test('targets: a label used in two files has no single target', () => {
  const { targets, ambiguous } = setLinkTargets([{ labels: ['A-101', '2'] }, null, { labels: ['A-101', 'S-1'] }]);
  assert.deepEqual([...targets], [['S-1', { file: 2, page: 2 }]]);
  assert.deepEqual(ambiguous, [{ label: 'A-101', places: [{ file: 0, page: 1 }, { file: 2, page: 1 }] }]);
});

// Sheets: [label, texts...] per page.
const SET = {
  'arch/A.pdf': [['A-101', 'SEE S-201', 'DETAIL 3/A-102'], ['A-102', 'SEE M-301 AND S-202']],
  'struct/S.pdf': [['S-201', 'SEE A-101'], ['S-202', 'SEE 5/S-201']],
  'mech/M.pdf': [['M-301', 'REFER TO A-102']],
};
const LABELS = Object.values(SET).flatMap((pages) => pages.map((p) => p[0]));

async function sheetFile(pages) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [label, ...texts] of pages) {
    const page = pdf.addPage([792, 612]);
    page.drawText(label, { x: 680, y: 40, size: 16, font });
    texts.forEach((text, i) => page.drawText(text, { x: 60, y: 500 - 40 * i, size: 12, font }));
  }
  writePageLabels(pdf, pages.map((p) => p[0]));
  return pdf.save();
}

async function linksOf(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const ctx = pdf.context;
  return pdf.getPages().flatMap((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    return (annots ? annots.asArray() : []).map((ref) => ({ page: i + 1, dict: ctx.lookup(ref), ctx, pdf }));
  }).filter(({ dict }) => dict.get(PDFName.of('Subtype'))?.toString() === '/Link');
}

const text = (obj) => (obj?.decodeText ? obj.decodeText() : String(obj));

async function openPdfjs(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 });
  return { task, doc: await task.promise };
}

test('a 3-file set: /GoToR between files, /Dest inside one, relative paths survive a move, Remove and bookmarks', async () => {
  const work = await mkdtemp(join(tmpdir(), 'set-link-'));
  try {
    const srcRoot = join(work, 'project', 'set');
    const sources = {};
    for (const [rel, pages] of Object.entries(SET)) {
      const path = join(srcRoot, rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await sheetFile(pages));
      sources[rel] = path;
    }
    const files = batchFileList(Object.values(sources));
    const readSource = async (path) => new Uint8Array(await readFile(path));

    // 1. Scan every file, then plan over the whole set.
    const scan = await runBatch({ files, readFile: readSource, job: setLinkScanJob({ pdfjs }) });
    assert.equal(scan.cancelled, false);
    assert.ok(scan.log.every((e) => e.ok));
    const scans = files.map((f) => scan.output.byPath.get(f.path.replace(/\\/g, '/').toLocaleLowerCase()) || null);
    const plan = planSetLinks(scans, {});
    const names = ['A', 'S', 'M'];
    assert.deepEqual(plan.links.map((l) => [names[l.file], l.page, l.text, names[l.target.file], l.target.page]), [
      ['A', 1, 'S-201', 'S', 1], ['A', 1, '3/A-102', 'A', 2],
      ['A', 2, 'M-301', 'M', 1], ['A', 2, 'S-202', 'S', 2],
      ['S', 1, 'A-101', 'A', 1], ['S', 2, '5/S-201', 'S', 1],
      ['M', 1, 'A-102', 'A', 2],
    ]);
    assert.equal(plan.skipped.filter((s) => s.reason === 'self').length, 5, 'title blocks');

    // 2. Write into an output folder that mirrors the set layout.
    const { root, rel } = setOutputLayout(files.map((f) => f.path));
    assert.equal(root.replace(/\\/g, '/'), srcRoot.replace(/\\/g, '/'));
    assert.deepEqual(rel, ['arch/A.pdf', 'struct/S.pdf', 'mech/M.pdf']);
    const run = await runBatch({
      files, readFile: readSource,
      job: setLinkWriteJob({ files, plan, rel, mode: 'create', bookmarks: true, options: { color: '#e11d48' } }),
    });
    assert.deepEqual(run.log.map((e) => [e.detail.added, e.detail.bookmarks]), [[4, 2], [2, 2], [1, 1]]);
    const outDir = join(work, 'linked');
    const fsWrite = async (path, bytes) => writeFile(path, bytes);
    const fsExists = async (path) => access(path).then(() => true, () => false);
    const fsMkdir = async (path) => mkdir(path, { recursive: true });
    await assert.rejects(writeSetOutputs(run.output, { dir: srcRoot, sources: files, write: fsWrite, exists: fsExists }), /source files/);
    await writeSetOutputs(run.output, { dir: outDir, sources: files, write: fsWrite, exists: fsExists, mkdir: fsMkdir });
    await assert.rejects(writeSetOutputs(run.output, { dir: outDir, sources: files, write: fsWrite, exists: fsExists }), /already has 3/);
    // The sources are untouched.
    assert.equal((await linksOf(await readSource(sources['arch/A.pdf']))).length, 0);

    // 3. Move the whole output folder: the links are relative.
    const moved = join(work, 'elsewhere', 'linked-set');
    await mkdir(dirname(moved), { recursive: true });
    await rename(outDir, moved);
    const aPath = join(moved, 'arch', 'A.pdf');
    const aBytes = await readSource(aPath);

    // pdf-lib: the saved structure.
    const aLinks = await linksOf(aBytes);
    assert.equal(aLinks.length, 4);
    const seeS = aLinks[0];
    assert.equal(String(seeS.dict.get(PDFName.of('OPS_BatchLink'))), 'true');
    const action = seeS.dict.lookup(PDFName.of('A'), PDFDict);
    assert.equal(action.get(PDFName.of('S')).toString(), '/GoToR');
    const spec = action.lookup(PDFName.of('F'), PDFDict);
    assert.equal(text(spec.get(PDFName.of('F'))), '../struct/S.pdf');
    assert.equal(text(spec.get(PDFName.of('UF'))), '../struct/S.pdf');
    const d = action.lookup(PDFName.of('D'), PDFArray);
    assert.equal(d.lookup(0).asNumber(), 0, 'S-201 is page index 0');
    assert.equal(d.lookup(1).toString(), '/Fit');
    assert.equal(String(action.get(PDFName.of('NewWindow'))), 'true');
    const local = aLinks[1].dict;
    assert.equal(local.get(PDFName.of('A')), undefined);
    assert.equal(local.lookup(PDFName.of('Dest'), PDFArray).get(0), aLinks[1].pdf.getPages()[1].ref, '3/A-102 -> page 2 of A');

    // PDF.js (what a third-party viewer reads): the action, the relative file and the destination.
    const { task, doc } = await openPdfjs(aBytes);
    const followed = [];
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const colors = await extractAnnotationColors(p, await PDFDocument.load(aBytes));
        for (const a of await page.getAnnotations()) {
          if (a.subtype !== 'Link') continue;
          if (a.dest) { followed.push(['dest', p, await doc.getPageIndex(a.dest[0]) + 1]); continue; }
          assert.equal(a.url, undefined, 'a relative file is no web address');
          assert.equal(a.newWindow, true);
          const target = parseRemotePdfLink(a.unsafeUrl);
          const path = resolveRelativePdfPath(aPath, target.file);
          const { task: t2, doc: other } = await openPdfjs(await readSource(path));
          try { followed.push(['remote', p, target.file, (await other.getPageLabels())[target.page - 1]]); } finally { await t2.destroy(); }
          // The app reads it back as the same Batch Link markup, with its file.
          const model = await convertPdfAnnotation(a, p, page.getViewport({ scale: 1 }), new Map(), colors);
          assert.equal(model.type, 'hyperlink');
          assert.equal(model.batchLink, true);
          assert.equal(model.linkUrl, '');
          assert.equal(model.linkFile, target.file);
          assert.equal(model.linkPage, target.page);
        }
      }
      // Bookmarks: the labels, in page order.
      const outline = await doc.getOutline();
      assert.deepEqual(outline.map((o) => o.title), ['A-101', 'A-102']);
      const pagesOf = await Promise.all(outline.map(async (o) => await doc.getPageIndex(o.dest[0]) + 1));
      assert.deepEqual(pagesOf, [1, 2]);
    } finally {
      await task.destroy();
    }
    assert.deepEqual(followed, [
      ['remote', 1, '../struct/S.pdf', 'S-201'], ['dest', 1, 2],
      ['remote', 2, '../mech/M.pdf', 'M-301'], ['remote', 2, '../struct/S.pdf', 'S-202'],
    ]);

    // 4. The app's own saver keeps a /GoToR markup a /GoToR.
    const models = [];
    {
      const { task: t3, doc: d3 } = await openPdfjs(aBytes);
      try {
        for (let p = 1; p <= d3.numPages; p++) {
          const page = await d3.getPage(p);
          const colors = await extractAnnotationColors(p, await PDFDocument.load(aBytes));
          for (const a of await page.getAnnotations()) {
            const m = await convertPdfAnnotation(a, p, page.getViewport({ scale: 1 }), new Map(), colors);
            if (m) models.push(m);
          }
        }
      } finally { await t3.destroy(); }
    }
    let resaved;
    globalThis.__saverTest = { impl: {
      getCachedPdfBytes: () => aBytes,
      writeBinaryFile: (_p, data) => { resaved = data; return true; },
      writeBinaryFileAtomic: (_p, data) => { resaved = data; return true; },
    } };
    state.documents = [{ id: 'set-link', filePath: aPath, pdfDoc: {}, annotations: models, pageRotations: {},
      _annotationPagesReady: new Set([1, 2]), textEdits: [], bookmarks: [] }];
    state.activeDocumentIndex = 0;
    assert.equal(await savePDF(aPath, { zonderHandtekeningVraag: true }), true);
    const again = await linksOf(resaved);
    const remote = again.filter(({ dict }) => dict.lookupMaybe(PDFName.of('A'), PDFDict)?.get(PDFName.of('S'))?.toString() === '/GoToR');
    assert.equal(remote.length, 3);
    assert.equal(text(remote[0].dict.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('F'), PDFDict).get(PDFName.of('F'))), '../struct/S.pdf');

    // 5. Remove over the moved set: only the batch links go.
    const withManual = await PDFDocument.load(aBytes);
    const manual = withManual.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [5, 5, 60, 20], Border: [0, 0, 0],
      A: withManual.context.obj({ S: 'URI', URI: 'https://example.com/' }) });
    withManual.getPages()[0].node.addAnnot(withManual.context.register(manual));
    await writeFile(aPath, await withManual.save());
    const movedFiles = batchFileList(rel.map((r) => join(moved, r)));
    const removal = await runBatch({ files: movedFiles, readFile: readSource, job: setLinkWriteJob({ files: movedFiles, plan: null, rel, mode: 'remove' }) });
    assert.deepEqual(removal.log.map((e) => e.detail.removed), [4, 2, 1]);
    const left = await linksOf(removal.output[0].bytes);
    assert.equal(left.length, 1);
    assert.equal(text(left[0].dict.lookup(PDFName.of('A'), PDFDict).get(PDFName.of('URI'))), 'https://example.com/');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('output layout: flat names collide, a failed file is reported and the rest still plans', async () => {
  assert.throws(() => setOutputLayout(['/a/x/S.pdf', '/a/y/S.pdf'], { flat: true }), /Two files/);
  assert.deepEqual(setOutputLayout(['/a/x/A.pdf', '/a/y/S.pdf'], { flat: true }).rel, ['A.pdf', 'S.pdf']);
  assert.equal(setOutputPath('C:\\out', 'arch/A.pdf'), 'C:\\out\\arch\\A.pdf');
  assert.equal(setOutputPath('', 'arch/A.pdf'), 'A.pdf');
  const bytes = {
    '/s/A.pdf': await sheetFile(SET['arch/A.pdf']),
    '/s/bad.pdf': new TextEncoder().encode('%PDF-1.7 not really'),
    '/s/S.pdf': await sheetFile(SET['struct/S.pdf']),
  };
  const files = batchFileList(Object.keys(bytes));
  const scan = await runBatch({ files, readFile: async (p) => bytes[p], job: setLinkScanJob({ pdfjs }) });
  assert.deepEqual(scan.log.map((e) => e.ok), [true, false, true]);
  const scans = files.map((f) => scan.output.byPath.get(f.path.toLocaleLowerCase()) || null);
  const plan = planSetLinks(scans, {});
  // M-301 is not in this list: no link for it.
  assert.ok(!plan.links.some((l) => l.label === 'M-301'));
  assert.ok(plan.links.some((l) => l.label === 'S-201' && l.file === 0 && l.target.file === 2));
  assert.equal(LABELS.length, 5);
});
