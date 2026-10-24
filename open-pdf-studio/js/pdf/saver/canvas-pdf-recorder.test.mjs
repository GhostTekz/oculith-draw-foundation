// Canvas-to-PDF recorder: operators for the supported subset, clear errors
// for the rest, and a rendered comparison (PDF.js vs the canvas) for a draw
// function with transforms, arcs, ellipses, curves, dashes, alpha and clip.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createCanvasPdfRecorder, UnsupportedCanvasOperation, parseCanvasColor } from './canvas-pdf-recorder.js';
import { attachVectorAP } from './vector-ap.js';

const require = createRequire(import.meta.url);
let napiCanvas = null;
try { napiCanvas = require('@napi-rs/canvas'); } catch { /* optional (pdfjs-dist dependency) */ }

const X = (x) => x;
const Y = (y) => 200 - y;

test('records paths with the app-to-PDF root transform and paints in PDF operators', () => {
  const rec = createCanvasPdfRecorder();
  const ctx = rec.ctx;
  ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(50, 10); ctx.quadraticCurveTo(60, 30, 50, 50); ctx.closePath();
  ctx.fillStyle = '#ff0000'; ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)'; ctx.lineWidth = 2; ctx.setLineDash([4, 2]); ctx.stroke();
  const out = rec.toPdf({ X, Y });
  assert.match(out.content, /^q\n1 0 0 -1 0 200 cm\n/u, 'y-down app space maps to PDF space');
  assert.match(out.content, /1 0 0 rg\n10 10 m\n50 10 l\n56\.6667 23\.3333 56\.6667 36\.6667 50 50 c\nh\nf\n/u);
  assert.match(out.content, /\[4 2\] 0 d\n/u);
  assert.match(out.content, /\/GSr0 gs\n/u);
  assert.deepEqual(out.extGStates, { GSr0: { ca: 1, CA: 0.5 } });
  assert.deepEqual(out.bounds.map(v => Math.round(v)), [6, 146, 61, 194], 'miter joins pad the stroke bounds');
});

test('arcs become Béziers; transforms are applied to points and to the stroke width', () => {
  const rec = createCanvasPdfRecorder();
  const ctx = rec.ctx;
  ctx.translate(100, 100); ctx.scale(2, 2);
  ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.stroke();
  const { content } = rec.toPdf({ X, Y });
  assert.equal((content.match(/ c\n/gu) || []).length, 4, 'a full circle is four quarter curves');
  assert.match(content, /2 0 0 2 100 100 cm\n10 0 m\n/u, 'stroke runs in the user space of the current transform');
  assert.match(content, /1\.5 w/u);
});

test('text uses standard Helvetica with canvas alignment and baseline', () => {
  const rec = createCanvasPdfRecorder();
  rec.ctx.font = 'bold 10px Helvetica, Arial, sans-serif';
  rec.ctx.textAlign = 'center'; rec.ctx.textBaseline = 'middle'; rec.ctx.fillStyle = '#000';
  rec.ctx.fillText('SD', 50, 50);
  assert.ok(Math.abs(rec.ctx.measureText('SD').width - 13.9) < 0.05, 'Helvetica-Bold widths');
  const out = rec.toPdf({ X, Y });
  assert.deepEqual(out.fonts, { HeBo: 'Helvetica-Bold' });
  assert.match(out.content, /\/HeBo 10 Tf\n1 0 0 -1 43\.055 53\.465 Tm\n\(SD\) Tj/u);
});

test('save/restore become q/Q and clip writes a clipping path', () => {
  const rec = createCanvasPdfRecorder();
  const ctx = rec.ctx;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 10, 10); ctx.clip('evenodd');
  ctx.fillRect(0, 0, 20, 20); ctx.restore();
  ctx.save();
  const { content } = rec.toPdf({ X, Y });
  assert.match(content, /q\n0 0 m\n10 0 l\n10 10 l\n0 10 l\nh\nW\* n\n/u);
  assert.equal((content.match(/^q$/gmu) || []).length, (content.match(/^Q$/gmu) || []).length, 'balanced q/Q');
});

test('unsupported canvas operations throw UnsupportedCanvasOperation', () => {
  const { ctx } = createCanvasPdfRecorder();
  for (const call of [
    () => ctx.drawImage({}, 0, 0),
    () => ctx.createLinearGradient(0, 0, 1, 1),
    () => ctx.getImageData(0, 0, 1, 1),
    () => ctx.clearRect(0, 0, 1, 1),
    () => ctx.arcTo(0, 0, 1, 1, 1),
    () => { ctx.fillStyle = { gradient: true }; },
    () => { ctx.fillStyle = 'hsl(10, 50%, 50%)'; },
    () => ctx.somethingNew(),
    () => { ctx.globalCompositeOperation = 'multiply'; ctx.fillRect(0, 0, 1, 1); },
  ]) assert.throws(call, UnsupportedCanvasOperation);
  assert.deepEqual(parseCanvasColor('#0f08'), { rgb: [0, 1, 0], a: 0x88 / 255 });
});

test('attachVectorAP writes the recorder fonts and alpha states as resources', async () => {
  const doc = await PDFDocument.create();
  const rec = createCanvasPdfRecorder();
  rec.ctx.globalAlpha = 0.5; rec.ctx.font = '8px sans-serif'; rec.ctx.fillText('A', 1, 9);
  const built = rec.toPdf({ X, Y });
  const dict = doc.context.obj({ Type: 'Annot', Subtype: 'Square' });
  attachVectorAP(doc.context, dict, built, built.bounds);
  const n = doc.context.lookup(doc.context.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const res = doc.context.lookup(n.dict.get(PDFName.of('Resources')));
  assert.ok(doc.context.lookup(res.get(PDFName.of('Font'))).get(PDFName.of('Helv')));
  assert.ok(doc.context.lookup(res.get(PDFName.of('ExtGState'))).get(PDFName.of('GSr0')));
});

// A draw function like a construction symbol: nested transforms, rotation,
// ellipse with rotation, Bézier, dashed stroke, alpha fill and a clip.
function sample(ctx) {
  ctx.save();
  ctx.translate(60, 60); ctx.rotate(0.4); ctx.scale(1.5, 1);
  ctx.beginPath(); ctx.ellipse(0, 0, 30, 18, 0.3, 0, Math.PI * 1.5); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fillStyle = 'rgba(37, 99, 235, 0.6)'; ctx.fill();
  ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827'; ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.rect(20, 95, 80, 20); ctx.clip();
  ctx.beginPath(); ctx.moveTo(10, 120); ctx.bezierCurveTo(40, 80, 80, 140, 110, 95);
  ctx.setLineDash([6, 3]); ctx.lineCap = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = '#dc2626'; ctx.stroke();
  ctx.restore();
}

test('PDF.js renders a recorded drawing like the canvas', { skip: !napiCanvas && '@napi-rs/canvas not installed' }, async () => {
  if (typeof globalThis.window === 'object' && !globalThis.window.requestAnimationFrame) {
    globalThis.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  }
  const size = 120, scale = 3;
  const rec = createCanvasPdfRecorder();
  sample(rec.ctx);
  const built = rec.toPdf({ X: (x) => x, Y: (y) => size - y });
  const doc = await PDFDocument.create();
  const page = doc.addPage([size, size]);
  const dict = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: built.bounds, F: 4 });
  attachVectorAP(doc.context, dict, built, built.bounds);
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(dict)]));
  const bytes = await doc.save();

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const pdfPage = await pdf.getPage(1);
  const viewport = pdfPage.getViewport({ scale });
  const a = napiCanvas.createCanvas(size * scale, size * scale);
  const actx = a.getContext('2d');
  actx.fillStyle = '#fff'; actx.fillRect(0, 0, a.width, a.height);
  await pdfPage.render({ canvasContext: actx, viewport, canvas: a }).promise;
  await task.destroy();
  const b = napiCanvas.createCanvas(size * scale, size * scale);
  const bctx = b.getContext('2d');
  bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, b.width, b.height);
  bctx.scale(scale, scale);
  sample(bctx);
  const da = actx.getImageData(0, 0, a.width, a.height).data, db = bctx.getImageData(0, 0, b.width, b.height).data;
  let ink = 0, off = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (Math.min(da[i], da[i + 1], da[i + 2], db[i], db[i + 1], db[i + 2]) >= 240) continue;
    ink++;
    if (Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])) > 96) off++;
  }
  assert.ok(ink > 3000, 'the drawing is visible');
  assert.ok(off / ink < 0.02, `${off}/${ink} ink pixels differ`);
});
