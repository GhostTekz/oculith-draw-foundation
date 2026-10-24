// Stored spaces in the PDF: one /OPS_Spaces array per page, owned by OcuDraw.
//
//   /OPS_Spaces [ << /OPS_Id (sp-…) /Name <FEFF…> /C [r g b]
//                    /Path [x0 y0 x1 y1 …] /OPS_Parent (sp-…) /OPS_Hidden true >> … ]
//
// /Path is the outline in default user space (CropBox origin, without
// /Rotate), like the /BBox of a viewport (pdf/viewports-vp.js); the app
// keeps spaces in app space (displayed page, y down). Other readers ignore
// the private key. Floor-plan rooms are annotations and are not written
// here (their space colour rides on the room, saver/plattegrond-meta.js).
//
// Ownership: every save replaces the array with the model's spaces. While
// the file's spaces have not been read into the model yet (doc._spacesRead
// === false), the file's entries stay, except those whose id the model has.

import { PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, PDFBool } from 'pdf-lib';
import { geerfd, rechthoek, doorsnede, puntNaarAppRuimte } from '../pdf/pdf-viewports.js';
import { puntUitAppRuimte } from '../pdf/viewports-vp.js';
import { normalizeSpace, MAX_SPACES_PER_PAGE, MAX_SPACE_POINTS } from './model.js';
import { pageUserUnit } from '../pdf/page-user-unit.js';

export const SPACES_KEY = 'OPS_Spaces';

const rotationOf = (r) => (((Number(r) || 0) % 360) + 360) % 360;
const num = (o) => (o instanceof PDFNumber ? o.asNumber() : null);
const text = (o) => {
  if (o instanceof PDFString || o instanceof PDFHexString) {
    try { return o.decodeText(); } catch { return ''; }
  }
  return '';
};
const round = (n) => Number(n.toFixed(4));

function viewBoxOf(node) {
  const media = rechthoek(geerfd(node, 'MediaBox'));
  if (!media) return null;
  const v = doorsnede(media, rechthoek(geerfd(node, 'CropBox')));
  return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [1, 2, 3].map((i) => round(parseInt(m[i], 16) / 255)) : null;
}

function rgbToHex(arr) {
  if (!(arr instanceof PDFArray) || arr.size() !== 3) return null;
  const v = [0, 1, 2].map((i) => num(arr.lookup(i)));
  if (!v.every((n) => n !== null && n >= 0 && n <= 1)) return null;
  return `#${v.map((n) => Math.round(n * 255).toString(16).padStart(2, '0')).join('')}`;
}

function spaceDict(context, s, box, rotation, userUnit) {
  const coords = [];
  for (const p of s.points) {
    const [u, v] = puntUitAppRuimte(p.x, p.y, box, rotation, userUnit);
    coords.push(round(u), round(v));
  }
  const d = context.obj({});
  d.set(PDFName.of('OPS_Id'), PDFString.of(s.id));
  d.set(PDFName.of('Name'), PDFHexString.fromText(s.name));
  const rgb = hexToRgb(s.color);
  if (rgb) d.set(PDFName.of('C'), context.obj(rgb));
  d.set(PDFName.of('Path'), context.obj(coords));
  if (s.parentId) d.set(PDFName.of('OPS_Parent'), PDFString.of(s.parentId));
  if (s.hidden) d.set(PDFName.of('OPS_Hidden'), PDFBool.True);
  return d;
}

/**
 * Writes the stored spaces (doc.spaces) to their pages.
 * @param {import('pdf-lib').PDFDocument} pdfDocLib
 * @param {Array<object>} spaces
 * @param {{extraRotatie?:Record<number, number>, volledig?:boolean}} [opties]
 *   extraRotatie: the app's own page rotation on top of /Rotate (the saver
 *   applies it to the page afterwards); volledig: the model holds the file's
 *   spaces (false while they are still being read)
 * @returns {number} spaces written
 */
export function writeSpaces(pdfDocLib, spaces, opties = {}) {
  const complete = opties.volledig !== false;
  const context = pdfDocLib.context;
  const pages = pdfDocLib.getPages();
  const perPage = new Map();
  const modelIds = new Set();
  for (const raw of spaces || []) {
    const s = normalizeSpace(raw);
    if (!s || s.page > pages.length) continue;
    if (!perPage.has(s.page)) perPage.set(s.page, []);
    perPage.get(s.page).push(s);
    modelIds.add(s.id);
  }
  let written = 0;
  pages.forEach((page, i) => {
    const nr = i + 1;
    const node = page.node;
    const old = node.lookup(PDFName.of(SPACES_KEY));
    const fresh = (perPage.get(nr) || []).slice(0, MAX_SPACES_PER_PAGE);
    if (!fresh.length && !(old instanceof PDFArray)) return;
    const keep = [];
    if (!complete && old instanceof PDFArray) {
      for (let j = 0; j < old.size(); j++) {
        const d = old.lookup(j);
        if (!(d instanceof PDFDict)) continue;
        const id = text(d.lookup(PDFName.of('OPS_Id')));
        if (id && modelIds.has(id)) continue;
        keep.push(old.get(j));
      }
    }
    const box = viewBoxOf(node);
    if (box) {
      const rotation = rotationOf(page.getRotation().angle + (Number(opties.extraRotatie?.[nr]) || 0));
      for (const s of fresh) {
        keep.push(spaceDict(context, s, box, rotation, pageUserUnit(page)));
        written += 1;
      }
    }
    if (keep.length) node.set(PDFName.of(SPACES_KEY), context.obj(keep));
    else node.delete(PDFName.of(SPACES_KEY));
  });
  return written;
}

/**
 * The stored spaces of a pdf-lib document, in app space.
 * @param {import('pdf-lib').PDFDocument} pdfLibDoc
 * @returns {Array<{id, page, name, color, parentId, points, hidden}>}
 */
export function readSpaces(pdfLibDoc) {
  const out = [];
  let pages;
  try { pages = pdfLibDoc.getPages(); } catch { return out; }
  pages.forEach((page, i) => {
    try {
      const node = page.node;
      const arr = node.lookup(PDFName.of(SPACES_KEY));
      if (!(arr instanceof PDFArray) || arr.size() > MAX_SPACES_PER_PAGE) return;
      const box = viewBoxOf(node);
      if (!box) return;
      const rotation = rotationOf(num(geerfd(node, 'Rotate')) || 0);
      const userUnit = pageUserUnit(page);
      for (let j = 0; j < arr.size(); j++) {
        const d = arr.lookup(j);
        if (!(d instanceof PDFDict)) continue;
        const path = d.lookup(PDFName.of('Path'));
        if (!(path instanceof PDFArray) || path.size() < 6 || path.size() > 2 * MAX_SPACE_POINTS) continue;
        const points = [];
        for (let k = 0; k + 1 < path.size(); k += 2) {
          const x = num(path.lookup(k)), y = num(path.lookup(k + 1));
          if (x === null || y === null) { points.length = 0; break; }
          const [ax, ay] = puntNaarAppRuimte(x, y, box, rotation, userUnit);
          points.push({ x: ax, y: ay });
        }
        const hidden = d.lookup(PDFName.of('OPS_Hidden'));
        const s = normalizeSpace({
          id: text(d.lookup(PDFName.of('OPS_Id'))),
          page: i + 1,
          name: text(d.lookup(PDFName.of('Name'))),
          color: rgbToHex(d.lookup(PDFName.of('C'))),
          parentId: text(d.lookup(PDFName.of('OPS_Parent'))) || null,
          points,
          hidden: hidden instanceof PDFBool && hidden.asBoolean(),
        });
        if (s) out.push(s);
      }
    } catch {
      // A broken entry on one page does not stop the others.
    }
  });
  return out;
}
