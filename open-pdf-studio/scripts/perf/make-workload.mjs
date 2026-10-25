// A synthetic drawing set for performance runs: N large sheets of vector
// linework and M box markups (with appearance streams, like saved ones),
// deterministic for a given seed. No real drawing content.
//
// Usage: node scripts/perf/make-workload.mjs <out.pdf> [--sheets 10] [--markups 2000]
//          [--segments 20000] [--seed 1] [--width 3024] [--height 2160]
import { writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber, PDFString, rgb } from 'pdf-lib';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
if (!out) {
  console.error('Usage: node scripts/perf/make-workload.mjs <out.pdf> [--sheets N] [--markups M] [--segments K] [--seed S]');
  process.exit(2);
}
const sheets = opt('sheets', 10), markups = opt('markups', 2000), segments = opt('segments', 20000);
const width = opt('width', 3024), height = opt('height', 2160);
let seed = opt('seed', 1) >>> 0 || 1;
// Mulberry32: small, seeded, the same set every run.
const random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const doc = await PDFDocument.create();
const perSheet = Math.ceil(markups / sheets);
const box = (w, h) => doc.context.stream(`0.2 0.5 0.9 rg 0.1 0.3 0.7 RG 0.75 w 0 0 ${w} ${h} re B`, {
  Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h],
});
for (let s = 0; s < sheets; s++) {
  const page = doc.addPage([width, height]);
  // Linework: a grid of walls plus short strokes, as a dense plan draws.
  const ops = ['0 0 0 RG 0.5 w'];
  for (let k = 0; k < segments; k++) {
    const x = random() * width, y = random() * height;
    const horizontal = random() < 0.5, len = 4 + random() * 60;
    ops.push(`${x.toFixed(2)} ${y.toFixed(2)} m ${(horizontal ? x + len : x).toFixed(2)} ${(horizontal ? y : y + len).toFixed(2)} l S`);
  }
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  const content = doc.context.stream(ops.join('\n'));
  page.node.addContentStream(doc.context.register(content));
  const annots = [];
  const count = Math.min(perSheet, markups - s * perSheet);
  for (let k = 0; k < count; k++) {
    const w = 4 + random() * 20, h = 3 + random() * 10;
    const x = 40 + random() * (width - 80 - w), y = 40 + random() * (height - 80 - h);
    const dict = doc.context.obj({
      Type: 'Annot', Subtype: 'Square',
      Rect: [x, y, x + w, y + h],
      C: [0.1, 0.3, 0.7], IC: [0.2, 0.5, 0.9], CA: PDFNumber.of(1),
      BS: { W: 0.75, S: 'S' },
      Subj: PDFString.of('Fixture'),
      Contents: PDFString.of(`F-${s + 1}-${k + 1}`),
      NM: PDFString.of(`perf-${s + 1}-${k + 1}`),
      AP: { N: doc.context.register(box(w, h)) },
    });
    annots.push(doc.context.register(dict));
  }
  page.node.set(PDFName.of('Annots'), doc.context.obj(annots));
}
const bytes = await doc.save({ objectsPerTick: Infinity });
await writeFile(out, bytes);
console.log(`${out}: ${sheets} sheets, ${markups} markups, ${segments} segments a sheet, ${(bytes.length / 1048576).toFixed(1)} MB`);
