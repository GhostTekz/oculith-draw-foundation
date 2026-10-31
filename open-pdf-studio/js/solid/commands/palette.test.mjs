// The command palette's search (palette.js): word scoring, ranking by label
// over keywords over path over id, initials, typo-tolerant but not noisy
// subsequences, the usage lift for recent and frequent commands (never over
// an exact match), pages by number and label, the empty-query sections, and
// the shortcut display. Real registry (browser build of Solid, see
// ../../core/app-test-hooks.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

await import('./index.js');
const p = await import('./palette.js');
const usage = await import('../stores/commandUsage.js');
const { shortcutParts, shortcutText } = await import('./shortcut-display.js');
const reg = await import('./registry.js');

const en = JSON.parse(readFileSync(new URL('../../i18n/locales/en/common.json', import.meta.url), 'utf8').replace(/^﻿/, ''));
const t = (key, opts) => {
  const v = key.replace(/^common:/, '').split('.').reduce((o, k) => o?.[k], en);
  return typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (_, k) => opts?.[k] ?? '') : key;
};
const ids = (query, opts = {}) => p.rankEntries(p.commandEntries(t), query, opts).map((e) => e.commandId);

test('word scores: exact > prefix > word prefix > initials > substring > compact subsequence', () => {
  const s = (q, text) => p.scoreWord(q, p.normalize(text));
  assert.ok(s('count', 'count') > s('count', 'counter'));
  assert.ok(s('count', 'counter') > s('page', 'extract page'));
  assert.ok(s('page', 'extract page') > s('ep', 'extract page'));
  assert.ok(s('ep', 'extract page') > s('trac', 'extract page'));
  assert.ok(s('trac', 'extract page') > s('extrct', 'extract page'));
  assert.ok(s('extrct', 'extract page') > 0, 'a skipped letter still finds it');
  assert.equal(s('count', 'synchronize document'), 0, 'scattered letters are noise');
  assert.equal(s('xy', 'extract'), 0);
});

test('ranking: label over keyword, every word must match, accents and case ignored', () => {
  assert.equal(ids('extract')[0], 'document.extractPages');
  assert.equal(ids('fit width')[0], 'view.fitWidth');
  assert.equal(ids('ZOOM in')[0], 'view.zoomIn');
  assert.equal(ids('deskew')[0], 'document.straighten', 'keywords reach a command');
  assert.ok(ids('ep').slice(0, 3).includes('document.extractPages'), 'initials');
  assert.ok(ids('calibrat')[0] === 'tools.measure.calibrate');
  assert.deepEqual(ids('zoom nothinglikethis'), []);
  // A tool found by its workflow tab name.
  assert.ok(ids('takeoff conduit').includes('tools.raceway.conduit'));
});

test('recent and frequent commands rise, but never over a better text match', () => {
  const now = Date.UTC(2026, 9, 31, 12);
  // Two equal text matches: the used one comes first.
  const plain = ids('rotate');
  const a = plain.indexOf('view.rotateLeft');
  const b = plain.indexOf('view.rotateRight');
  assert.ok(a >= 0 && b >= 0);
  const second = a < b ? 'view.rotateRight' : 'view.rotateLeft';
  let used = {};
  for (let i = 0; i < 5; i++) used = usage.withUse(used, second, now - i * 1000);
  const boosted = ids('rotate', { usage: used, now });
  assert.ok(boosted.indexOf(second) < boosted.indexOf(a < b ? 'view.rotateLeft' : 'view.rotateRight'));
  // An exact label match beats heavy use of a weaker match.
  let heavy = {};
  for (let i = 0; i < 50; i++) heavy = usage.withUse(heavy, 'document.reorderPages', now);
  assert.equal(ids('extract pages', { usage: heavy, now })[0], 'document.extractPages');
  // The boost fades with time and is bounded.
  assert.equal(usage.usageBoost(undefined, now), 0);
  assert.ok(usage.usageBoost({ n: 1000, t: now }, now) <= 40);
  assert.ok(usage.usageBoost({ n: 3, t: now }, now) > usage.usageBoost({ n: 3, t: now - 20 * 864e5 }, now));
  assert.deepEqual(usage.recentIds({ a: { n: 1, t: 1 }, b: { n: 9, t: 3 }, c: { n: 2, t: 2 } }, 2), ['b', 'c']);
});

test('usage is recorded for every command run, capped, and the palette opener is not counted', () => {
  usage.clearCommandUsage();
  try { reg.runCommand('help.findCommands'); } catch { /* no window events in node */ }
  reg.runCommand('window.panel.thumbnails');
  const u = usage.commandUsage();
  assert.equal(u['help.findCommands'], undefined);
  assert.equal(u['window.panel.thumbnails'].n, 1);
  let many = {};
  for (let i = 0; i < usage.MAX_ENTRIES + 20; i++) many = usage.withUse(many, `c${i}`, i);
  assert.equal(Object.keys(many).length, usage.MAX_ENTRIES);
  assert.ok(!('c0' in many) && `c${usage.MAX_ENTRIES + 19}` in many, 'the oldest go first');
  usage.clearCommandUsage();
});

test('pages: a number goes to that page first; labels are found by name', () => {
  const visited = [];
  const pages = p.pageEntries({ numPages: 12, labels: ['E-001', 'E-101', 'E-102', '4'], t, goTo: (n) => visited.push(n) });
  assert.equal(pages[1].label, 'E-101');
  assert.equal(pages[3].label, 'Go to page 4', 'a label equal to its number is no label');
  const entries = [...p.commandEntries(t), ...pages];
  const first = (q) => p.paletteSections(q, { t, entries }).flatMap((s) => s.entries)[0];
  assert.equal(first('12').key, 'page:12');
  assert.equal(first('2').key, 'page:2');
  assert.equal(first('E-102').key, 'page:3');
  first('e-101').run();
  assert.deepEqual(visited, [2]);
});

test('sections: empty query lists recent first; results group by section with the top hit first', () => {
  const now = Date.now();
  const entries = p.commandEntries(t);
  const used = usage.withUse(usage.withUse({}, 'file.print', now - 5), 'tools.measure.count', now);
  const empty = p.paletteSections('', { t, entries, usage: used });
  assert.equal(empty[0].section, 'recent');
  assert.deepEqual(empty[0].entries.map((e) => e.commandId), ['tools.measure.count', 'file.print']);
  assert.ok(empty.flatMap((s) => s.entries).length <= p.PALETTE_LIMIT);
  const sections = p.paletteSections('thumb', { t, entries });
  assert.equal(sections[0].section, 'panels');
  assert.equal(sections[0].entries[0].commandId, 'window.panel.thumbnails');
  assert.equal(new Set(sections.map((s) => s.section)).size, sections.length, 'one header per section');
  // Hidden commands (need an argument) and the palette itself are not listed.
  for (const id of p.PALETTE_HIDDEN) assert.ok(!entries.some((e) => e.commandId === id), id);
  // Each command row says where it lives (its menu, else its workflow tab).
  const count = entries.find((e) => e.commandId === 'tools.measure.count');
  assert.deepEqual(count.path, ['Tools', 'Measure']);
  assert.equal(reg.getCommand('help.findCommands').shortcut, 'Ctrl+K');
});

test('shortcuts show as keys, Cmd symbols on macOS', () => {
  assert.deepEqual(shortcutParts('Ctrl+Shift+P', false), ['Ctrl', 'Shift', 'P']);
  assert.deepEqual(shortcutParts('Ctrl+K', true), ['⌘', 'K']);
  assert.deepEqual(shortcutParts('Ctrl+Shift++', false), ['Ctrl', 'Shift', '+']);
  assert.deepEqual(shortcutParts('Ctrl+-', false), ['Ctrl', '-']);
  assert.equal(shortcutText('Shift+Alt+C', true), '⇧⌥C');
  assert.deepEqual(shortcutParts(null), []);
});
