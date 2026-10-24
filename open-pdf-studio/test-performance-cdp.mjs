// REAL performance test — measures what the user actually experiences
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const TEST_PDF = String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;

(async () => {
  console.log('=== REAL Performance Test ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) { console.log('❌ No page'); process.exit(1); }

  const allLogs = [];
  page.on('console', msg => {
    allLogs.push({ type: msg.type(), text: msg.text(), time: Date.now() });
  });

  // Step 1: Open PDF
  console.log('1. Opening PDF...');
  const t0 = Date.now();
  await page.evaluate(async (path) => {
    await window.__TAURI__.core.invoke('allow_fs_scope', { path });
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    createTab(path);
    await loadPDF(path, state.activeDocumentIndex);
  }, TEST_PDF);
  const openTime = Date.now() - t0;
  console.log(`   Open + first render: ${openTime}ms`);

  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'perf-1-loaded.png' });

  // Step 2: Measure what engine is being used
  const engineInfo = await page.evaluate(() => {
    const { state } = window.__APP__ || {};
    // Read from DOM
    const statusBar = document.querySelector('.status-bar-right');
    return {
      engineText: statusBar?.textContent || 'unknown',
      renderEngine: document.querySelector('[title]')?.title || 'unknown',
    };
  });
  console.log(`   Engine: ${engineInfo.engineText}`);

  // Step 3: Rapid zoom test — simulate 10 Ctrl+wheel events
  console.log('\n2. Rapid zoom test (10 events in 500ms)...');
  const box = await page.locator('#pdf-canvas, .annotation-canvas').first().boundingBox();
  if (!box) { console.log('   ❌ No canvas found'); }

  const zoomT0 = Date.now();
  for (let i = 0; i < 10; i++) {
    await page.evaluate(({ x, y }) => {
      document.querySelector('.main-view')?.dispatchEvent(new WheelEvent('wheel', {
        clientX: x, clientY: y, deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true
      }));
    }, { x: (box?.x || 400) + 200, y: (box?.y || 300) + 200 });
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1000); // Wait for any debounced render
  const zoomTime = Date.now() - zoomT0;
  console.log(`   10 zoom events + settle: ${zoomTime}ms`);
  await page.screenshot({ path: 'perf-2-zoomed.png' });

  // Step 4: Measure single zoom render time
  console.log('\n3. Single zoom render measurement...');
  const singleZoom = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    if (!doc) return { error: 'no doc' };

    // Time a single renderPage call
    const renderer = await import('/js/pdf/renderer.js');
    const t0 = performance.now();
    doc.scale = 2.0;
    await renderer.renderPage(doc.currentPage || 1);
    const renderTime = Math.round(performance.now() - t0);

    return {
      renderTime,
      engine: state.renderEngine,
      timing: state.renderTiming,
      scale: doc.scale,
    };
  });
  console.log(`   renderPage() time: ${singleZoom.renderTime}ms`);
  console.log(`   Engine: ${singleZoom.engine}, Timing: ${singleZoom.timing}`);

  // Step 5: Measure what happens AFTER renderPage (text layers, annotations, etc)
  console.log('\n4. Breakdown: what takes time after render...');
  const breakdown = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    if (!doc?.pdfDoc) return { error: 'no doc' };

    const results = {};

    // Time just the vector render part
    const vr = await import('/js/pdf/vector-renderer.js');
    if (vr.hasCachedCommands(doc.filePath, doc.currentPage)) {
      const canvas = document.getElementById('pdf-canvas');
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;

      const t0 = performance.now();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const dims = vr.getCachedPageDimensions(doc.filePath, doc.currentPage);
      const transform = { a: doc.scale * dpr, b: 0, c: 0, d: doc.scale * dpr, e: 0, f: 0 };
      vr.renderVectorPage(ctx, doc.filePath, doc.currentPage, transform);
      results.vectorRedraw = Math.round(performance.now() - t0);
    } else {
      results.vectorRedraw = 'N/A (no cached commands)';
    }

    // Time annotation redraw
    const t1 = performance.now();
    const rendering = await import('/js/annotations/rendering.js');
    rendering.redrawAnnotations();
    results.annotationRedraw = Math.round(performance.now() - t1);

    // Time text layer
    const t2 = performance.now();
    // Text layer is created during renderPage — we can't easily isolate it
    results.note = 'text/link/form layers are created inside renderPage()';

    return results;
  });
  console.log(`   Vector redraw only: ${breakdown.vectorRedraw}ms`);
  console.log(`   Annotation redraw: ${breakdown.annotationRedraw}ms`);

  // Step 6: Check what the FULL renderPage does
  console.log('\n5. Full renderPage trace...');
  const fullTrace = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    if (!doc?.pdfDoc) return { error: 'no doc' };

    const timings = [];
    const origLog = console.log;
    console.log = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('[render]')) timings.push({ t: performance.now(), msg });
      origLog.apply(console, args);
    };

    doc.scale = 1.5;
    const t0 = performance.now();
    const renderer = await import('/js/pdf/renderer.js');
    await renderer.renderPage(doc.currentPage || 1);
    const total = Math.round(performance.now() - t0);

    console.log = origLog;

    return {
      total,
      timings: timings.map(t => ({ ...t, t: Math.round(t.t - (timings[0]?.t || 0)) })),
    };
  });
  console.log(`   Total renderPage: ${fullTrace.total}ms`);
  fullTrace.timings?.forEach(t => console.log(`     +${t.t}ms: ${t.msg}`));

  // Step 7: Print ALL render-related console logs
  console.log('\n6. All render logs from session:');
  allLogs.filter(l => l.text.includes('[render]') || l.text.includes('Vector'))
    .forEach(l => console.log(`   ${l.text}`));

  await page.screenshot({ path: 'perf-3-final.png' });
  console.log('\n=== Done ===');
  await browser.close();
})();
