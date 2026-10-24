export const COMPARE_PLAN_FORMAT = 'ocudraw.compare-plan';
export const COMPARE_PLAN_VERSION = 2;
export const MAX_COMPARE_PLAN_BYTES = 512 * 1024;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} in compare plan.`);
  }
}

function validPath(path) {
  return typeof path === 'string' && path.trim().length > 0 && path.length <= 4096 && !path.includes('\0');
}

function validCount(count) {
  return Number.isSafeInteger(count) && count > 0;
}

function validTime(value) {
  if (typeof value !== 'string') return false;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value;
}

function validIdentity(value) {
  return record(value) && Object.keys(value).length === 3
    && value.algorithm === 'SHA-256'
    && /^[0-9a-f]{64}$/u.test(value.old)
    && /^[0-9a-f]{64}$/u.test(value.new);
}

export function validateComparePlan(raw, selected = null) {
  if (!record(raw) || raw.format !== COMPARE_PLAN_FORMAT || ![1, COMPARE_PLAN_VERSION].includes(raw.version)) {
    throw new Error('Unsupported compare plan format or version.');
  }
  exactKeys(raw, raw.version === 1
    ? ['format', 'version', 'documents', 'alignment', 'pairs']
    : ['format', 'version', 'documents', 'alignment', 'pairs', 'identity'], 'file structure');
  if (raw.version === COMPARE_PLAN_VERSION && !validIdentity(raw.identity)) {
    throw new Error('Compare plan needs valid SHA-256 fingerprints for both PDFs.');
  }
  exactKeys(raw.documents, ['old', 'new'], 'documents');
  for (const side of ['old', 'new']) {
    const document = raw.documents[side];
    exactKeys(document, ['path', 'pageCount'], `${side} document`);
    if (!validPath(document.path) || !validCount(document.pageCount)) {
      throw new Error(`Invalid ${side} document path or page count.`);
    }
  }
  exactKeys(raw.alignment, ['dx', 'dy', 'rotation'], 'alignment');
  for (const value of Object.values(raw.alignment)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Alignment must contain finite numbers.');
  }
  if (!Array.isArray(raw.pairs)) throw new Error('Compare plan pairs must be a list.');
  const oldPages = new Set();
  const newPages = new Set();
  const pairs = raw.pairs.map((pair, index) => {
    exactKeys(pair, ['oldPage', 'newPage', 'source', 'confirmedAt'], `pair ${index + 1}`);
    if (!Number.isSafeInteger(pair.oldPage) || pair.oldPage < 1 || pair.oldPage > raw.documents.old.pageCount
        || !Number.isSafeInteger(pair.newPage) || pair.newPage < 1 || pair.newPage > raw.documents.new.pageCount) {
      throw new Error(`Page pair ${index + 1} is out of range.`);
    }
    if (oldPages.has(pair.oldPage) || newPages.has(pair.newPage)) {
      throw new Error(`Page pair ${index + 1} duplicates an old or new page.`);
    }
    if (pair.source !== 'manual' || !validTime(pair.confirmedAt)) {
      throw new Error(`Page pair ${index + 1} needs manual confirmation provenance.`);
    }
    oldPages.add(pair.oldPage);
    newPages.add(pair.newPage);
    return { oldPage: pair.oldPage, newPage: pair.newPage, source: 'manual', confirmedAt: pair.confirmedAt };
  });
  if (selected) {
    if (raw.documents.old.path !== selected.oldPath || raw.documents.new.path !== selected.newPath) {
      throw new Error('Compare plan PDFs do not match the selected old and new PDFs.');
    }
    if (raw.documents.old.pageCount !== selected.oldPageCount || raw.documents.new.pageCount !== selected.newPageCount) {
      throw new Error('Compare plan page counts do not match the selected PDFs.');
    }
  }
  return {
    format: COMPARE_PLAN_FORMAT, version: raw.version,
    documents: {
      old: { path: raw.documents.old.path, pageCount: raw.documents.old.pageCount },
      new: { path: raw.documents.new.path, pageCount: raw.documents.new.pageCount },
    },
    alignment: { dx: raw.alignment.dx, dy: raw.alignment.dy, rotation: raw.alignment.rotation },
    pairs,
    ...(raw.version === COMPARE_PLAN_VERSION ? { identity: { ...raw.identity } } : {}),
  };
}

export function buildComparePlan({ oldPath, newPath, oldPageCount, newPageCount, offset, pairs, identity = null }) {
  return validateComparePlan({
    format: COMPARE_PLAN_FORMAT, version: identity ? COMPARE_PLAN_VERSION : 1,
    documents: {
      old: { path: oldPath, pageCount: oldPageCount },
      new: { path: newPath, pageCount: newPageCount },
    },
    alignment: { dx: offset?.dx ?? 0, dy: offset?.dy ?? 0, rotation: offset?.rotation ?? 0 },
    pairs: pairs || [],
    ...(identity ? { identity } : {}),
  });
}

export function parseComparePlanBytes(bytes, selected) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_COMPARE_PLAN_BYTES) {
    throw new Error('Compare plan file is empty or too large.');
  }
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Compare plan is not valid UTF-8 JSON.'); }
  return validateComparePlan(raw, selected);
}

export function serializeComparePlan(plan) {
  const json = JSON.stringify(validateComparePlan(plan), null, 2) + '\n';
  if (new TextEncoder().encode(json).length > MAX_COMPARE_PLAN_BYTES) {
    throw new Error('Compare plan is too large to save.');
  }
  return json;
}

export function suggestedComparePlanName(oldPath, newPath) {
  const name = path => String(path || 'drawing').split(/[\\/]/u).pop().replace(/\.pdf$/iu, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40) || 'drawing';
  return `${name(oldPath)}_vs_${name(newPath)}.ocudraw-compare.json`;
}
