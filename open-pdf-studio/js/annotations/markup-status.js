// Markup review status: the status set, status labels and colours, and the
// status history (who set which status when).
//
// The default set is the external editor's: None, Accepted, Rejected, Completed, Cancelled.
// A document can define its own set (names with a colour), stored in the PDF
// catalog (pdf/markup-status-set.js), like the custom Markups List columns.
// A status is kept on a markup as its lower-case key ('accepted'); every
// change can be recorded in `statusHistory` as { state, author, date }, and
// the saver writes each entry as a review-status reply (Text + /IRT + /State
// + /StateModel /Review, ISO 32000-1 12.5.6.10). No app imports here.

export const STATUS_SET_SCHEMA_VERSION = 1;
export const STATUS_SET_NAME_MAX = 48;
export const STATUS_NAME_MAX = 32;
export const STATUSES_MAX = 20;
export const STATUS_SET_JSON_MAX = 4096;
export const STATUS_HISTORY_MAX = 200;

const NONE_COLOR = '#888888';

export const DEFAULT_STATUS_SET = Object.freeze({
  version: STATUS_SET_SCHEMA_VERSION,
  name: 'Review',
  statuses: Object.freeze([
    Object.freeze({ name: 'Accepted', color: '#22c55e' }),
    Object.freeze({ name: 'Rejected', color: '#ef4444' }),
    Object.freeze({ name: 'Completed', color: '#3b82f6' }),
    Object.freeze({ name: 'Cancelled', color: '#6b7280' }),
  ]),
});

// Statuses written by earlier versions or other programs keep their colour.
const KNOWN_COLORS = { accepted: '#22c55e', rejected: '#ef4444', completed: '#3b82f6',
  cancelled: '#6b7280', reviewed: '#8b5cf6' };

/** The lower-case key of a status ('' and undefined are 'none'). */
export function statusKey(status) {
  const key = String(status ?? '').trim().toLocaleLowerCase();
  return key || 'none';
}

function singleLine(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) return '';
  return text;
}

/** A valid user status set, or null. */
export function statusSet(definition) {
  if (!definition || typeof definition !== 'object' || definition.version !== STATUS_SET_SCHEMA_VERSION) return null;
  const name = singleLine(definition.name, STATUS_SET_NAME_MAX);
  if (!name || !Array.isArray(definition.statuses)) return null;
  if (!definition.statuses.length || definition.statuses.length > STATUSES_MAX) return null;
  const seen = new Set();
  const statuses = [];
  for (const entry of definition.statuses) {
    const statusName = singleLine(entry?.name, STATUS_NAME_MAX);
    const key = statusName.toLocaleLowerCase();
    if (!statusName || key === 'none' || seen.has(key)) return null;
    const color = typeof entry.color === 'string' && /^#[0-9a-f]{6}$/iu.test(entry.color)
      ? entry.color.toLowerCase() : null;
    if (!color) return null;
    seen.add(key);
    statuses.push({ name: statusName, color });
  }
  return { version: STATUS_SET_SCHEMA_VERSION, name, statuses };
}

/**
 * Parse the status set editor's lines: "Name #rrggbb" (colour optional; a
 * missing colour takes the default status colour or grey).
 */
export function parseStatusLines(name, text) {
  const statuses = String(text ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^(.*?)\s+(#[0-9a-f]{6})$/iu);
    const statusName = (match ? match[1] : line).trim();
    return { name: statusName, color: match ? match[2] : (KNOWN_COLORS[statusName.toLocaleLowerCase()] || NONE_COLOR) };
  });
  return statusSet({ version: STATUS_SET_SCHEMA_VERSION, name, statuses });
}

export function statusLines(set) {
  return (statusSet(set) || DEFAULT_STATUS_SET).statuses.map(s => `${s.name} ${s.color}`).join('\n');
}

/** The statuses a markup can be given: None first, then the active set. */
export function statusOptions(set) {
  const active = statusSet(set) || DEFAULT_STATUS_SET;
  return [{ key: 'none', name: 'None', color: null },
    ...active.statuses.map(s => ({ key: s.name.toLocaleLowerCase(), name: s.name, color: s.color }))];
}

/** Display name of a status: the set's own spelling, else capitalised. */
export function statusLabel(status, set) {
  const key = statusKey(status);
  if (key === 'none') return 'None';
  const found = (statusSet(set) || DEFAULT_STATUS_SET).statuses.find(s => s.name.toLocaleLowerCase() === key)
    || DEFAULT_STATUS_SET.statuses.find(s => s.name.toLocaleLowerCase() === key);
  if (found) return found.name;
  const raw = String(status).trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function statusColor(status, set) {
  const key = statusKey(status);
  if (key === 'none') return null;
  const found = (statusSet(set) || DEFAULT_STATUS_SET).statuses.find(s => s.name.toLocaleLowerCase() === key);
  return found?.color || KNOWN_COLORS[key] || NONE_COLOR;
}

function validDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

/**
 * The status history of a markup, oldest first. A status set without a
 * recorded change (an older file, or another editor) is added at the end
 * from statusBy/statusAt, so the history always ends with the current status.
 */
export function statusHistory(annotation) {
  const raw = Array.isArray(annotation?.statusHistory) ? annotation.statusHistory : [];
  const entries = raw
    .filter(entry => entry && typeof entry === 'object')
    .map((entry, index) => ({ state: statusKey(entry.state), author: String(entry.author || 'User'),
      date: validDate(entry.date), index }))
    .sort((a, b) => (a.date && b.date && a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.index - b.index))
    .map(({ state, author, date }) => ({ state, author, date }));
  const current = statusKey(annotation?.status);
  const last = entries.at(-1);
  if (current !== 'none' ? last?.state !== current : (last && last.state !== 'none')) {
    entries.push({ state: current, author: String(annotation?.statusBy || annotation?.author || 'User'),
      date: validDate(annotation?.statusAt) || validDate(annotation?.modifiedAt) || '' });
  }
  return entries;
}

/**
 * Set a markup's status and record the change. Mutates `annotation`; the
 * caller wraps it in an undo step. Returns false when nothing changes.
 */
export function applyStatusChange(annotation, status, author, now = new Date()) {
  if (!annotation) return false;
  const key = statusKey(status);
  if (key === statusKey(annotation.status)) return false;
  const date = new Date(now).toISOString();
  // Keep what was there before as history, so the first recorded change
  // does not lose a status that came from an older file.
  const history = statusHistory(annotation);
  history.push({ state: key, author: String(author || 'User'), date });
  annotation.statusHistory = history.slice(-STATUS_HISTORY_MAX);
  if (key === 'none') {
    delete annotation.status;
    delete annotation.statusBy;
    delete annotation.statusAt;
  } else {
    annotation.status = key;
    annotation.statusBy = String(author || 'User');
    annotation.statusAt = date;
  }
  return true;
}
