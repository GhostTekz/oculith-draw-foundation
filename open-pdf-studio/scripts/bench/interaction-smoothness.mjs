// Interaction smoothness benchmark (browser build, Vite dev server).
//
// Opens a PDF, then pans (wheel), zooms (Ctrl+wheel), hovers, draws a
// rectangle and drags it, and reports per phase the animation-frame times
// (p50 / p95 / max, frames over 33 ms) and main-thread long tasks.
//
// Usage (from open-pdf-studio/, with `npx vite --port 4199` running):
//   node scripts/bench/interaction-smoothness.mjs http://127.0.0.1:4199/ drawing.pdf [out.json]
// Env: CHROMIUM=/path/to/chromium (default: Playwright's), SETTLE=ms to wait
// after opening before measuring (default 8000; heavy sheets need ~25000 so
// the first page render does not overlap the pan phase).
import fs from 'node:fs';
import { chromium } from 'playwright';
const [,, url, file, out] = process.argv;
if (!url || !file) { console.error('usage: interaction-smoothness.mjs <url> <pdf> [out.json]'); process.exit(2); }
const b = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=gl-egl'] });
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
p.on('pageerror', (e) => { if (!/WebSocket/.test(e.message)) errors.push(e.message); });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
// Instrumentation: long tasks, frame deltas, redraw timings.
await p.evaluate(() => {
  window.__perf = { long: [], frames: [], redraw: [], marks: {} };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push([Math.round(e.startTime), Math.round(e.duration)]); })
    .observe({ type: 'longtask', buffered: true });
  let last = performance.now();
  const loop = (t) => { window.__perf.frames.push([Math.round(t), +(t - last).toFixed(1)]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
const t0 = Date.now();
const ch = p.waitForEvent('filechooser'); await p.keyboard.press('Control+o'); await (await ch).setFiles(file);
await p.waitForFunction(async () => { const st = await import('/js/core/state.ts'); const d = st.state.documents[st.state.activeDocumentIndex]; return !!d?.pdfDoc && d.annotations?.length > 0; }, null, { timeout: 180000, polling: 200 });
const openMs = Date.now() - t0;
await p.waitForTimeout(Number(process.env.SETTLE || 8000));
// Wrap redrawAnnotations to time it.
await p.evaluate(async () => {
  const r = await import('/js/annotations/rendering.js');
  window.__perfRedraw = r;
});
const box = await p.locator('#pdf-container').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const phase = async (name, fn) => {
  await p.evaluate((n) => { window.__perf.marks[n] = [Math.round(performance.now())]; }, name);
  await fn();
  await p.waitForTimeout(600);
  await p.evaluate((n) => { window.__perf.marks[n].push(Math.round(performance.now())); }, name);
};
// 1. Pan by wheel scrolling.
await phase('pan', async () => { await p.mouse.move(cx, cy); for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, i < 20 ? 120 : -120); await p.waitForTimeout(16); } });
// 2. Zoom with ctrl+wheel.
await phase('zoom', async () => { await p.mouse.move(cx, cy); await p.keyboard.down('Control'); for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, i < 6 ? -120 : 120); await p.waitForTimeout(60); } await p.keyboard.up('Control'); });
await p.waitForTimeout(4000);
// 3. Hover sweep (select tool).
await p.keyboard.press('Escape');
await phase('hover', async () => { for (let i = 0; i < 120; i++) { await p.mouse.move(box.x + 100 + i * 10, box.y + 200 + (i % 20) * 15); await p.waitForTimeout(8); } });
// 4. Draw a rectangle (R) with a long drag.
await p.keyboard.press('r');
await phase('draw', async () => { await p.mouse.move(cx - 300, cy - 200); await p.mouse.down(); for (let i = 0; i < 120; i++) { await p.mouse.move(cx - 300 + i * 4, cy - 200 + i * 3); await p.waitForTimeout(8); } await p.mouse.up(); });
// 5. Drag the new rectangle (select tool) around.
await p.keyboard.press('Escape'); await p.keyboard.press('v');
await phase('drag', async () => { await p.mouse.move(cx - 300 + 2, cy - 100); await p.mouse.down(); for (let i = 0; i < 120; i++) { await p.mouse.move(cx - 300 + 2 + i * 3, cy - 100 + i * 2); await p.waitForTimeout(8); } await p.mouse.up(); });
const res = await p.evaluate(() => window.__perf);
const summary = { openMs, errors: errors.slice(0, 5), phases: {} };
for (const [n, [a, z]] of Object.entries(res.marks)) {
  const fr = res.frames.filter(([t]) => t >= a && t <= z).map(([, d]) => d).sort((x, y) => x - y);
  const lt = res.long.filter(([s]) => s >= a && s <= z).map(([, d]) => d);
  const pct = (q) => fr.length ? fr[Math.min(fr.length - 1, Math.floor(q * fr.length))] : null;
  summary.phases[n] = { frames: fr.length, p50: pct(0.5), p95: pct(0.95), max: fr.at(-1), over33: fr.filter((d) => d > 33.4).length,
    longTasks: lt.length, longTaskMs: lt.reduce((s, v) => s + v, 0), longestTask: Math.max(0, ...lt) };
}
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
await b.close(); process.exit(0);
