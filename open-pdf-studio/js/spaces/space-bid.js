// Bid by space. One row per space, from markupsInSpace (a parent already
// includes its sub-spaces; do not add child rows on top of that). The
// document total counts every markup once, so it is not the sum of the rows.
//
// Count, length, area, volume and wall area come from measurementQuantities.
// Count needs no scale. Any other physical number that is not calibrated
// stays out of its total and increments scaleNotSet once per number. Mixed
// units suppress that physical total. Prices are formula-column results only.

import { collectSpaces, markupsInSpace, spacePathText, spaceTree } from './model.js';
import {
  expressionColumns, expressionColumnTotals, measurementQuantities,
} from '../annotations/formula-captions.js';

export const SPACE_BID_COLUMNS = Object.freeze([
  'Path', 'Page', 'Count', 'Length', 'Area', 'Volume', 'Wall area',
]);
export const SPACE_BID_SCALE_COLUMN = 'Scale not set';
export const SPACE_BID_DOCUMENT = 'Document';
export const BID_MIXED_UNITS = 'Mixed or unknown units';

const PHYSICAL = Object.freeze([
  ['length', ''],
  ['area', '²'],
  ['volume', '³'],
  ['wallArea', '²'],
]);

function round6(value) {
  const factor = 1e6;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9) / factor;
  return rounded === 0 ? 0 : rounded;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Cell text for one physical total. Mixed units are not converted. */
export function bidQuantityText(value, unit, mixed) {
  if (mixed) return BID_MIXED_UNITS;
  if (value === null || value === undefined) return '';
  return unit ? `${value} ${unit}` : String(value);
}

function emptyPhysical() {
  const out = { count: 0, scaleNotSet: 0 };
  for (const [key] of PHYSICAL) {
    out[key] = 0;
    out[`${key}Unit`] = '';
    out[`${key}Mixed`] = false;
    out[`_${key}Seen`] = false;
  }
  return out;
}

/** Totals for one markup list. Does not look at other rows. */
export function bidQuantities(markups) {
  const totals = emptyPhysical();
  const byUnit = Object.fromEntries(PHYSICAL.map(([key]) => [key, new Map()]));
  for (const ann of markups || []) {
    const q = measurementQuantities(ann);
    if (Number.isFinite(q.count)) totals.count += q.count;
    for (const [key] of PHYSICAL) {
      const value = q[key];
      if (!Number.isFinite(value)) continue;
      if (!q.calibrated) {
        totals.scaleNotSet += 1;
        totals[`_${key}Seen`] = true;
        continue;
      }
      const unit = q.unit || '';
      const map = byUnit[key];
      map.set(unit, (map.get(unit) || 0) + value);
    }
  }
  for (const [key, suffix] of PHYSICAL) {
    const map = byUnit[key];
    if (map.size > 1) {
      totals[key] = null;
      totals[`${key}Unit`] = '';
      totals[`${key}Mixed`] = true;
    } else if (map.size === 1) {
      const [unit, sum] = map.entries().next().value;
      totals[key] = round6(sum);
      totals[`${key}Unit`] = unit ? `${unit}${suffix}` : '';
      totals[`${key}Mixed`] = false;
    } else if (totals[`_${key}Seen`]) {
      totals[key] = null;
    }
    delete totals[`_${key}Seen`];
  }
  return totals;
}

function formulaCells(markups, doc, columns) {
  return expressionColumnTotals(markups, doc, columns).map((total) => ({
    name: total.name,
    total: total.counted ? total.total : null,
    text: total.text,
  }));
}

function bidRow(markups, doc, columns, meta) {
  return {
    id: meta.id,
    path: meta.path,
    page: meta.page,
    level: meta.level || 0,
    documentTotal: meta.documentTotal === true,
    ...bidQuantities(markups),
    formulas: formulaCells(markups, doc, columns),
  };
}

function documentMarkups(doc) {
  return (doc?.annotations || []).filter((ann) => ann && ann.type !== 'scaleRegion');
}

/**
 * Rows in space-tree order, and a document total over every markup once
 * (scale regions excluded, same as markupsInSpace).
 */
export function spaceBid(doc) {
  const columns = expressionColumns(doc?.formulaCaptions?.columns);
  const rows = spaceTree(collectSpaces(doc)).map(({ space, level }) => bidRow(
    markupsInSpace(doc, space.id), doc, columns,
    { id: space.id, path: spacePathText(space), page: space.page, level },
  ));
  const total = bidRow(documentMarkups(doc), doc, columns, {
    id: null, path: SPACE_BID_DOCUMENT, page: '', level: 0, documentTotal: true,
  });
  return { formulaNames: columns.map((column) => column.name), rows, total };
}

/** CSV cells of one bid row, in SPACE_BID_COLUMNS order plus formulas. */
export function bidCsvValues(row) {
  return [
    row.path,
    row.page,
    row.count,
    bidQuantityText(row.length, row.lengthUnit, row.lengthMixed),
    bidQuantityText(row.area, row.areaUnit, row.areaMixed),
    bidQuantityText(row.volume, row.volumeUnit, row.volumeMixed),
    bidQuantityText(row.wallArea, row.wallAreaUnit, row.wallAreaMixed),
    ...row.formulas.map((formula) => formula.text),
    row.scaleNotSet,
  ];
}

/** CSV of the space rows plus the document total. No price book, no BOM. */
export function spaceBidCsv(doc) {
  const bid = spaceBid(doc);
  const header = [...SPACE_BID_COLUMNS, ...bid.formulaNames, SPACE_BID_SCALE_COLUMN];
  const lines = [header.map(csvCell).join(',')];
  for (const row of [...bid.rows, bid.total]) lines.push(bidCsvValues(row).map(csvCell).join(','));
  return lines.join('\n');
}
