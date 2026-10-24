// Hoeveelheden — schedule-engine (puur). filter → sorteer → groepeer → totaliseer.
import { categoryOf, fieldsForCategories, qLabel } from './categories.js';

const OPS = {
  '=':   (a, b) => String(a ?? '') === String(b ?? ''),
  '!=':  (a, b) => String(a ?? '') !== String(b ?? ''),
  '>':   (a, b) => Number(a) > Number(b),
  '>=':  (a, b) => Number(a) >= Number(b),
  '<':   (a, b) => Number(a) < Number(b),
  '<=':  (a, b) => Number(a) <= Number(b),
  'has': (a) => a != null && a !== '',
  'none': (a) => a == null || a === '',
};

function cmp(a, b) {
  const na = typeof a === 'number', nb = typeof b === 'number';
  if (na && nb) return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

// Een kolom mag alleen een eenheid in de kop krijgen als elke numerieke rij
// dezelfde bekende eenheid heeft. Anders staan de eenheden bij de rijen zelf.
function eenheidVoor(f, rows) {
  if (typeof f.unitOf !== 'function') return f.unit;
  const units = new Set(rows.filter(r => typeof r.vals[f.key] === 'number')
    .map(r => r.units[f.key] || ''));
  return units.size === 1 ? [...units][0] : '';
}

// Page points are the uncalibrated unit. A format label must not replace them.
function pagePointUnit(unit) {
  return /^pt[²³]?$/u.test(unit || '');
}

function applyFmt(f, fmt, rows) {
  const isImage = f.kind === 'image';
  const unit = eenheidVoor(f, rows);
  const base = {
    ...f,
    unit,
    unitConflict: typeof f.unitOf === 'function' && !unit
      && rows.some(r => typeof r.vals[f.key] === 'number'),
    decimals: f.dec != null ? f.dec : (f.kind === 'number' ? 2 : 0),
    align: f.kind === 'number' ? 'right' : 'left',
    // Beeldkolommen tellen nooit mee in som/subtotalen.
    total: !isImage,
  };
  if (isImage) return { ...base, total: false };
  if (!fmt) return base;
  // A custom heading may rename a known unit, but cannot give an
  // uncalibrated or mixed column a fabricated physical unit.
  const blockUnit = typeof f.unitOf === 'function' && (!base.unit || pagePointUnit(base.unit));
  return {
    ...base,
    label: fmt.heading || f.label,
    unit: blockUnit ? base.unit : (fmt.unit != null ? fmt.unit : base.unit),
    decimals: fmt.decimals != null ? fmt.decimals : base.decimals,
    align: fmt.align || base.align,
    total: fmt.total !== false,
  };
}

function safeGet(f, el) {
  try { return f.get(el); } catch { return null; }
}

function subtotal(rows, colDefs) {
  const out = {};
  for (const f of colDefs) {
    if (f.kind !== 'number' || f.total === false) continue;
    // A mixed column has no safe unit for any displayed subtotal, even if an
    // individual group happens to contain only one of the units.
    if (typeof f.unitOf === 'function' && !f.unit) { out[f.key] = null; continue; }
    let sum = 0, any = false;
    const units = new Set();
    for (const r of rows) {
      const v = r.vals[f.key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (typeof f.unitOf === 'function') units.add(r.units[f.key] || '');
        sum += v;
        any = true;
      }
    }
    // No physical total can be claimed across units, or for a legacy
    // measurement whose unit is absent.
    out[f.key] = any && (typeof f.unitOf !== 'function' || (units.size === 1 && !units.has('')))
      ? sum : null;
  }
  return out;
}

function groupBy(rows, fieldKey, colDefs) {
  const map = new Map();
  for (const r of rows) {
    const k = r.vals[fieldKey];
    const kk = (k == null || k === '') ? qLabel('quantities.none', '(none)') : String(k);
    if (!map.has(kk)) map.set(kk, []);
    map.get(kk).push(r);
  }
  return [...map.entries()].map(([key, grows]) => ({
    key, rows: grows, subtotals: subtotal(grows, colDefs),
  }));
}

/**
 * @param elements  ruwe elementen (annotaties + pseudo-elementen)
 * @param cfg       { categories:[key], fields:[key], filters:[{field,op,value}],
 *                    sort:[{field,dir,group,header,footer}], itemize, format:{[key]:{...}} }
 * @returns { columns, groups:[{key,rows,subtotals}], grandTotals, count, itemize }
 */
export function buildSchedule(elements, cfg = {}) {
  const cats = (cfg.categories && cfg.categories.length) ? cfg.categories : [];
  const allFields = fieldsForCategories(cats);

  const relevant = (elements || []).filter(el => cats.includes(categoryOf(el)));

  let rows = relevant
    .map(el => ({
      el,
      vals: Object.fromEntries(allFields.map(f => [f.key, safeGet(f, el)])),
      units: Object.fromEntries(allFields.filter(f => typeof f.unitOf === 'function')
        .map(f => {
          try { return [f.key, f.unitOf(el) || '']; } catch { return [f.key, '']; }
        })),
    }));

  for (const flt of (cfg.filters || [])) {
    if (!flt || !flt.field || !flt.op || !OPS[flt.op]) continue;
    rows = rows.filter(r => OPS[flt.op](r.vals[flt.field], flt.value));
  }

  // Kolommen volgen de gefilterde rijen; een gemengde schaal krijgt geen
  // misleidende gemeenschappelijke eenheid in de kop.
  const colDefs = (cfg.fields || [])
    .map(k => allFields.find(f => f.key === k))
    .filter(Boolean)
    .map(f => applyFmt(f, cfg.format && cfg.format[f.key], rows));

  const levels = (cfg.sort || []).filter(s => s && s.field);
  if (levels.length) {
    rows.sort((a, b) => {
      for (const s of levels) {
        const c = cmp(a.vals[s.field], b.vals[s.field]) * (s.dir === 'desc' ? -1 : 1);
        if (c) return c;
      }
      return 0;
    });
  }

  const groupLevel = levels.find(s => s.group);
  const groups = groupLevel
    ? groupBy(rows, groupLevel.field, colDefs)
    : [{ key: null, rows, subtotals: subtotal(rows, colDefs) }];

  return {
    columns: colDefs,
    groups,
    grandTotals: subtotal(rows, colDefs),
    count: rows.length,
    itemize: cfg.itemize !== false,
  };
}
