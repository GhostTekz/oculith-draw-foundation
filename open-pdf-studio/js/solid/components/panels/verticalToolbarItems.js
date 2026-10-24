// Items of the right-edge vertical toolbar (the external editor profile, spec R7):
// Markup | Draw | Measure groups of command-registry ids (commands/tools.js,
// spec §9.4), rendered by components/Toolbar.jsx. The markup toolbar
// (workspaceLayout toolbars.markup) holds the Markup and Draw groups, the
// measure toolbar (toolbars.measure) the Measure group. Labels, icons,
// enabled and checked state come from the commands.

export const TOOLBAR_GROUPS = Object.freeze([
  { id: 'markup', toolbar: 'markup', items: [
    'tools.markup.textBox', 'tools.markup.callout', 'tools.markup.note', 'tools.markup.highlight',
    'tools.markup.pen', 'tools.markup.eraser', 'tools.markup.cloud', 'tools.stamp', 'edit.snapshot',
    'tools.markup.hyperlink', 'tools.measure.count',
  ] },
  { id: 'draw', toolbar: 'markup', items: [
    'tools.markup.line', 'tools.markup.arrow', 'tools.markup.polyline', 'tools.markup.rectangle',
    'tools.markup.ellipse', 'tools.markup.polygon', 'tools.markup.arc',
    'tools.raceway.conduit', 'tools.raceway.cableTray',
  ] },
  { id: 'measure', toolbar: 'measure', items: [
    'tools.measure.length', 'tools.measure.polylength', 'tools.measure.area', 'tools.measure.perimeter',
    'tools.measure.angle', 'tools.measure.volume', 'tools.measure.dynamicFill',
  ] },
]);

export const BUTTON_PX = 34;
export const SEPARATOR_PX = 9;
export const OVERFLOW_PX = 24;

/**
 * The flat item list for the visible toolbars: { command, group } entries
 * with { separator: true } between groups. visible = (toolbarId) => boolean;
 * known = (commandId) => boolean drops ids that are not registered (yet).
 */
export function toolbarEntries(visible, known = () => true) {
  const out = [];
  for (const group of TOOLBAR_GROUPS) {
    if (!visible(group.toolbar)) continue;
    const items = group.items.filter(known);
    if (!items.length) continue;
    if (out.length) out.push({ separator: true, group: group.id });
    for (const command of items) out.push({ command, group: group.id });
  }
  return out;
}

/** Toolbar.jsx ids for entries ('|' for a separator). */
export function toolbarIds(entries) {
  return entries.map((e) => (e.separator ? '|' : e.command));
}

/**
 * Split entries into what fits in `available` px and the overflow (the external editor ▾ at
 * the bottom). When everything fits there is no overflow button; otherwise
 * its height is reserved. Separators never start or end a column or the
 * overflow list.
 */
export function fitToolbarEntries(entries, available) {
  const height = (e) => (e.separator ? SEPARATOR_PX : BUTTON_PX);
  const total = entries.reduce((sum, e) => sum + height(e), 0);
  if (total <= available) return { visible: entries, overflow: [] };
  const room = Math.max(0, available - OVERFLOW_PX);
  const visible = [];
  let used = 0;
  let i = 0;
  for (; i < entries.length; i++) {
    const h = height(entries[i]);
    if (used + h > room) break;
    visible.push(entries[i]);
    used += h;
  }
  while (visible.length && visible[visible.length - 1].separator) visible.pop();
  const overflow = entries.slice(i).filter((e, idx, list) => !(e.separator && (idx === 0 || idx === list.length - 1)));
  return { visible, overflow };
}
