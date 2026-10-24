// Bookmark titles follow the panel text color. A PDF outline color is usually
// black, which disappears on the dark list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('bookmark titles use the panel text color, not the PDF outline color', () => {
  const panel = lees('./BookmarksPanel.jsx');
  const titel = panel.slice(panel.indexOf('class={`bookmark-title'), panel.indexOf('{props.node.title}'));
  assert.match(titel, /bookmark-title/);
  assert.doesNotMatch(titel, /node\.color/);
  assert.doesNotMatch(titel, /style=/);
  const panels = lees('../../../../../styles/panels.css');
  const rule = panels.slice(panels.indexOf('.bookmark-title {'), panels.indexOf('.bookmark-title.bold'));
  assert.match(rule, /color:\s*var\(--theme-text\)/);
  const workspace = lees('../../../../../styles/oculith-workspace.css');
  assert.match(workspace, /#bookmarks-panel \.bookmark-title,\s*\n#bookmarks-panel \.bookmark-arrow/);
  assert.match(workspace, /color:\s*var\(--theme-text\)/);
});
