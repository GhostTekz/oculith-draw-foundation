// Slip sheet provenance: the markup an annotation was carried forward from.
//
// A carried markup gets a NEW identity on the new revision; `carriedFrom`
// names its source (sheet, revision, PDF, page and, for shapes with a durable
// ID, that ID). It is saved as the private PDF text key /OPS_CarriedFromV1
// holding a small JSON object. PDF bytes are untrusted: the reader bounds the
// text, accepts only the known fields and drops everything else. No app
// imports, so the loader, saver and Node tests share it.

export const CARRIED_FROM_MAX = 2048;

const LIMITS = { sheetId: 128, sheet: 128, revision: 64, file: 1024 };

function text(value, max) {
  if (typeof value !== 'string') return '';
  const clean = value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  return clean.length <= max ? clean : '';
}

/** A validated provenance object, or null. */
export function normalizeCarriedFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const item = text(value[key], max);
    if (item) result[key] = item;
  }
  const page = Number(value.page);
  if (Number.isSafeInteger(page) && page >= 1) result.page = page;
  if (typeof value.markupId === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(value.markupId)) {
    result.markupId = value.markupId;
  }
  // A reference without its source PDF page is not a provenance record.
  return result.file && result.page ? result : null;
}

/** The wire text for /OPS_CarriedFromV1, or '' when there is nothing valid to write. */
export function carriedFromText(value) {
  const clean = normalizeCarriedFrom(value);
  if (!clean) return '';
  const json = JSON.stringify(clean);
  return json.length <= CARRIED_FROM_MAX ? json : '';
}

/** Parse /OPS_CarriedFromV1 text from an untrusted PDF. */
export function parseCarriedFrom(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > CARRIED_FROM_MAX) return null;
  try {
    return normalizeCarriedFrom(JSON.parse(raw));
  } catch {
    return null;
  }
}
