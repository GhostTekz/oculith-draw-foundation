// Wiring of the status-bar drawing aids, the live measurement readout and
// the Properties-toolbar selection total, plus their en/nl strings.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const lees = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const statusBar = lees('./StatusBar.jsx');
const toolbar = lees('./PropertiesToolbar.jsx');
const keys = lees('../../tools/keyboard-handlers.js');
const manager = lees('../../tools/manager.js');
const measureTool = lees('../../tools/tools/measurement-tool.js');
const statusCss = lees('../../../styles/status-bar.css');
const locale = (taal, ns) => JSON.parse(lees(`../../i18n/locales/${taal}/${ns}.json`));

test('status bar renders every toggle as a pressed-state button bound to its preference', () => {
  // WP3: icon toggles in the external editor's order, STATUS_TOGGLES = SNAP_TOGGLES reordered.
  assert.match(statusBar, /<For each=\{STATUS_TOGGLES\}>/);
  assert.match(statusBar, /TOGGLE_ORDER\.map\(\(id\) => SNAP_TOGGLES\.find/);
  assert.match(statusBar, /aria-pressed=\{isSnapToggleOn\(state\.preferences, toggle\.id\)/);
  assert.match(statusBar, /onClick=\{\(\) => toggleSnapPreference\(toggle\.id\)\}/);
  assert.match(statusBar, /title=\{toggleTitle\(toggle\)\}/);
  assert.match(statusBar, /role="group"/);
});

test('toggle buttons are squared, flat and keep the default cursor', () => {
  const rule = statusCss.match(/\.status-snap-toggle \{[^}]*\}/)?.[0] || '';
  assert.match(rule, /border-radius: 0;/);
  assert.match(rule, /cursor: default;/);
  assert.doesNotMatch(statusCss.match(/\.status-snap-toggle[\s\S]*$/)[0], /transition|animation/);
});

test('status bar shows the live readout from the measure tools', () => {
  assert.match(statusBar, /measureReadoutText\(r, formatMeasurement, t\(`readout\.\$\{r\.kind\}`\),\s*typedLengthMeasurement\(\), t\('readout\.typed'\)\)/,
    'with the length typed for the next segment (Sketch to Scale)');
  assert.match(statusBar, /id="status-measure-readout"/);
  assert.match(measureTool, /setMeasureReadout\('length', d\)/);
  assert.match(measureTool, /setMeasureReadout\('area', area\)/);
  assert.match(manager, /clearActiveToolPreset\(\);\n\s*clearMeasureReadout\(\);/, 'a tool switch clears the readout');
});

test('snap shortcuts go through the keyboard handler before the plain F-keys', () => {
  const toggleAt = keys.indexOf('const snapToggle = snapToggleForKey(e);');
  assert.ok(toggleAt > 0);
  assert.ok(toggleAt < keys.indexOf("} else if (e.key === 'F7') {"));
  // Plain F9 is the menu bar now (the external editor), a registry key matched with its
  // modifiers (shortcut-table.js), so it never swallows Ctrl+Shift+F9.
  assert.equal(keys.indexOf("} else if (e.key === 'F9') {"), -1);
  assert.ok(keys.indexOf('const registryEntry = resolveRegistryShortcut(e);') > 0);
});

test('Properties toolbar shows the selection total only in multi-selection', () => {
  assert.match(toolbar, /panelMode\(\) === 'multi'\s*\? selectionMeasureTotal\(doc\(\)\?\.selectedAnnotations\)/);
  assert.match(toolbar, /<Show when=\{measureTotal\(\)\}>/);
  assert.match(toolbar, /formatMeasurement\(total\)/);
});

test('en and nl carry every new string', () => {
  for (const taal of ['en', 'nl']) {
    const sb = locale(taal, 'statusbar');
    for (const id of ['content', 'markup', 'grid', 'showGrid', 'ortho', 'reuse']) {
      assert.ok(sb.snapToggles?.[id], `${taal} snapToggles.${id}`);
      assert.ok(sb.snapToggles?.[`${id}Title`], `${taal} snapToggles.${id}Title`);
    }
    assert.ok(sb.snapToggles.group);
    for (const k of ['title', 'length', 'area', 'angle']) assert.ok(sb.readout?.[k], `${taal} readout.${k}`);
    const props = locale(taal, 'properties');
    for (const k of ['length', 'area', 'title']) assert.ok(props.measureTotal?.[k], `${taal} measureTotal.${k}`);
    assert.match(props.measureTotal.title, /\{\{count\}\}/);
    const prefs = locale(taal, 'preferences');
    assert.ok(prefs.behavior.snapToMarkup && prefs.annotations.snapToMarkup, `${taal} snapToMarkup`);
  }
});
