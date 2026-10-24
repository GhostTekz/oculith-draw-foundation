import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import { applyPredictor, getDecodeParms } from '../js/pdf/loader/image-extraction.js';

const require = createRequire(import.meta.url);
const { PDFDocument, PDFName } = require('pdf-lib');

function parmsDict(entries) {
  // Minimale duck-typed parms-dict: get(PDFName) -> nummer-achtig object
  return {
    get(nameObj) {
      const key = String(nameObj).replace('/', '');
      return entries[key] === undefined ? undefined : { asNumber: () => entries[key] };
    },
  };
}

// Encodeer rijen met een PNG-filtertype en verifieer dat applyPredictor de
// originele bytes terugbrengt. Referentierijen: 2 rijen, 2 pixels, RGB.
const ROWS = [
  [10, 20, 30, 40, 50, 60],
  [15, 25, 35, 45, 55, 65],
];
const BPP = 3;

function encode(filterType) {
  const rowLen = ROWS[0].length;
  const out = [];
  let prev = new Array(rowLen).fill(0);
  for (const row of ROWS) {
    out.push(filterType);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= BPP ? row[i - BPP] : 0;
      const b = prev[i];
      const c = i >= BPP ? prev[i - BPP] : 0;
      let raw;
      switch (filterType) {
        case 0: raw = row[i]; break;
        case 1: raw = row[i] - a; break;
        case 2: raw = row[i] - b; break;
        case 3: raw = row[i] - ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          raw = row[i] - (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
          break;
        }
        default: throw new Error('onbekend filtertype');
      }
      out.push(raw & 0xff);
    }
    prev = row;
  }
  return new Uint8Array(out);
}

for (const ft of [0, 1, 2, 3, 4]) {
  test(`PNG-predictor filtertype ${ft} decodeert naar de originele rijen`, () => {
    const parms = parmsDict({ Predictor: 15, Colors: 3, BitsPerComponent: 8, Columns: 2 });
    const decoded = applyPredictor(encode(ft), parms, null);
    assert.deepEqual([...decoded], ROWS.flat());
  });
}

test('TIFF-predictor (2) decodeert horizontale differencing', () => {
  const parms = parmsDict({ Predictor: 2, Colors: 3, BitsPerComponent: 8, Columns: 2 });
  // rij: [10,20,30, +5,+5,+5] -> [10,20,30,15,25,35]
  const encoded = new Uint8Array([10, 20, 30, 5, 5, 5]);
  const decoded = applyPredictor(encoded, parms, null);
  assert.deepEqual([...decoded], [10, 20, 30, 15, 25, 35]);
});

test('Predictor 1 (geen) laat bytes ongemoeid', () => {
  const parms = parmsDict({ Predictor: 1 });
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(applyPredictor(bytes, parms, null), bytes);
});

test('getDecodeParms leest een direct dictionary', async () => {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({
    DecodeParms: { Predictor: 15, Colors: 3, Columns: 440 },
  });
  const parms = getDecodeParms(doc.context, dict);
  assert.ok(parms);
  assert.equal(String(parms.get(PDFName.of('Predictor'))), '15');
});

test('getDecodeParms pakt het dictionary-element uit een parallel-array', async () => {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({
    DecodeParms: [null, { Predictor: 12, Colors: 1, Columns: 8 }],
  });
  const parms = getDecodeParms(doc.context, dict);
  assert.ok(parms);
  assert.equal(String(parms.get(PDFName.of('Predictor'))), '12');
});
