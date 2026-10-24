// Panel header (the external editor): 36 px row with the bold panel title and a ▾ that opens
// the panel menu (panel items, Hide, Attach ▸), then panel-specific actions.
// Panels with `ownHeader` in the registry (Tool Chest, Markups List) render
// it themselves, with their search and buttons as children.

import { For, Show } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { lucide } from '../../data/lucideIcons.js';
import { panelTitle } from './panelRegistry.js';
import { panelMenuItems } from './panelActions.js';
import { openPanelMenu } from './PanelMenu.jsx';

export default function PanelHeader(props) {
  const { t } = useTranslation('common');
  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openPanelMenu(r.left, r.bottom + 2, panelMenuItems(props.panelId, t, { header: true }));
  };
  return (
    <div class={`ws-panel-header${props.class ? ` ${props.class}` : ''}`} data-panel={props.panelId}>
      <button type="button" class="ws-panel-title" aria-haspopup="menu"
        title={t('panelHost.panelMenu', { panel: panelTitle(props.panelId, t) })}
        onClick={openMenu}
        onContextMenu={(e) => { e.preventDefault(); openMenu(e); }}>
        <span class="ws-panel-title-text">{panelTitle(props.panelId, t)}</span>
        <span class="ws-panel-title-chevron" innerHTML={lucide('chevron-down')} />
      </button>
      <div class="ws-panel-header-actions">
        <For each={props.actions || []}>{(action) => (
          <button type="button" class="ws-panel-action" title={action.title}
            aria-label={action.title} onClick={action.run} innerHTML={action.icon} />
        )}</For>
        <Show when={props.children}>{props.children}</Show>
      </div>
    </div>
  );
}
