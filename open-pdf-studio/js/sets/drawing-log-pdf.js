import { PDFDocument, rgb } from 'pdf-lib';
import { edition } from '../editions/active.js';
import { drawBrandMark } from '../pdf/brand-mark-pdf.js';

// fontkit (about 0.5 MB) loads with the first report, not with the editor.
const loadFontkit = () => import('@pdf-lib/fontkit').then((m) => m.default);

const WIDTH = 612;
const HEIGHT = 792;
const MARGIN = 46;
const BOTTOM = 58;
const ink = rgb(0.12, 0.16, 0.2);
const muted = rgb(0.38, 0.43, 0.48);
const accent = rgb(0.83, 0.43, 0.17);

function printable(value, face, fallback) {
  return Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' '), character => {
    const code = character.codePointAt(0);
    if (face.hasGlyphForCodePoint(code)) return character;
    fallback.used = true;
    return `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`;
  }).join('');
}

function wrap(font, value, size, width) {
  const lines = [];
  let current = '';
  for (const word of value.split(/(\s+)/u)) {
    if (!word) continue;
    if (font.widthOfTextAtSize(current + word, size) <= width) {
      current += word;
      continue;
    }
    if (current.trim()) lines.push(current.trimEnd());
    current = '';
    for (const character of word) {
      if (current && font.widthOfTextAtSize(current + character, size) > width) {
        lines.push(current);
        current = '';
      }
      current += character;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.length ? lines : [''];
}

/** Export the complete local register; historical file presence is not implied. */
export async function buildDrawingLogPdf(register, availability = {}, fontBytes, generatedAt = new Date()) {
  const fontkit = await loadFontkit();
  if (!fontBytes?.byteLength) throw new Error('The bundled drawing log font is unavailable.');
  if (!register || !Array.isArray(register.sheets)) throw new Error('A drawing set is required.');
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const face = fontkit.create(fontBytes);
  const font = await document.embedFont(fontBytes, { subset: false });
  const fallback = { used: false };
  document.setTitle(`${edition.productName} drawing log - ${register.name}`);
  document.setCreator(edition.productName);
  document.setCreationDate(new Date(generatedAt));

  const pages = [];
  let page;
  let y;
  const addPage = () => {
    page = document.addPage([WIDTH, HEIGHT]);
    pages.push(page);
    y = HEIGHT - MARGIN;
    page.drawRectangle({ x: 0, y: HEIGHT - 8, width: WIDTH, height: 8, color: accent });
  };
  const ensure = height => { if (y - height < BOTTOM) addPage(); };
  const line = (value, { size = 10, color = ink, indent = 0, gap = 4 } = {}) => {
    for (const part of wrap(font, printable(value, face, fallback), size, WIDTH - 2 * MARGIN - indent)) {
      ensure(size + gap);
      page.drawText(part, { x: MARGIN + indent, y: y - size, font, size, color });
      y -= size + gap;
    }
  };
  const separator = () => {
    ensure(14);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: rgb(0.78, 0.8, 0.82) });
    y -= 8;
  };

  addPage();
  line('DRAWING LOG', { size: 18, gap: 8 });
  line(register.name || 'Drawing set', { size: 13, gap: 8 });
  line(`Generated (UTC): ${new Date(generatedAt).toISOString()}`, { size: 9, color: muted });
  line(`${register.sheets.length} registered sheet${register.sheets.length === 1 ? '' : 's'}`, { size: 10, color: muted, gap: 10 });
  separator();

  if (!register.sheets.length) line('No sheets are registered in this drawing set.');
  for (const sheet of register.sheets) {
    ensure(88);
    line(`${sheet.label} - ${sheet.title || 'Untitled sheet'}`, { size: 12, color: accent, gap: 7 });
    line(`Stable sheet ID: ${sheet.id}`, { size: 9, color: muted, indent: 12 });
    line(`Current | Revision ${sheet.revision || 'Unnumbered'} | Page ${sheet.page} | File status: ${availability[sheet.id] || 'Unknown'}`, { size: 9, indent: 12 });
    line(`PDF: ${sheet.filePath}`, { size: 9, indent: 12, gap: 7 });
    for (const prior of [...(sheet.history || [])].reverse()) {
      ensure(56);
      line(`Earlier | Revision ${prior.revision || 'Unnumbered'} | Page ${prior.page}`, { size: 9, color: muted, indent: 12 });
      line(`PDF: ${prior.filePath}`, { size: 9, indent: 12 });
      line(`Replaced at: ${prior.replacedAt || 'Unknown'} | Historical file status: not checked`, { size: 9, color: muted, indent: 12, gap: 7 });
    }
    separator();
  }
  if (fallback.used) line('Some characters appear as [U+XXXX] because the bundled PDF font cannot render them. The CSV log retains the original text.', { size: 9, color: muted });
  for (const [index, sheet] of pages.entries()) {
    sheet.drawLine({ start: { x: MARGIN, y: 42 }, end: { x: WIDTH - MARGIN, y: 42 }, thickness: 0.5, color: muted });
    const mark = drawBrandMark(sheet, MARGIN, 25, 10);
    sheet.drawText(`${edition.productName} | Drawing log | Page ${index + 1} of ${pages.length}`, {
      x: MARGIN + mark + 5, y: 27, font, size: 8, color: muted,
    });
  }
  return document.save();
}
