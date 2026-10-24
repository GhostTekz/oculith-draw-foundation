// Assemblies: a priced parts list the contractor types, attached to a count
// or a length. No labour catalogue and no code tables. Prices are the
// numbers on the recipe, not a formula column.

export const ASSEMBLY_JSON_MAX = 65536;
export const ASSEMBLY_ID_MAX = 64;
const NAME_MAX = 80;
const LINE_MAX = 40;
const RECIPE_MAX = 100;
const QTY_MAX = 1e9;
const PRICE_MAX = 1e12;

const LENGTH_TYPES = new Set(['measureDistance', 'measurePerimeter']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;

/** A stored assembly id, or '' when the text is not one. */
export function assemblyIdText(value) {
  const text = String(value ?? '').trim();
  return text.length <= ASSEMBLY_ID_MAX && ID_RE.test(text) ? text : '';
}

function cleanName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim().slice(0, NAME_MAX);
}

function round6(value) {
  const factor = 1e6;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** One parts line, or null when the name, quantity, unit or price is unusable. */
export function normalizeLine(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  const qty = Number(raw.qty);
  const unitPrice = Number(raw.unitPrice);
  const unit = raw.unit === 'length' ? 'length' : (raw.unit === 'each' ? 'each' : '');
  if (!name || !unit) return null;
  if (!Number.isFinite(qty) || qty <= 0 || qty > QTY_MAX) return null;
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > PRICE_MAX) return null;
  return { name, qty, unit, unitPrice };
}

/** One recipe, or null when it has no id, no name, or no usable line. */
export function normalizeRecipe(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = assemblyIdText(raw.id);
  const name = cleanName(raw.name);
  if (!id || !name) return null;
  const lines = [];
  for (const line of Array.isArray(raw.lines) ? raw.lines : []) {
    if (lines.length >= LINE_MAX) break;
    const next = normalizeLine(line);
    if (next) lines.push(next);
  }
  if (!lines.length) return null;
  return { id, name, lines };
}

/** { v:1, recipes } with invalid rows dropped and ids kept unique. */
export function assembliesModel(value) {
  const incoming = Array.isArray(value) ? value : value?.recipes;
  const recipes = [];
  const seen = new Set();
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    if (recipes.length >= RECIPE_MAX) break;
    const recipe = normalizeRecipe(raw);
    if (!recipe || seen.has(recipe.id)) continue;
    seen.add(recipe.id);
    recipes.push(recipe);
  }
  return { v: 1, recipes };
}

export function isEmptyAssemblies(model) {
  return !model?.recipes?.length;
}

/** A count or a length can carry an assembly. An area cannot. */
export function assemblyHost(ann) {
  return !!ann && (ann.type === 'count' || LENGTH_TYPES.has(ann.type));
}

function eachCount(ann) {
  const count = Number(ann?.count);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

/**
 * Calibrated length of a length markup. A count, a page-point length, or
 * measureCalibrated === false is uncalibrated. A blank measureValue is not
 * a scale problem; there is simply nothing to multiply.
 */
function lengthOf(ann) {
  if (!LENGTH_TYPES.has(ann?.type)) return { ok: false, uncalibrated: true };
  const unit = String(ann.measureUnit || '').trim();
  if (ann.measureCalibrated === false || !unit || unit === 'pt') {
    return { ok: false, uncalibrated: true };
  }
  if (ann.measureValue === null || ann.measureValue === undefined || ann.measureValue === '') {
    return { ok: false, uncalibrated: false };
  }
  const value = Number(ann.measureValue);
  if (!Number.isFinite(value)) return { ok: false, uncalibrated: false };
  return { ok: true, value, unit };
}

/**
 * Price one markup against one recipe. Each-lines multiply by the count
 * (1, or ann.count when that is positive). Length-lines multiply by the
 * calibrated length. An uncalibrated length line is omitted and scaleNotSet
 * is set. Extended is quantity times the typed unit price.
 */
export function evaluateAssembly(markup, recipe) {
  const normalized = normalizeRecipe(recipe);
  const empty = { lines: [], scaleNotSet: false };
  if (!markup || !normalized) return empty;
  const count = eachCount(markup);
  const length = lengthOf(markup);
  const lines = [];
  let scaleNotSet = false;
  for (const line of normalized.lines) {
    if (line.unit === 'each') {
      const quantity = round6(count * line.qty);
      lines.push({
        name: line.name, quantity, unit: 'each', unitPrice: line.unitPrice,
        extended: round6(quantity * line.unitPrice),
      });
      continue;
    }
    if (!length.ok) {
      if (length.uncalibrated) scaleNotSet = true;
      continue;
    }
    const quantity = round6(length.value * line.qty);
    lines.push({
      name: line.name, quantity, unit: length.unit, unitPrice: line.unitPrice,
      extended: round6(quantity * line.unitPrice),
    });
  }
  return { lines, scaleNotSet };
}

/**
 * One CSV row per priced part, plus one scale-not-set row when a length
 * part was skipped. A markup is listed once per part. Rows are not summed
 * into a parent.
 */
export function bidLines(doc) {
  const recipes = assembliesModel(doc?.assemblies).recipes;
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const rows = [];
  for (const ann of doc?.annotations || []) {
    if (!ann?.assemblyId) continue;
    const recipe = byId.get(ann.assemblyId);
    if (!recipe) continue;
    const priced = evaluateAssembly(ann, recipe);
    for (const line of priced.lines) {
      rows.push({
        assembly: recipe.name,
        part: line.name,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        extended: line.extended,
        markupId: ann.id,
        scaleNotSet: false,
      });
    }
    if (priced.scaleNotSet) {
      rows.push({
        assembly: recipe.name, part: '', quantity: '', unit: '', unitPrice: '',
        extended: '', markupId: ann.id, scaleNotSet: true,
      });
    }
  }
  return rows;
}

export const ASSEMBLY_CSV_COLUMNS = Object.freeze([
  'assembly', 'part', 'quantity', 'unit', 'unitPrice', 'extended', 'markupId', 'scaleNotSet',
]);

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV of bidLines. The caller adds a UTF-8 BOM when it writes a file. */
export function assembliesCsv(doc) {
  const lines = [ASSEMBLY_CSV_COLUMNS.join(',')];
  for (const row of bidLines(doc)) {
    lines.push([
      row.assembly, row.part, row.quantity, row.unit, row.unitPrice, row.extended,
      row.markupId, row.scaleNotSet ? 'yes' : '',
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}
