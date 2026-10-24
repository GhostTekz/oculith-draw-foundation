import { PDFName } from 'pdf-lib';

// Wrap a vector /AP builder result (absolute-PDF-coord content + needsFont flag)
// into a Form XObject and set it as the annotation's /AP /N — same BBox/Matrix
// convention as the FreeText appearance path. `rect` is the annotation /Rect
// [x1,y1,x2,y2] the appearance is drawn against. Types that previously wrote NO
// appearance stream were invisible (or showed only a bare outline) in other PDF
// viewers, which rely on /AP; see issue #256.
export function attachVectorAP(context, annotDict, built, rect) {
  if (!built || !built.content) return;
  const [x1, y1, x2, y2] = rect;
  const resources = {};
  // Fonts: /Helv for needsFont, plus any standard fonts the builder names
  // (`fonts`: { resourceName: BaseFont }, e.g. the canvas-to-PDF recorder).
  const fonts = {};
  if (built.needsFont) fonts.Helv = 'Helvetica';
  for (const [name, base] of Object.entries(built.fonts || {})) fonts[name] = base;
  if (Object.keys(fonts).length) {
    resources.Font = context.obj(Object.fromEntries(Object.entries(fonts).map(([name, base]) =>
      [name, context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: base, Encoding: 'WinAnsiEncoding' })])));
  }
  // Aparte vul-doorzichtigheid: de content refereert /GSf gs rond de
  // vul-operator; de graphics-state zelf hoort in de Resources. Zonder deze
  // ExtGState verloor een polygoon met transparante vulling zijn vlak bij
  // opslaan (The.Map-regressie in de opslag-rondgang).
  const extG = {};
  if (built.fillAlpha !== undefined && built.fillAlpha !== null && built.fillAlpha < 1) {
    extG.GSf = context.obj({ Type: 'ExtGState', ca: built.fillAlpha });
  }
  // Named alpha states of the canvas-to-PDF recorder: { name: { ca, CA } }.
  for (const [name, gs] of Object.entries(built.extGStates || {})) {
    extG[name] = context.obj({ Type: 'ExtGState', ca: gs.ca, CA: gs.CA });
  }
  if (Object.keys(extG).length) resources.ExtGState = context.obj(extG);
  // Een appearance die een Form XObject tekent (het vectorknipsel) heeft dat
  // XObject in zijn eigen resources nodig; zonder deze regel blijft de /Do
  // zonder doel en is het knipsel leeg.
  if (built.xobjects) {
    resources.XObject = context.obj(built.xobjects);
  }
  const apStream = context.stream(built.content, {
    Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2],
    Matrix: [1, 0, 0, 1, -x1, -y1], Resources: context.obj(resources),
  });
  annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(apStream) }));
}
