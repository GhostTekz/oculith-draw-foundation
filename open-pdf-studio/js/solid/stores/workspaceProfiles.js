// Adapter: the old workspace-profile API on top of workspaceLayout.js.
// Profiles are now whole panel layouts (docs/WORKSPACE-SPEC.md §5):
// oculith (default), oculithAdvanced, quantityTakeoff, document. The old ids
// (review/markup/takeoff/document) still work and map via LEGACY_PROFILE_MAP.
// Until the menu bar lands, the ribbon's profile picker calls this; the
// ribbon tab still follows the profile while the ribbon exists.

import {
  PROFILE_IDS, LEGACY_PROFILE_MAP, activeProfile, applyProfile,
} from './workspaceLayout.js';
import { setActiveTab } from './ribbonStore.js';
import { resetActiveWorkflow } from './workflowStore.js';

export const WORKSPACE_PROFILES = PROFILE_IDS;

const RIBBON_TAB = {
  oculith: 'drawing',
  oculithAdvanced: 'view',
  quantityTakeoff: 'measure',
  document: 'organize',
};

/** The active profile id (reactive). */
export const activeWorkspaceProfile = activeProfile;

/** Switch profile (new or old id); resets the panel layout to that profile. */
export function applyWorkspaceProfile(profile, persist = true) {
  const id = PROFILE_IDS.includes(profile) ? profile : LEGACY_PROFILE_MAP[profile];
  if (!id) return false;
  applyProfile(id, { persist });
  // The workflow toolbar opens on the profile's own workflow.
  resetActiveWorkflow({ persist });
  setActiveTab(RIBBON_TAB[id] || 'drawing');
  return true;
}

/** Boot: the layout itself comes from restoreWorkspaceLayout(); sync the ribbon tab. */
export function restoreWorkspaceProfile() {
  setActiveTab(RIBBON_TAB[activeProfile()] || 'drawing');
  return true;
}
