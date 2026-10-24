// Writes js/tools/fixtures/synthetic-ext-toolset.btx: a SYNTHETIC the external editor tool
// set made from the publicly described .btx layout (XML items whose <Raw> is
// a hex-encoded zlib PDF annotation dictionary). Not an external editor sample file.
// Run: node scripts/make-synthetic-btx.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const hexZlib = (text) => deflateSync(Buffer.from(text, 'latin1')).toString('hex');
const item = (type, raw, mode, { encode = true, index = 0 } = {}) => `  <ToolChestItem Version="1">
    <Name>SYNTH${String(index).padStart(11, '0')}</Name>
    <Type>Bluebeam.PDF.Annotations.${type}</Type>
    <Raw>${encode ? hexZlib(raw) : raw.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')}</Raw>
    <X>5.5</X>
    <Y>5.5</Y>
    <Index>${index}</Index>
    <Mode>${mode}</Mode>
  </ToolChestItem>`;

const items = [
  ['AnnotationSquare', '<</Type/Annot/Subtype/Square/Rect[100 100 160 130]/C[1 0 0]/IC[1 1 0]/BS<</W 2/S/D>>/CA 0.5/Subj(Door box)/Contents(Swing clear)/T(Synthetic)>>', 'drawing'],
  ['AnnotationLine', '<</Subtype/Line/Rect[0 0 100 10]/L[0 0 100 0]/LE[/None/OpenArrow]/C[0 0 1]/BS<</W 1.5>>/Subj(Arrow)>>', 'drawing'],
  ['AnnotationCircle', '<</Subtype/Circle/Rect[0 0 40 40]/C[0 0.5 0]/IC[]/Border[0 0 3]/Subj(Ring)>>', 'properties'],
  ['AnnotationFreeText', '<</Subtype/FreeText/IT/FreeTextCallout/Rect[0 0 120 40]/DA(0 0 1 rg /Helv 12 Tf)/C[1 1 1]/CL[5.5 5.5 40 35 53.8 35]/Subj(Callout)/Contents(Note \\(see\\) A)>>', 'properties'],
  ['AnnotationPolygon', '<</Subtype/Polygon/BE<</S/C/I 1>>/Vertices[0 0 50 0 50 30 0 30]/C[1 0 0]/Subj(Revision cloud)>>', 'drawing'],
  ['AnnotationPolyLine', '<</Subtype/PolyLine/Vertices[10 10 40 10 40 40]/C[<FEFF> 0 0]/C[0.2 0.2 0.2]/BS<</W 2>>/Subj(Run)>>', 'drawing'],
  ['AnnotationInk', '<</Subtype/Ink/InkList[[0 0 5 5 10 0]]/C[0 0 0]/Subj(Pen)>>', 'properties'],
  ['AnnotationHighlight', '<</Subtype/Highlight/QuadPoints[0 10 50 10 0 0 50 0]/C[1 1 0]/Subj(Highlight)>>', 'properties'],
  ['AnnotationText', '<</Subtype/Text/Name/Comment/C[1 1 0]/Subj(Note)>>', 'properties'],
  ['AnnotationLine', '<</Subtype/Line/IT/LineDimension/L[0 0 50 0]/Measure<</Type/Measure>>/Subj(Length)>>', 'properties'],
];
const xml = `<?xml version="1.0" encoding="utf-8"?>
<BluebeamRevuToolSet Version="1">
  <Title>${hexZlib('Synthetic Site Set')}</Title>
${items.map(([type, raw, mode], index) => item(type, raw, mode, { index })).join('\n')}
${item('AnnotationSquare', '<</Subtype/Square/Rect[0 0 20 20]/C[0 0 0]/Subj(Plain raw)>>', 'properties', { encode: false, index: items.length })}
${item('AnnotationSquare', '789cdeadbeef', 'properties', { encode: false, index: items.length + 1 })}
</BluebeamRevuToolSet>
`;
const target = fileURLToPath(new URL('../js/tools/fixtures/synthetic-ext-toolset.btx', import.meta.url));
writeFileSync(target, xml);
console.log(`wrote ${target} (${xml.length} bytes)`);
