import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PDF_PATH = 'C:/3BM/50_projecten/3_3BM_bouwtechniek/3059 Woonhuis Benedenkerkseweg 87 Stolwijk/20_post_IN/01 27-03-2026 beginstukken/begane grond do 3 constructie verwerkt_50.pdf';

(async () => {
  // Start vite first
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('[pdfium]') || t.includes('render') || msg.type() === 'error') {
      console.log(`  BROWSER [${msg.type()}]: ${t.substring(0, 300)}`);
    }
  });
  page.on('pageerror', err => console.log('  PAGE ERROR:', err.message.substring(0, 200)));

  await page.goto('http://localhost:3041/');
  await page.waitForTimeout(3000);

  // Read real PDF file
  console.log('Reading PDF file...');
  const pdfBytes = readFileSync(PDF_PATH);
  console.log(`PDF size: ${(pdfBytes.length / 1024 / 1024).toFixed(1)} MB`);

  const base64 = pdfBytes.toString('base64');

  console.log('\n=== PDF.js rendering ===');
  const pdfjsResult = await page.evaluate(async (b64) => {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const pdfjsLib = await import('pdfjs-dist');
      const t0 = performance.now();
      const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
      const doc = await loadingTask.promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport, annotationMode: 0 }).promise;
      const elapsed = performance.now() - t0;

      return { success: true, width: canvas.width, height: canvas.height, elapsed: Math.round(elapsed) };
    } catch (e) {
      return { error: e.message };
    }
  }, base64);

  if (pdfjsResult.success) {
    console.log(`PDF.js rendered: ${pdfjsResult.width}x${pdfjsResult.height} in ${pdfjsResult.elapsed}ms`);
  } else {
    console.log('PDF.js failed:', pdfjsResult.error);
  }

  await page.waitForTimeout(5000); // Keep browser open to see result
  await browser.close();
})();
