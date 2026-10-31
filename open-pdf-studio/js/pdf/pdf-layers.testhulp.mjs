// Testhulp: a small CAD-style PDF with three drawing layers (optional-content
// groups), made with pdf-lib.
//
//   Architectural  grey filled block + a grey wall line
//   Electrical     red filled block + a red circuit line
//   Text           black text "PANEL A"
//
// Page 1: MediaBox 0 0 200 200, no rotation.
// Page 2: MediaBox 0 0 300 240 with CropBox 40 20 260 220 and /Rotate 90; the
//         same drawing shifted by (40, 20), so it sits inside the CropBox.
//
// /OCProperties is a direct dictionary with a direct /D (BaseState ON, an
// /Order), the shape CAD exporters write and the native render copy accepts.
// Geen *.test.mjs: dit bestand bevat zelf geen tests.
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';

export const ARCH = { x: 10, y: 10, w: 80, h: 80, wall: [[10, 120], [90, 120]] };
export const ELEC = { x: 110, y: 10, w: 80, h: 80, line: [[110, 140], [190, 140]] };
export const TEXT_AT = [20, 170];
export const PAGE2_SHIFT = [40, 20];

function content(dx, dy) {
  const r = (b) => `${b.x + dx} ${b.y + dy} ${b.w} ${b.h} re f`;
  const l = ([[x1, y1], [x2, y2]]) => `${x1 + dx} ${y1 + dy} m ${x2 + dx} ${y2 + dy} l S`;
  return [
    '/OC /Arch BDC', '0.5 0.5 0.5 rg 0.5 0.5 0.5 RG 2 w', r(ARCH), l(ARCH.wall), 'EMC',
    '/OC /Elec BDC', '1 0 0 rg 1 0 0 RG 2 w', r(ELEC), l(ELEC.line), 'EMC',
    '/OC /Text BDC', `BT 0 0 0 rg /F1 14 Tf ${TEXT_AT[0] + dx} ${TEXT_AT[1] + dy} Td (PANEL A) Tj ET`, 'EMC',
  ].join('\n');
}

/**
 * @returns {Promise<{bytes: Uint8Array, refs: {arch: {objectNumber:number, generationNumber:number},
 *   elec: object, text: object}}>}
 */
export async function buildLayersFixture({ defaultOff = [] } = {}) {
  const pdf = await PDFDocument.create();
  const context = pdf.context;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ocg = (name) => context.register(context.obj({ Type: 'OCG', Name: PDFString.of(name) }));
  const refs = { arch: ocg('Architectural'), elec: ocg('Electrical'), text: ocg('Text') };
  const properties = { Arch: refs.arch, Elec: refs.elec, Text: refs.text };
  const addPage = (media, dx, dy, extra = {}) => {
    const stream = context.flateStream(content(dx, dy));
    const page = pdf.addPage(media);
    page.node.set(PDFName.of('Contents'), context.register(stream));
    page.node.set(PDFName.of('Resources'), context.obj({
      Properties: properties,
      Font: { F1: font.ref },
    }));
    for (const [key, value] of Object.entries(extra)) page.node.set(PDFName.of(key), context.obj(value));
    return page;
  };
  addPage([200, 200], 0, 0);
  const page2 = addPage([300, 240], PAGE2_SHIFT[0], PAGE2_SHIFT[1], { CropBox: [40, 20, 260, 220] });
  page2.setRotation({ type: 'degrees', angle: 90 });
  const d = { BaseState: 'ON', Order: [refs.arch, refs.elec, refs.text] };
  if (defaultOff.length) d.OFF = defaultOff.map(key => refs[key]);
  pdf.catalog.set(PDFName.of('OCProperties'), context.obj({
    OCGs: [refs.arch, refs.elec, refs.text],
    D: d,
  }));
  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, refs };
}

/** PDF.js id of an OCG ref: `12R` (generation 0) or `12R3`. */
export function pdfJsId(ref) {
  return ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`;
}
