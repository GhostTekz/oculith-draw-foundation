// Time RBush snap queries against a linear edge-bbox scan on one dense page
// of the conduit sheet. Not part of the unit-test list. The PDF stays outside
// the repository: pass its path as the first argument (or set BENCH_PDF).

import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { performance } from 'node:perf_hooks';

register('../js/core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../js/core/app-test-hooks.mjs');
installeerBrowserStubs();

const PDF = process.argv[2] || process.env.BENCH_PDF;
if (!PDF) {
  console.error('Usage: node scripts/bench-conduit-snap.mjs <conduit-sheet.pdf>');
  process.exit(2);
}
const QUERIES = 1000;
const RADIUS = 12;

const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { state, getActiveDocument } = await import('../js/core/state.js');
const { extractPageGeometry, searchPdfSnapIndex } = await import('../js/tools/pdf-snap-extractor.js');

function linearCount(edges, x, y, radius) {
  const minX = x - radius;
  const minY = y - radius;
  const maxX = x + radius;
  const maxY = y + radius;
  let n = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const eMinX = e.x1 < e.x2 ? e.x1 : e.x2;
    const eMaxX = e.x1 < e.x2 ? e.x2 : e.x1;
    const eMinY = e.y1 < e.y2 ? e.y1 : e.y2;
    const eMaxY = e.y1 < e.y2 ? e.y2 : e.y1;
    if (eMaxX >= minX && eMinX <= maxX && eMaxY >= minY && eMinY <= maxY) n++;
  }
  return n;
}

const bytes = new Uint8Array(await readFile(PDF));
const task = getDocument({ data: bytes, verbosity: 0, isEvalSupported: false });
try {
  const pdf = await task.promise;
  const pages = pdf.numPages;
  let best = 1;
  let bestOps = -1;
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const opList = await page.getOperatorList();
    let n = 0;
    const fn = opList.fnArray;
    for (let i = 0; i < fn.length; i++) {
      if (fn[i] === OPS.constructPath || fn[i] === OPS.rectangle) n++;
    }
    console.log(`probe page ${p}: vectorOps ${n} ops ${fn.length}`);
    if (n > bestOps) {
      bestOps = n;
      best = p;
    }
  }

  const page = await pdf.getPage(best);
  const vp = page.getViewport({ scale: 1 });
  // Same object as the active document: the extractor aborts when the
  // passed document is not the one currently open. No filePath, so the
  // raster-page skip does not run.
  const fake = { pdfDoc: pdf, pageRotations: {} };
  state.documents = [fake];
  state.activeDocumentIndex = 0;
  // createMutable hands back a proxy. The extractor aborts unless the
  // document argument is that same object.
  const doc = getActiveDocument();
  if (doc?.pdfDoc !== pdf) throw new Error('active document did not keep the loaded PDF');
  console.log(`extracting page ${best}`);
  const extracted = await extractPageGeometry(best, { document: doc });
  console.log('extract done');
  const edges = extracted.edges || [];
  const points = extracted.points || [];
  const index = extracted.index;
  if (!index?.edgeTree || !index?.pointTree) {
    throw new Error('extractor returned no RBush index');
  }

  let seed = 0xC0FFEE;
  const rand = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const queries = new Array(QUERIES);
  for (let i = 0; i < QUERIES; i++) queries[i] = [rand() * vp.width, rand() * vp.height];

  searchPdfSnapIndex(index, queries[0][0], queries[0][1], RADIUS);
  linearCount(edges, queries[0][0], queries[0][1], RADIUS);

  let rbushHits = 0;
  const t0 = performance.now();
  for (let i = 0; i < queries.length; i++) {
    rbushHits += searchPdfSnapIndex(index, queries[i][0], queries[i][1], RADIUS).edges.length;
  }
  const rbushMs = performance.now() - t0;

  let linearHits = 0;
  const t1 = performance.now();
  for (let i = 0; i < queries.length; i++) {
    linearHits += linearCount(edges, queries[i][0], queries[i][1], RADIUS);
  }
  const linearMs = performance.now() - t1;

  console.log(JSON.stringify({
    pages,
    page: best,
    pageWidth: vp.width,
    pageHeight: vp.height,
    edges: edges.length,
    points: points.length,
    queries: QUERIES,
    radius: RADIUS,
    rbushMs,
    linearMs,
    rbushHits,
    linearHits,
  }, null, 2));
} catch (err) {
  console.error('EXTRACTION_FAILED');
  console.error(err?.stack || err);
  process.exitCode = 1;
} finally {
  await task.destroy().catch(() => {});
}
