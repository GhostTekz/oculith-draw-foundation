// Tool Chest panel view state (the external editor layout), kept apart from the tool data
// (tools/tool-chest-presets.js) so the node tests cover it:
//
//   - sections: My Tools, Recent Tools, every named set, then the symbol
//     library groups. Section ids: 'set:<set id>', 'recent', 'lib:<group id>'.
//   - which sections are open (▾) or collapsed (▸), and which show the Detail
//     list instead of the Symbol grid; remembered on this device in
//     localStorage `ocudraw.toolChest.sections.v1` as
//     { open: { [section]: boolean }, detail: [section, …] }.
//     A section without a stored choice uses its default: My Tools, Recent
//     Tools, and Electrical · Receptacles open. Other sections start collapsed.
//   - the search box: every word must match a tool's name, type or
//     description; sections without a match are left out and the others
//     show open while searching.
//
// No Solid and no storage side effects beyond the explicit read/write.

export const SECTION_STATE_KEY = 'ocudraw.toolChest.sections.v1';
export const MY_TOOLS_SECTION = 'set:my-tools';
export const RECENT_SECTION = 'recent';
const MAX_SECTIONS = 400;
const SECTION_ID = /^(?:recent|set:[A-Za-z0-9_.:-]{1,128}|lib:[A-Za-z0-9_.:-]{1,128})$/u;

export const toolSetSectionId = (setId) => `set:${setId}`;
export const librarySectionId = (groupId) => `lib:${groupId}`;

/** Open unless the user collapsed it: My Tools, Recent Tools, electrical receptacles, and Oculith power. */
export function defaultSectionOpen(sectionId) {
  return sectionId === MY_TOOLS_SECTION || sectionId === RECENT_SECTION
    || sectionId === librarySectionId('electrical')
    || sectionId === librarySectionId('oculith-power');
}

export function emptySectionState() {
  return { open: {}, detail: [] };
}

/** Keep valid section ids and booleans only. */
export function cleanSectionState(value) {
  const out = emptySectionState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  if (value.open && typeof value.open === 'object' && !Array.isArray(value.open)) {
    for (const [id, open] of Object.entries(value.open).slice(0, MAX_SECTIONS)) {
      if (SECTION_ID.test(id) && typeof open === 'boolean') out.open[id] = open;
    }
  }
  if (Array.isArray(value.detail)) {
    out.detail = [...new Set(value.detail.filter(id => typeof id === 'string' && SECTION_ID.test(id)))]
      .slice(0, MAX_SECTIONS);
  }
  return out;
}

export function readSectionState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SECTION_STATE_KEY);
    return cleanSectionState(raw ? JSON.parse(raw) : null);
  } catch {
    return emptySectionState();
  }
}

export function writeSectionState(sectionState, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SECTION_STATE_KEY, JSON.stringify(cleanSectionState(sectionState)));
    return !!storage;
  } catch {
    return false;
  }
}

export function isSectionOpen(sectionState, sectionId) {
  const stored = sectionState?.open?.[sectionId];
  return typeof stored === 'boolean' ? stored : defaultSectionOpen(sectionId);
}

export function withSectionOpen(sectionState, sectionId, open) {
  const base = cleanSectionState(sectionState);
  return { ...base, open: { ...base.open, [sectionId]: !!open } };
}

export function withSectionToggled(sectionState, sectionId) {
  return withSectionOpen(sectionState, sectionId, !isSectionOpen(sectionState, sectionId));
}

/** Open or collapse every listed section (panel menu Expand all / Collapse all). */
export function withAllSections(sectionState, sectionIds, open) {
  let next = cleanSectionState(sectionState);
  for (const id of sectionIds) next = withSectionOpen(next, id, open);
  return next;
}

/** 'detail' (icon, name, description) or 'symbol' (icon grid, the default). */
export function sectionView(sectionState, sectionId) {
  return sectionState?.detail?.includes(sectionId) ? 'detail' : 'symbol';
}

export function withSectionView(sectionState, sectionId, view) {
  const base = cleanSectionState(sectionState);
  const detail = base.detail.filter(id => id !== sectionId);
  if (view === 'detail') detail.push(sectionId);
  return { ...base, detail };
}

/** Section ids (named sets, library groups) that no longer exist are dropped. */
export function pruneSectionState(sectionState, liveIds) {
  const live = new Set(liveIds);
  const base = cleanSectionState(sectionState);
  return {
    open: Object.fromEntries(Object.entries(base.open).filter(([id]) => live.has(id))),
    detail: base.detail.filter(id => live.has(id)),
  };
}

const TOOL_NAMES = Object.freeze({
  line: 'Line', arrow: 'Arrow', box: 'Rectangle', circle: 'Ellipse', highlight: 'Highlight',
  cloud: 'Cloud', textbox: 'Text Box', callout: 'Callout', count: 'Count', polyline: 'Polyline',
  polygon: 'Polygon', cloudPolyline: 'Cloud+', typewriter: 'Typewriter', flag: 'Flag',
  stamp: 'Stamp', symbol: 'Symbol', group: 'Group',
});

/** Display name of a saved tool's type. */
export function toolTypeName(tool) {
  return TOOL_NAMES[tool] || (typeof tool === 'string' && tool ? tool[0].toUpperCase() + tool.slice(1) : 'Tool');
}

/**
 * The one-line description the Detail view and tooltips show, e.g.
 * "Line · Drawing Mode · D-##". Recent tools are session styles.
 */
export function toolDescription(preset, { recent = false } = {}) {
  if (!preset) return '';
  const parts = [toolTypeName(preset.tool)];
  if (recent) parts.push('session style');
  else parts.push(preset.mode === 'drawing' ? 'Drawing Mode' : 'Properties Mode');
  if (preset.sequence) parts.push(`${preset.sequence.prefix || ''}${'#'.repeat(preset.sequence.digits || 1)}${preset.sequence.suffix || ''}`);
  return parts.join(' · ');
}

function words(query) {
  return String(query || '').toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

/** Does a tool match every word of the search (name, type, description, extra keywords)? */
export function toolMatchesQuery(tool, query) {
  const needles = words(query);
  if (!needles.length) return true;
  if (!tool) return false;
  const hay = [tool.name, tool.tool, toolTypeName(tool.tool), tool.description, tool.group, tool.id, ...(tool.keywords || [])]
    .filter(value => typeof value === 'string').join(' ').toLocaleLowerCase();
  return needles.every(needle => hay.includes(needle));
}

/**
 * Filter sections ({ id, tools, … }) by the search: tools that do not match
 * are left out, sections with no matching tool are left out (a section whose
 * own name matches keeps all its tools), and every remaining section is
 * marked `searchOpen` so it shows expanded. An empty query returns the
 * sections unchanged.
 */
export function filterToolChestSections(sections, query) {
  if (!words(query).length) return sections;
  const out = [];
  for (const section of sections) {
    const nameMatch = toolMatchesQuery({ name: section.name }, query);
    const tools = nameMatch ? section.tools : section.tools.filter(tool => toolMatchesQuery(tool, query));
    if (tools.length) out.push({ ...section, tools, searchOpen: true });
  }
  return out;
}

/** The hot-key badge of a My Tools tool (1-9, then 0), or '' after the tenth. */
export function myToolsBadge(index) {
  if (!Number.isInteger(index) || index < 0 || index > 9) return '';
  return index === 9 ? '0' : String(index + 1);
}
