// Adapter: the old left-panel API (one active tab + collapsed) on top of the
// workspace layout (workspaceLayout.js). The panels now live in three hosts,
// so "the active tab" means the panel the user last brought up that is still
// shown, else the left host's active panel. Code that needs to know whether
// a panel is on screen uses panelShown(id) instead.
//
// Old tab ids (bridge, ribbon, annotations-list.js, tests) map onto the new
// panel ids: annotations → markupsList, form-fields → formFields,
// destinations → links (one Links panel), schedules → quantities.

import { createSignal, untrack } from 'solid-js';
import {
  HOSTS, PANEL_IDS, workspaceLayout, findPanelHost, getHost,
  showPanel, setHostCollapsed, toggleHostCollapsed,
} from './workspaceLayout.js';

export const LEGACY_PANEL_IDS = Object.freeze({
  thumbnails: 'thumbnails',
  sheets: 'sheets',
  bookmarks: 'bookmarks',
  annotations: 'markupsList',
  attachments: 'attachments',
  signatures: 'signatures',
  layers: 'layers',
  'form-fields': 'formFields',
  destinations: 'links',
  tags: 'tags',
  links: 'links',
  measurements: 'measurements',
  schedules: 'quantities',
});
const TO_LEGACY = Object.freeze({ markupsList: 'annotations', formFields: 'form-fields', quantities: 'schedules' });

/** New panel id for an old tab id (new ids pass through), or null. */
export function toPanelId(id) {
  if (LEGACY_PANEL_IDS[id]) return LEGACY_PANEL_IDS[id];
  return PANEL_IDS.includes(id) ? id : null;
}

/** Old tab id for a panel id (ids that never had an old name pass through). */
export function toLegacyId(panelId) {
  return TO_LEGACY[panelId] || panelId;
}

const [focusedPanel, setFocusedPanelRaw] = createSignal(null);

/** Remember the panel the user brought up last (access bar, shortcut, menu). */
export function setFocusedPanel(id) {
  setFocusedPanelRaw(toPanelId(id));
}

function shown(layout, panelId) {
  const host = panelId ? findPanelHost(layout, panelId) : null;
  if (!host) return false;
  const h = layout.hosts[host];
  return h.active === panelId && !h.collapsed;
}

/** Is this panel (old or new id) on screen: active in its host and the host open? */
export function panelShown(id) {
  return shown(workspaceLayout(), toPanelId(id));
}

function activePanelId() {
  const layout = workspaceLayout();
  const focus = focusedPanel();
  if (focus && shown(layout, focus)) return focus;
  return layout.hosts.left.active;
}

/** Old API: the active tab id (old naming), see the header comment. */
export function activeTab() {
  const id = activePanelId();
  return id ? toLegacyId(id) : null;
}

/** Old API: is the host of the active tab collapsed (the left host when none)? */
export function collapsed() {
  const id = activePanelId();
  const host = (id && findPanelHost(workspaceLayout(), id)) || 'left';
  return !!getHost(host)?.collapsed;
}

/** Old API: bring a tab up (it opens its host; a hidden panel comes back). */
export function switchToLeftPanelTab(id) {
  const panelId = toPanelId(id);
  if (!panelId) return;
  showPanel(panelId);
  setFocusedPanelRaw(panelId);
}

export const setActiveTab = switchToLeftPanelTab;

/** Old API: collapse or expand the host of the active tab. */
export function setCollapsed(value) {
  const id = untrack(activePanelId);
  const host = (id && findPanelHost(untrack(workspaceLayout), id)) || 'left';
  if (HOSTS.includes(host)) setHostCollapsed(host, !!value);
}

/** Old API (F8, ribbon): collapse or expand the left host. */
export function toggleLeftPanelCollapsed() {
  toggleHostCollapsed('left');
}
