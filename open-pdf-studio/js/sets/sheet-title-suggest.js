import { textItemBox } from '../pdf/region-text.js';

const NUMBER_FIELD = /^(?:sheet|drawing)\s*(?:no\.?|number|#|id)\s*[:#-]?\s*(.*)$/iu;
const TITLE_FIELD = /^(?:(?:sheet|drawing)\s+)?title\s*[:#-]?\s*(.*)$/iu;

function clean(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function validNumber(value) {
  return value.length <= 24 && /^[A-Z][A-Z0-9./-]*\d[A-Z0-9./-]*$/iu.test(value)
    && !/[./-]$/u.test(value);
}

function validTitle(value) {
  return value.length >= 3 && value.length <= 100 && /[\p{L}]/u.test(value)
    && !validNumber(value) && !NUMBER_FIELD.test(value) && !TITLE_FIELD.test(value);
}

function titleBlockLines(items, viewport) {
  if (!Array.isArray(items) || typeof viewport?.convertToViewportPoint !== 'function') return [];
  const hits = [];
  for (const item of items) {
    const value = clean(item?.str);
    if (!value) continue;
    const box = textItemBox(item, viewport);
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (x < viewport.width * 0.65 && y < viewport.height * 0.75) continue;
    hits.push({ value, box, y });
    if (hits.length >= 2000) break;
  }
  hits.sort((a, b) => a.y - b.y || a.box.x - b.box.x);
  const lines = [];
  for (const hit of hits) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - hit.y) <= Math.max(line.height, hit.box.height) * 0.45) {
      line.items.push(hit);
      line.y = (line.y * (line.items.length - 1) + hit.y) / line.items.length;
      line.height = Math.max(line.height, hit.box.height);
    } else lines.push({ y: hit.y, height: hit.box.height, items: [hit] });
  }
  return lines.sort((a, b) => a.y - b.y).map(line => ({
    text: clean(line.items.sort((a, b) => a.box.x - b.box.x).map(item => item.value).join(' ')),
    y: line.y,
    height: line.height,
  }));
}

function field(lines, pattern, valid) {
  const found = [];
  for (let index = 0; index < lines.length; index++) {
    const match = pattern.exec(lines[index].text);
    if (!match) continue;
    const inline = clean(match[1]).replace(/^[:#-]\s*/u, '');
    const next = lines[index + 1];
    const below = next && next.y - lines[index].y <= Math.max(lines[index].height * 4, 35)
      && !NUMBER_FIELD.test(next.text) && !TITLE_FIELD.test(next.text) ? next.text : '';
    const value = [inline, below].find(valid);
    if (value) found.push({ value, snippet: lines[index].text + (value === below ? ` / ${below}` : '') });
  }
  const unique = [...new Set(found.map(item => item.value.toLocaleLowerCase()))];
  return unique.length === 1 ? found[0] : null;
}

/** Conservative suggestions from selectable text in the visible lower/right title block. */
export function suggestSheetDetails(items, viewport) {
  const lines = titleBlockLines(items, viewport);
  const number = field(lines, NUMBER_FIELD, validNumber);
  const title = field(lines, TITLE_FIELD, validTitle);
  return {
    label: number?.value || '',
    title: title?.value || '',
    evidence: { label: number?.snippet || '', title: title?.snippet || '' },
    snippets: lines.slice(0, 8).map(line => line.text.slice(0, 120)),
    selectableText: lines.length > 0,
  };
}
