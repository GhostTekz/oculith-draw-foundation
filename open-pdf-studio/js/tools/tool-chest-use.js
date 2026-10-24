// Pick a saved Tool Chest tool: switch to its drawing tool, then make the
// preset active for the next placement. Shared by the Tool Chest panel and
// the My Tools hot keys (1-9, 0) in keyboard-handlers.js.
import { state } from '../core/state.js';
import { setTool } from './manager.js';
import { activateToolPreset, activateRecentTool, myToolsSlotPreset } from './tool-chest-presets.js';

// The symbol palette registers how a palette symbol id becomes the stamp
// tool's overrides (SymbolPalette.jsx selectSymbol). It returns false for a
// symbol that is no longer in the palette.
let symbolActivator = null;
export function registerSymbolPresetActivator(activate) {
  symbolActivator = typeof activate === 'function' ? activate : null;
}

/** The drawing tool a saved tool switches to. */
export function drawingToolFor(preset) {
  if (preset?.tool === 'group') return 'toolChestGroup';
  return preset?.tool === 'symbol' ? 'stamp' : preset?.tool;
}

function selectDrawingTool(preset) {
  if (preset.tool === 'symbol') {
    if (!symbolActivator || symbolActivator(preset.style?.symbolId) === false) return false;
  } else {
    // A built-in stamp tool must not inherit a palette symbol's overrides.
    if (preset.tool === 'stamp') state.toolOverrides = null;
    setTool(drawingToolFor(preset));
  }
  return state.currentTool === drawingToolFor(preset);
}

export function useToolPreset(preset) {
  if (!preset || !selectDrawingTool(preset)) return false;
  activateToolPreset(preset.id);
  return true;
}

/** Recent Tools entry (session style). */
export function useRecentToolPreset(preset) {
  if (!preset || !selectDrawingTool(preset)) return false;
  activateRecentTool(preset.id);
  return true;
}

/** Hot key: use My Tools slot 1-10. False for an empty slot. */
export function useMyToolsSlot(slot) {
  return useToolPreset(myToolsSlotPreset(slot));
}
