// Speed suite: how long the things you wait for take, measured from the
// screen like a user sees them (engine-agnostic: PDF.js, PDFium-wasm or
// native PDFium all count the same).
//
// For each step it records, from the moment the action is sent:
//   firstMs   the drawing area first changes (something visible happens)
//   settleMs  the drawing area stops changing for SETTLE_QUIET ms (sharp)
// Steps: open the PDF, fit page (Ctrl+2), zoom in four times (Ctrl+=), next
// page (when there is one). Plus JS heap after opening.
//
// Usage (from open-pdf-studio/, any build: dev server or vite preview):
//   node scripts/bench/speed-suite.mjs <url> <pdf> [out.json]
// Env: CHROMIUM=/path/to/chromium, GPU=1 to enable GPU rasterisation flags,
//      SETTLE_QUIET=ms of no change that counts as settled (default 1500),
//      STEP_TIMEOUT=ms per step (default 60000).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const [,, url, file, out] = process.argv;
if (!url || !file) { console.error('usage: speed-suite.mjs <url> <pdf> [out.json]'); process.exit(2); }
const QUIET = Number(process.env.SETTLE_QUIET || 1500);
const STEP_TIMEOUT = Number(process.env.STEP_TIMEOUT || 60000);
const args = process.env.GPU ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=gl-egl'] : [];
const b = await chromium.launch({ headless: true, args, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
p.on('pageerror', (e) => { if (!/WebSocket/.test(e.message)) errors.push(e.message.slice(0, 200)); });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
// Before a file is open there is no drawing area yet (start screen): watch the
// middle of the window for the open step, the drawing area afterwards.
let clip = { x: 400, y: 150, width: 1000, height: 600 };
const shot = async () => crypto.createHash('sha1').update(await p.screenshot({ clip, type: 'jpeg', quality: 60 })).digest('hex');

// Time one step: `act` starts it; then sample the drawing area until it has
// been unchanged for QUIET ms.
async function step(name, act) {
  const before = await shot();
  const t0 = Date.now();
  await act();
  let first = null, lastChange = t0, prev = before;
  while (Date.now() - t0 < STEP_TIMEOUT) {
    const h = await shot();
    const now = Date.now();
    if (h !== prev) { if (first === null) first = now - t0; lastChange = now; prev = h; }
    if (first !== null && now - lastChange >= QUIET) break;
    if (first === null && now - t0 > 15000) break; // nothing visible happened
  }
  const r = { step: name, firstMs: first, settleMs: first === null ? null : lastChange - t0 };
  console.log(`${name.padEnd(14)} first ${String(r.firstMs).padStart(6)} ms   sharp ${String(r.settleMs).padStart(6)} ms`);
  return r;
}

const results = [];
results.push(await step('open', async () => {
  const ch = p.waitForEvent('filechooser');
  await p.keyboard.press('Control+o');
  await (await ch).setFiles(file);
}));
const area = await p.locator('#pdf-container').boundingBox();
if (area) clip = { x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height) };
const heapMb = await p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
const pages = await p.evaluate(() => (document.body.innerText.match(/Pages:\s*(\d+)/) || [])[1] || null);
const cx = clip.x + clip.width / 2, cy = clip.y + clip.height / 2;
// Fit the page first: files open at 150% on their top-left corner, often
// blank, where zooming changes nothing on screen. Then zoom in on the centre
// with the keyboard (Ctrl+=), which does not depend on the pointer position.
results.push(await step('fit page', () => p.keyboard.press('Control+2')));
for (let i = 1; i <= 4; i++) {
  results.push(await step(`zoom in ${i}`, () => p.keyboard.press('Control+Equal')));
}
results.push(await step('fit again', () => p.keyboard.press('Control+2')));
await p.mouse.move(cx, cy);
for (let i = 1; i <= 3; i++) {
  results.push(await step(`wheel zoom ${i}`, async () => {
    await p.keyboard.down('Control'); await p.mouse.wheel(0, -120); await p.keyboard.up('Control');
  }));
}
const zoomBox = await p.evaluate(() => document.querySelector('#nav-zoom-input')?.value || null);
if (pages && Number(pages) > 1) results.push(await step('next page', () => p.locator('#nav-next').click()));
const summary = { url, file: file.split('/').pop(), pages, heapMbAfterOpen: heapMb, zoomAfterSteps: zoomBox, results, errors };
console.log(`zoom after steps ${zoomBox}; heap after open ${heapMb} MB; errors ${JSON.stringify(errors)}`);
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 1));
await b.close();
process.exit(0);
