// Tool Chest panel UI state shared by its header (search, ▾ panel menu) and
// body (sections): which sections are open or in Detail view (remembered,
// see components/tool-chest/tool-chest-view.js), the "new set" form, and the
// portable set import/export with its status message.

import { createSignal } from 'solid-js';
import {
  readSectionState, writeSectionState, isSectionOpen, withSectionToggled, withSectionOpen,
  withAllSections, sectionView, withSectionView, pruneSectionState,
} from '../components/tool-chest/tool-chest-view.js';
import {
  DEFAULT_TOOL_SET_ID, MAX_TOOL_SETS, getToolChestSets, exportToolSet, importToolSet,
} from '../../tools/tool-chest-presets.js';
import { MAX_PORTABLE_SET_BYTES, suggestedPortableToolSetName } from '../../tools/tool-set-portable.js';
import { isTauri, openFileDialog, saveFileDialog, readBinaryFile, writeBinaryFile } from '../../core/platform.js';

const [sectionState, setSectionStateRaw] = createSignal(readSectionState());

function commit(next) {
  setSectionStateRaw(next);
  writeSectionState(next);
}

export { sectionState };
export const sectionOpen = (id) => isSectionOpen(sectionState(), id);
export const toggleSection = (id) => commit(withSectionToggled(sectionState(), id));
export const openSection = (id) => commit(withSectionOpen(sectionState(), id, true));
export const sectionViewOf = (id) => sectionView(sectionState(), id);
export const setSectionView = (id, view) => commit(withSectionView(sectionState(), id, view));

// The sections the panel currently lists (for Expand all / Collapse all).
const [liveSections, setLiveSectionsRaw] = createSignal([]);
/**
 * `ids`: the sections listed now; `knownIds`: every set and library group
 * that exists (also hidden ones). State of sections that no longer exist is
 * dropped, so storage does not grow.
 */
export function setLiveSections(ids, knownIds = ids) {
  setLiveSectionsRaw(ids);
  const pruned = pruneSectionState(sectionState(), knownIds);
  if (JSON.stringify(pruned) !== JSON.stringify(sectionState())) commit(pruned);
}
export const setAllSectionsOpen = (open) => commit(withAllSections(sectionState(), liveSections(), open));

// Panel menu "New Tool Set…" opens the inline name form in the panel.
const [newSetFormOpen, setNewSetFormOpen] = createSignal(false);
export { newSetFormOpen, setNewSetFormOpen };

// Status line under the header (import/export results, rename errors).
const [chestMessage, setChestMessage] = createSignal(null);
export { chestMessage };
export function showChestMessage(text, error = false) {
  setChestMessage(text ? { text, error } : null);
}

const [transferBusy, setTransferBusy] = createSignal(false);
export { transferBusy };

/** Export one named set as portable JSON (Tool Chest gear ▸ Export…). */
export async function exportToolSetToFile(setId) {
  if (transferBusy() || setId === DEFAULT_TOOL_SET_ID) return;
  showChestMessage(null);
  setTransferBusy(true);
  try {
    const set = getToolChestSets().find(item => item.id === setId);
    if (!set) return;
    const bytes = exportToolSet(set.id);
    const path = await saveFileDialog(suggestedPortableToolSetName(set.name),
      [{ name: 'OcuDraw tool set', extensions: ['json'] }]);
    if (!path) return;
    await writeBinaryFile(path, bytes);
    showChestMessage(`${set.name} exported as portable JSON.`);
  } catch (error) {
    showChestMessage(error?.message || 'Could not export the tool set.', true);
  } finally {
    setTransferBusy(false);
  }
}

/** Import a portable JSON set as a new named set (panel menu ▸ Import Tool Set…). */
export async function importToolSetFromFile() {
  if (transferBusy() || getToolChestSets().length > MAX_TOOL_SETS) return null;
  showChestMessage(null);
  setTransferBusy(true);
  try {
    const picked = await openFileDialog(['json'], { maxBytes: MAX_PORTABLE_SET_BYTES });
    if (!picked) return null;
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (isTauri() && window.__TAURI__?.fs?.stat) {
      const metadata = await window.__TAURI__.fs.stat(path);
      if (metadata.size > MAX_PORTABLE_SET_BYTES) throw new Error('Tool set JSON exceeds the 65536-byte limit.');
    }
    const bytes = await readBinaryFile(path);
    const result = importToolSet(bytes);
    openSection(`set:${result.set.id}`);
    showChestMessage(`${result.set.name} imported with ${result.tools.length} tools.`);
    return result;
  } catch (error) {
    showChestMessage(error?.message || 'Could not import the tool set.', true);
    return null;
  } finally {
    setTransferBusy(false);
  }
}
