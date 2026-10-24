// Adapter: the old panel-size API (left / properties / markups) on top of the
// workspace layout hosts. 'left' is the left host, 'markups' the host holding
// the Markups List (bottom by default), 'properties' the host holding the
// Properties panel. Sizes are clamped and remembered per profile by
// workspaceLayout.js (SIZE_LIMITS: side 200–520, bottom 140–520).

import { getHost, getPanelHost, setHostSize } from './workspaceLayout.js';

const HOST_OF = {
  left: () => 'left',
  properties: () => getPanelHost('properties') || 'right',
  markups: () => getPanelHost('markupsList') || 'bottom',
};

export function panelSize(key) {
  const host = HOST_OF[key]?.();
  return host ? getHost(host)?.size : undefined;
}

export function setPanelSize(key, value, persist = false) {
  const host = HOST_OF[key]?.();
  if (!host || !Number.isFinite(value)) return;
  setHostSize(host, value, { persist });
}

/** Old profile switch hook: sizes now come with the profile layout. */
export function applyPanelLayout() {}
