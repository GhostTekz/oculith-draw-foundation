// The command palette (Ctrl+K, Ctrl+Shift+P, Help ▸ Find Tools + Commands,
// components/CommandPalette.jsx): one fuzzy search over every registry
// command (menus, tools, panels, workflow tabs, and the commands editions
// and add-ons register), the pages of the open drawing, the open documents,
// recent files and add-on tool palettes. Kept free of JSX so it is unit
// tested (palette.test.mjs).
//
// Ranking, per query word (all words must match): label exact > prefix >
// word prefix > initials ("ep" → Extract Pages) > substring > a compact
// subsequence that starts at a word; keywords and the menu/workflow path
// count less, the id least. In keywords, path and id only whole-word
// evidence counts: a short prefix of a long word ("count" in
// "counterclockwise") is weak and scattered letters do not match at all.
// A word typed in full that matches the label as a whole adds a bonus.
// Weak matches (only path, id, substring, subsequence or a short prefix)
// are dropped when they score far below the best hit and are capped in
// number. Recent and frequent commands (stores/commandUsage.js) are lifted
// a little; an exact match still wins. With no query the palette lists
// recent commands, then every command.

import { listCommands, commandLabel, isCommandEnabled, getCommand } from './registry.js';
import { menuPathOf } from './menus.js';
import { WORKFLOWS } from './workflows.js';
import { usageBoost, recentIds } from '../stores/commandUsage.js';

// Commands that need an argument (a style name, a preset id) are reachable
// from their menus, not runnable bare from the palette; the palette itself
// is not listed in the palette.
export const PALETTE_HIDDEN = new Set(['format.applyStyle', 'format.applyStylePreset', 'help.findCommands']);
export const PALETTE_LIMIT = 60;
export const RECENT_LIMIT = 6;

export function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const words = (text) => text.split(/[^a-z0-9]+/).filter(Boolean);

/** Raw word scores. STRONG and up is direct evidence; below is weak. */
export const SCORE = { exact: 100, prefix: 80, wordPrefix: 60, initials: 55, strong: 55, substring: 40, shortPrefix: 30, subsequence: 12 };
// A prefix covering less than this share of a keyword word is weak.
const PREFIX_COVER = 0.45;
// Weak entries must reach this share of the best score, and only this many show.
export const WEAK_RATIO = 0.4;
export const WEAK_LIMIT = 6;

/**
 * Score one query word against one normalised text (0 = no match).
 * strict (keywords, path, id): a prefix must cover a fair share of the word
 * it matches, and no substring or subsequence counts.
 */
export function scoreWord(q, text, { strict = false } = {}) {
  if (!q || !text) return 0;
  if (text === q) return SCORE.exact;
  const ws = words(text);
  const covers = (w) => !strict || q.length >= w.length * PREFIX_COVER;
  if (text.startsWith(q)) {
    const first = ws[0] || text;
    if (ws.length > 1 && text.slice(0, q.length + 1).match(/[^a-z0-9]$/)) return SCORE.prefix; // whole first word(s)
    return covers(first) || !first.startsWith(q) ? SCORE.prefix : SCORE.shortPrefix;
  }
  const prefixed = ws.filter((w) => w.startsWith(q));
  if (prefixed.length) return prefixed.some(covers) ? SCORE.wordPrefix : SCORE.shortPrefix;
  if (q.length >= 2 && ws.length >= q.length && ws.map((w) => w[0]).join('').startsWith(q)) return SCORE.initials;
  if (strict || q.length < 3) return 0;
  if (text.includes(q)) return SCORE.substring;
  // Subsequence from the start of a word within a compact span (a skipped
  // or swapped letter, not letters scattered over the text).
  for (let s = 0; s < text.length; s++) {
    if (text[s] !== q[0] || (s > 0 && /[a-z0-9]/.test(text[s - 1]))) continue;
    let i = 1;
    for (let k = s + 1; k < text.length && i < q.length && k - s < q.length + 2; k++) {
      if (text[k] === q[i]) i++;
    }
    if (i === q.length) return SCORE.subsequence;
  }
  return 0;
}

/** { score, weak } of an entry for a query; score 0 = no match. */
export function matchEntry(entry, query) {
  const q = normalize(query);
  if (!q) return { score: 0, weak: false };
  const label = normalize(entry.label);
  const keywords = (entry.keywords || []).map(normalize);
  const path = normalize([...(entry.path || []), ...(entry.altPath || [])].join(' '));
  const id = normalize(entry.id || '');
  const strict = { strict: true };
  let total = 0;
  let weak = false;
  for (const w of q.split(/\s+/)) {
    const labelRaw = scoreWord(w, label);
    const keywordRaw = Math.max(0, ...keywords.map((k) => scoreWord(w, k, strict)));
    const best = Math.max(
      labelRaw * 3,
      keywordRaw * 2,
      Math.round(scoreWord(w, path, strict) * 1.2),
      scoreWord(w, id, strict),
    );
    if (best === 0) return { score: 0, weak: false };
    // Direct evidence: a strong hit in the label or a keyword.
    if (Math.max(labelRaw, keywordRaw) < SCORE.strong) weak = true;
    total += best;
  }
  if (q.includes(' ')) total += scoreWord(q, label) * 3;
  return { score: total, weak };
}

/**
 * Text score of an entry for a normalised query (0 = no match). Entry:
 * { label, keywords?, path?, altPath?, id? } with plain (translated)
 * strings; altPath = the workflow tabs that hold a command.
 */
export function scoreEntry(entry, query) {
  return matchEntry(entry, query).score;
}

/**
 * Rank entries for a query: matches only, best first; usage lifts a command
 * (entry.commandId) by up to 40 points; ties keep the given order. Weak
 * matches under WEAK_RATIO of the best text score are dropped, and at most
 * WEAK_LIMIT of them are kept.
 */
export function rankEntries(entries, query, { usage = {}, now = Date.now(), limit } = {}) {
  const scored = [];
  let top = 0;
  entries.forEach((entry, order) => {
    const { score: text, weak } = matchEntry(entry, query);
    if (!text) return;
    top = Math.max(top, text);
    const boost = entry.commandId ? usageBoost(usage[entry.commandId], now) : 0;
    const penalty = entry.disabled ? 15 : 0;
    scored.push({ entry, text, weak, score: text + boost - penalty, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  let weakShown = 0;
  const out = [];
  for (const s of scored) {
    if (s.weak) {
      if (s.text < top * WEAK_RATIO || weakShown >= WEAK_LIMIT) continue;
      weakShown++;
    }
    out.push(s.entry);
  }
  return limit ? out.slice(0, limit) : out;
}

// --- Sources ---------------------------------------------------------------

/** The workflow tabs that hold a command (translated labels), or null. */
function workflowPath(commandId, t) {
  const tabs = WORKFLOWS.filter((w) => w.groups.some((group) => group.items.includes(commandId)));
  return tabs.length ? tabs.map((w) => t(w.label)) : null;
}

function sectionOf(cmd) {
  if (cmd.id.startsWith('window.panel.')) return 'panels';
  if (cmd.category.startsWith('tools') && !cmd.id.startsWith('tools.toolbar.')) return 'tools';
  return 'commands';
}

/** Palette entries for every visible registry command. */
export function commandEntries(t) {
  return listCommands().filter((cmd) => !PALETTE_HIDDEN.has(cmd.id)).map((cmd) => ({
    key: `cmd:${cmd.id}`,
    kind: 'command',
    section: sectionOf(cmd),
    commandId: cmd.id,
    id: cmd.id,
    label: commandLabel(cmd, t),
    keywords: cmd.keywords,
    path: (menuPathOf(cmd.id) || []).map((key) => t(key)),
    altPath: workflowPath(cmd.id, t),
    icon: cmd.icon,
    shortcut: cmd.shortcut,
    get disabled() { return !isCommandEnabled(cmd); },
  }));
}

/**
 * Page entries for an open document: "A-101" (with a page label) or "Go to
 * page 3"; run(goTo) is given the page number.
 */
export function pageEntries({ numPages = 0, labels = null, t, goTo }) {
  const out = [];
  for (let page = 1; page <= numPages; page++) {
    const label = Array.isArray(labels) && typeof labels[page - 1] === 'string' && labels[page - 1].trim()
      && labels[page - 1].trim() !== String(page) ? labels[page - 1].trim() : null;
    out.push({
      key: `page:${page}`, kind: 'page', section: 'pages', id: `page ${page}`,
      label: label ? `${label}` : t('menu.palette.goToPage', { page }),
      detail: label ? t('menu.palette.goToPage', { page }) : '',
      keywords: [String(page), 'page', 'sheet', ...(label ? [label] : [])],
      path: [t('menu.palette.pages')],
      run: () => goTo(page),
    });
  }
  return out;
}

/** The rows to show: [{ section, entries }] in display order. */
export function paletteSections(query, { t, entries, usage = {}, now = Date.now(), limit = PALETTE_LIMIT }) {
  const q = normalize(query);
  if (!q) {
    const recent = recentIds(usage, RECENT_LIMIT)
      .map((id) => entries.find((e) => e.commandId === id))
      .filter(Boolean);
    const rest = entries.filter((e) => e.kind === 'command' && !recent.includes(e)).slice(0, limit - recent.length);
    return [
      ...(recent.length ? [{ section: 'recent', entries: recent }] : []),
      ...groupBySection(rest),
    ].filter((s) => s.entries.length);
  }
  // A bare number goes to that page first.
  const ranked = rankEntries(entries, q, { usage, now, limit });
  if (/^\d+$/.test(q)) {
    const page = ranked.find((e) => e.kind === 'page' && e.key === `page:${q}`);
    if (page) ranked.splice(ranked.indexOf(page), 1), ranked.unshift(page);
  }
  // Grouped by section; sections in the order of their best result, rank
  // order inside each, so the top hit is always the first row.
  const out = [];
  for (const entry of ranked) {
    const group = out.find((s) => s.section === entry.section);
    if (group) group.entries.push(entry);
    else out.push({ section: entry.section, entries: [entry] });
  }
  return out;
}

const SECTION_ORDER = ['tools', 'commands', 'panels', 'documents', 'files', 'addons', 'pages'];
function groupBySection(entries) {
  return SECTION_ORDER.map((section) => ({ section, entries: entries.filter((e) => e.section === section) }));
}

/**
 * Ranked command rows for a query: [{ cmd, path }], path = the translated
 * labels of the menus holding the command ('Document', or 'Edit', 'Arrange').
 */
export function paletteResults(query, t, limit = PALETTE_LIMIT) {
  const entries = commandEntries(t);
  const ranked = normalize(query) ? rankEntries(entries, query) : entries;
  return ranked.slice(0, limit).map((e) => ({ cmd: getCommand(e.commandId), path: e.path }));
}
