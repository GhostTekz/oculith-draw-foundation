import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { edition } from '../editions/active.js';
import { customTextColumnName } from './custom-text-column.js';
import { choiceColumn, choiceValue } from './custom-choice-column.js';
import { numberColumn, numberText } from './custom-number-column.js';
import { formulaColumn, formulaText } from './custom-formula-column.js';
import { checkmarkColumn, checkmarkText } from './custom-checkmark-column.js';
import { drawBrandMark } from '../pdf/brand-mark-pdf.js';

const WIDTH = 612;
const HEIGHT = 792;
const MARGIN = 46;
const BOTTOM = 58;
const ink = rgb(0.12, 0.16, 0.2);
const muted = rgb(0.38, 0.43, 0.48);
const accent = rgb(0.83, 0.43, 0.17);

export function printable(value, face, fallback) {
  return Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' '), character => {
    const code = character.codePointAt(0);
    if (face.hasGlyphForCodePoint(code)) return character;
    fallback.used = true;
    return `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`;
  }).join('');
}

export function wrap(font, value, size, width) {
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

/** A text-only, unverified summary of the Markups List's normalized rows. */
export async function buildMarkupSummaryPdf({ sourcePath, rows, customTextColumn = '', customChoiceColumn = null,
  customNumberColumn = null, customCheckmarkColumn = null, customFormulaColumn = null,
  customSecondTextColumn = '', customSecondChoiceColumn = null, customSecondNumberColumn = null,
  showStatusHistory = false, latestStatusOnly = false, generatedAt = new Date() }, fontBytes) {
  if (!Array.isArray(rows)) throw new Error('Markup summary rows are required.');
  if (!fontBytes?.byteLength) throw new Error('The bundled markup report font is unavailable.');
  const created = new Date(generatedAt);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const face = fontkit.create(fontBytes);
  const font = await document.embedFont(fontBytes, { subset: false });
  document.setTitle(`${edition.productName} Markups List summary`);
  document.setSubject('Markup statuses copied from source; measurements unverified');
  document.setCreator(edition.productName);
  document.setCreationDate(created);

  const fallback = { used: false };
  const customName = customTextColumnName(customTextColumn);
  const secondName = customTextColumnName(customSecondTextColumn);
  const choice = choiceColumn(customChoiceColumn, customName);
  const secondChoice = choiceColumn(customSecondChoiceColumn);
  const number = numberColumn(customNumberColumn, customName, choice?.name);
  const secondNumber = numberColumn(customSecondNumberColumn);
  const checkmark = checkmarkColumn(customCheckmarkColumn, customName, choice?.name, number?.name);
  const formula = formulaColumn(customFormulaColumn, number, customName, choice?.name,
    checkmark?.name, choice, secondNumber);
  if (secondName && [customName, choice?.name, secondChoice?.name, number?.name,
    secondNumber?.name, checkmark?.name, formula?.name]
    .some(other => secondName.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Text columns and other custom columns need different names.');
  }
  if (secondChoice && [customName, secondName, choice?.name, number?.name, secondNumber?.name,
    checkmark?.name, formula?.name].some(other =>
    secondChoice.name.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Custom columns need different names.');
  }
  if (secondNumber && [customName, secondName, choice?.name, secondChoice?.name,
    number?.name, checkmark?.name, formula?.name].some(other =>
    secondNumber.name.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Custom columns need different names.');
  }
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
  line('MARKUPS LIST SUMMARY', { size: 18, gap: 9 });
  line(`Source PDF: ${sourcePath || 'Unknown'}`, { size: 10, gap: 8 });
  line(`Generated (UTC): ${created.toISOString()}`, { size: 9, color: muted });
  line(`${rows.length} markup${rows.length === 1 ? '' : 's'}`, { size: 10, color: muted, gap: 8 });
  line('Statuses are copied from the source markups. Measurement values in this summary are UNVERIFIED; check scale and units against the drawing.', { size: 9, color: accent, gap: 8 });
  separator();

  if (!rows.length) line('No markups were included in this summary.');
  for (const [index, row] of rows.entries()) {
    ensure(74);
    const pageText = row.pageLabel && row.pageLabel !== String(row.page) ? `${row.page ?? 'Unknown'} (${row.pageLabel})` : (row.page ?? 'Unknown');
    line(`Markup ${index + 1} | Page ${pageText} | ${row.type || 'Unknown type'}`, { size: 11, color: accent, gap: 7 });
    line(`Subject: ${row.subject || 'None'} | Status: ${row.status || 'none'} | Author: ${row.author || 'Unknown'}`, { size: 9, indent: 12, gap: 6 });
    line(`Text: ${row.text || 'None'}`, { size: 9, indent: 12, gap: 6 });
    if (customName) line(`${customName}: ${row.customTextValue || ''}`, { size: 9, indent: 12, gap: 6 });
    if (secondName) line(`${secondName}: ${row.customTextValue2 || ''}`, { size: 9, indent: 12, gap: 6 });
    if (choice) line(`${choice.name}: ${choice.options.includes(row.customChoiceValue) ? row.customChoiceValue : ''}`, { size: 9, indent: 12, gap: 6 });
    if (secondChoice) line(`${secondChoice.name}: ${choiceValue(row.customChoiceValue2, secondChoice.options)}`, { size: 9, indent: 12, gap: 6 });
    if (number) line(`${number.name}: ${numberText(row.customNumberValue)}`, { size: 9, indent: 12, gap: 6 });
    if (secondNumber) line(`${secondNumber.name}: ${numberText(row.customNumberValue2)}`, { size: 9, indent: 12, gap: 6 });
    if (checkmark) line(`${checkmark.name}: ${checkmarkText(row.customCheckmarkValue)}`, { size: 9, indent: 12, gap: 6 });
    if (formula) line(`${formula.name}: ${formulaText(formula.source === 'customNumber2'
      ? row.customNumberValue2 : row.customNumberValue, formula,
      row.customChoiceValue, choice)}`, { size: 9, indent: 12, gap: 6 });
    if (row.statusHistory?.length && showStatusHistory) {
      line(latestStatusOnly ? 'Latest status:' : 'Status history:', { size: 9, indent: 12, gap: 4 });
      for (const entry of row.statusHistory) {
        line(`${entry.label} by ${entry.author || 'Unknown'}${entry.date ? ` (${entry.date})` : ''}`,
          { size: 9, indent: 28, gap: 4 });
      }
      y -= 2;
    }
    if (row.replyRows?.length) {
      // The thread as indented rows under its markup, oldest first.
      line('Replies:', { size: 9, indent: 12, gap: 4 });
      for (const reply of row.replyRows) {
        line(`${reply.author || 'Unknown'}: ${reply.text || ''}${reply.createdAt ? ` (${reply.createdAt})` : ''}`,
          { size: 9, indent: 28, gap: 4 });
      }
      y -= 2;
    } else if (row.replies) line(`Replies: ${row.replies}`, { size: 9, indent: 12, gap: 6 });
    if (row.layer) line(`Layer: ${row.layer}`, { size: 9, indent: 12, gap: 6 });
    if (row.space) line(`Space: ${row.space}`, { size: 9, indent: 12, gap: 6 });
    if (row.createdAt || row.modifiedAt) line(`Created: ${row.createdAt || 'Unknown'} | Modified: ${row.modifiedAt || 'Unknown'}`, { size: 9, color: muted, indent: 12, gap: 6 });
    if (row.measurementText !== null && row.measurementText !== undefined) {
      line(`Measurement shown on markup: ${row.measurementText || 'No value recorded'} | UNVERIFIED - scale and units not validated by this report.`, { size: 9, color: accent, indent: 12, gap: 6 });
    }
    separator();
  }

  if (fallback.used) line('Some source characters are shown as [U+XXXX] because the bundled report font cannot render them. The CSV export retains the original text.', { size: 9, color: muted });
  for (const [index, sheet] of pages.entries()) {
    sheet.drawLine({ start: { x: MARGIN, y: 43 }, end: { x: WIDTH - MARGIN, y: 43 }, thickness: 0.5, color: rgb(0.78, 0.8, 0.82) });
    const mark = drawBrandMark(sheet, MARGIN, 26, 10);
    sheet.drawText(`${edition.productName} | Markups List | Page ${index + 1} of ${pages.length}`, { x: MARGIN + mark + 5, y: 28, font, size: 8, color: muted });
  }
  return document.save();
}
