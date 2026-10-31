// How often and how lately each command ran (menus, toolbars, keys, the
// command palette). The palette lists recent commands first on an empty
// query and lifts frequent ones in its ranking. Kept per machine in
// localStorage; it is a convenience, so a missing or blocked store simply
// starts empty.
//
// Shape: { [commandId]: { n: runs, t: last run (ms) } }, at most MAX_ENTRIES.

import { createSignal } from 'solid-js';
import { onCommandRun } from '../commands/registry.js';

export const USAGE_KEY = 'ocudraw.commandUsage';
export const MAX_ENTRIES = 200;
const DAY = 24 * 60 * 60 * 1000;

/** A new usage map with one more run of id at `now` (pure). */
export function withUse(usage, id, now = Date.now()) {
  const prev = usage?.[id];
  const next = { ...(usage || {}), [id]: { n: (prev?.n || 0) + 1, t: now } };
  const ids = Object.keys(next);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => next[a].t - next[b].t);
    for (const old of ids.slice(0, ids.length - MAX_ENTRIES)) delete next[old];
  }
  return next;
}

/**
 * Ranking boost 0-40 for an entry: frequency (log scale) plus recency
 * (full in the first hour, fading over two weeks). Pure.
 */
export function usageBoost(entry, now = Date.now()) {
  if (!entry || !entry.n) return 0;
  const frequency = Math.min(20, Math.log2(1 + entry.n) * 5);
  const age = Math.max(0, now - (entry.t || 0));
  const recency = age < DAY / 24 ? 20 : Math.max(0, 20 * (1 - age / (14 * DAY)));
  return Math.round(frequency + recency);
}

/** Command ids, most recent first (pure). */
export function recentIds(usage, limit = 8) {
  return Object.entries(usage || {})
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, limit)
    .map(([id]) => id);
}

function read() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(USAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, e] of Object.entries(raw)) {
      if (e && Number.isFinite(e.n) && Number.isFinite(e.t)) out[id] = { n: e.n, t: e.t };
    }
    return out;
  } catch { return {}; }
}

const [usage, setUsage] = createSignal(read());

/** The usage map (reactive). */
export { usage as commandUsage };

/** Record a run of id (also called for every runCommand, see below). */
export function recordCommandUse(id, now = Date.now()) {
  const next = withUse(usage(), id, now);
  setUsage(next);
  try { globalThis.localStorage?.setItem(USAGE_KEY, JSON.stringify(next)); } catch { /* not kept */ }
}

/** Forget every recorded use. */
export function clearCommandUsage() {
  setUsage({});
  try { globalThis.localStorage?.removeItem(USAGE_KEY); } catch { /* nothing kept */ }
}

// The help.findCommands run that opens the palette is not a choice.
const IGNORED = new Set(['help.findCommands']);
onCommandRun((id) => { if (!IGNORED.has(id)) recordCommandUse(id); });
