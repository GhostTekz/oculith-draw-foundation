// A Tool Chest preset keeps the custom line style of a line or polyline
// tool: its id and a clean copy of the definition, so a preset made from a
// user style still draws that style after the style is deleted or on another
// machine (resolveLineStyle prefers the live style with the same id).

import { cleanLineStyle, isBuiltinLineStyleId } from '../annotations/line-styles.js';

export const LINE_STYLE_PRESET_TOOLS = new Set(['line', 'polyline']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

/** `{ lineStyleId, lineStyleDef? }` from a markup or saved style, or `{}`. */
export function presetLineStyle(source, tool) {
  if (!LINE_STYLE_PRESET_TOOLS.has(tool) || !source) return {};
  const id = source.lineStyleId;
  if (typeof id !== 'string' || !ID_RE.test(id)) return {};
  if (isBuiltinLineStyleId(id)) return { lineStyleId: id };
  const def = cleanLineStyle(source.lineStyleDef);
  return def && def.id === id ? { lineStyleId: id, lineStyleDef: def } : { lineStyleId: id };
}
