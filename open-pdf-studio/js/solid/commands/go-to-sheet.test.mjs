// Go to Sheet (go-to-sheet.js): sheets of every open document by number,
// page label or title; "E2" finds E-201; the drawing set names and titles
// pages; Ctrl+G groups a selection and otherwise opens the box; the command
// is in View ▸ Go To and the command palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

await import('./index.js');
const g = await import('./go-to-sheet.js');
const reg = await import('./registry.js');
const { MENUS } = await import('./menus.js');
const p = await import('./palette.js');

const docs = [
  { index: 0, name: 'Arch.pdf', filePath: 'C:\\Jobs\\Arch.pdf', numPages: 2, labels: ['A-101', 'A-201'] },
  { index: 1, name: 'Elec.pdf', filePath: 'C:/Jobs/Elec.pdf', numPages: 4, labels: ['E-001', 'E-101', 'E-201', 'E-401'] },
  { index: 2, name: 'Scan.pdf', filePath: 'C:/Jobs/Scan.pdf', numPages: 3, labels: null },
];
const sheetsRegister = [
  { label: 'E-201', title: 'Lighting Plan Level 2', filePath: 'c:/jobs/elec.pdf', page: 3 },
  { label: 'E-401', title: 'Enlarged Electrical Room', filePath: 'C:/Jobs/Elec.pdf', page: 4 },
  { label: 'S-1', title: 'Structural Notes', filePath: 'C:/Jobs/Scan.pdf', page: 2 },
];
const all = g.sheetCandidates(docs, { register: sheetsRegister, activeIndex: 0 });
const top = (q) => g.rankSheets(all, q)[0]?.key;

test('candidates: every page of every open document, the active one first, register names and titles', () => {
  assert.equal(all.length, 9);
  assert.equal(all[0].docIndex, 0);
  const e201 = all.find((s) => s.key === '1:3');
  assert.equal(e201.number, 'E-201');
  assert.equal(e201.title, 'Lighting Plan Level 2', 'path case and slashes do not matter');
  assert.equal(all.find((s) => s.key === '2:2').number, 'S-1', 'a register sheet without page labels');
  assert.equal(all.find((s) => s.key === '2:1').number, '');
});

test('fuzzy sheet numbers: E2 → E-201, punctuation and case ignored, digits alone', () => {
  assert.equal(g.compactSheetNumber('E-201'), 'e201');
  assert.equal(top('E2'), '1:3');
  assert.equal(top('e-201'), '1:3');
  assert.equal(top('E 201'), '1:3');
  assert.equal(top('e4'), '1:4');
  assert.equal(top('201'), '0:2', 'the digits alone: A-201 of the active document first');
  assert.ok(g.rankSheets(all, '201').some((s) => s.key === '1:3'));
  assert.equal(top('a2'), '0:2');
  assert.equal(top('s1'), '2:2');
  assert.deepEqual(g.rankSheets(all, 'zz9'), []);
});

test('titles and number + title; a bare number is a page when no sheet has it', () => {
  assert.equal(top('lighting'), '1:3');
  assert.equal(top('enlarged room'), '1:4');
  assert.equal(top('E lighting'), '1:3');
  assert.equal(top('3'), '2:3', 'page 3 of the unlabelled scan');
  // The empty query lists named sheets first.
  assert.ok(g.rankSheets(all, '').slice(0, 7).every((s) => s.number || s.title));
});

test('command: View ▸ Go To, the palette and Ctrl+J; Ctrl+G always groups', async () => {
  const cmd = reg.getCommand('view.goToSheet');
  assert.ok(cmd);
  const view = MENUS.find((m) => m.id === 'view');
  const goTo = view.items.find((i) => i && typeof i === 'object' && i.submenu === 'common:menu.goTo');
  assert.ok(goTo.items.includes('view.goToSheet'));
  const en = JSON.parse(readFileSync(new URL('../../i18n/locales/en/common.json', import.meta.url), 'utf8'));
  const t = (key) => key.replace(/^common:/, '').split('.').reduce((o, k) => o?.[k], en) ?? key;
  const ids = p.rankEntries(p.commandEntries(t), 'go to sheet').map((e) => e.commandId);
  assert.equal(ids[0], 'view.goToSheet');
  assert.equal(cmd.shortcut, 'Ctrl+J');
  const handlers = readFileSync(new URL('../../tools/keyboard-handlers.js', import.meta.url), 'utf8');
  assert.match(handlers, /group: \(\) => \{ if \(!isPdfAReadOnly\(\)\) createCollection\(\); \}/);
});
