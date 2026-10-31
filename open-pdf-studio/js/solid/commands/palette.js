// The command palette (Ctrl+K, Ctrl+Shift+P, Help ▸ Find Tools + Commands,
// components/CommandPalette.jsx): one fuzzy search over every registry
// command (menus, tools, panels, workflow tabs, and the commands editions
// and add-ons register), the pages of the open drawing, the open documents,
// recent files and add-on tool palettes. Kept free of JSX so it is unit
// tested (palette.test.mjs).
//
// Ranking, per query word (all words must match): label exact > prefix >
// word prefix > initials ("ep" → Extract Pages) > substring > a compact
// subsequence; keywords and the menu/workflow path count less, the id
// least. A word typed in full that matches the label as a whole adds a
// bonus. Recent and frequent commands (stores/commandUsage.js) are lifted
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

/** Score one query word against one normalised text (0 = no match). */
export function scoreWord(q, text) {
  if (!q || !text) return 0;
  if (text === q) return 100;
  if (text.startsWith(q)) return 80;
  const ws = words(text);
  if (ws.some((w) => w.startsWith(q))) return 60;
  if (q.length >= 2 && ws.length >= q.length && ws.map((w) => w[0]).join('').startsWith(q)) return 55;
  if (text.includes(q)) return 40;
  if (q.length < 3) return 0;
  // Subsequence within a compact span (typos and skipped letters, not noise).
  let start = -1;
  let i = 0;
  for (let k = 0; k < text.length && i < q.length; k++) {
    if (text[k] === q[i]) {
      if (start < 0) start = k;
      i++;
      if (i === q.length && k - start + 1 <= q.length * 2) return 12;
    }
  }
  return 0;
}

/**
 * Text score of an entry for a normalised query (0 = no match). Entry:
 * { label, keywords?, path?, altPath?, id? } with plain (translated)
 * strings; altPath = the workflow tabs that hold a command.
 */
export function scoreEntry(entry, query) {
  const q = normalize(query);
  if (!q) return 0;
  const label = normalize(entry.label);
  const keywords = (entry.keywords || []).map(normalize);
  const path = normalize([...(entry.path || []), ...(entry.altPath || [])].join(' '));
  const id = normalize(entry.id || '');
  let total = 0;
  for (const w of q.split(/\s+/)) {
    const best = Math.max(
      scoreWord(w, label) * 3,
      ...keywords.map((k) => scoreWord(w, k) * 2),
      Math.round(scoreWord(w, path) * 1.2),
      scoreWord(w, id),
    );
    if (best === 0) return 0;
    total += best;
  }
  if (q.includes(' ')) total += scoreWord(q, label) * 3;
  return total;
}

/**
 * Rank entries for a query: matches only, best first; usage lifts a command
 * (entry.commandId) by up to 40 points; ties keep the given order.
 */
export function rankEntries(entries, query, { usage = {}, now = Date.now(), limit } = {}) {
  const scored = [];
  entries.forEach((entry, order) => {
    const text = scoreEntry(entry, query);
    if (!text) return;
    const boost = entry.commandId ? usageBoost(usage[entry.commandId], now) : 0;
    const penalty = entry.disabled ? 15 : 0;
    scored.push({ entry, score: text + boost - penalty, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const out = scored.map((s) => s.entry);
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
