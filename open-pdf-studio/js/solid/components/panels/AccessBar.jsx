// Panel access bar (the external editor): a 36 px strip of 20 px panel icons beside a host.
// Click = activate (the open active tab collapses its host); right-click a
// tab = Show ▸ / Hide / Attach ▸ (the context menu's panel-tab variant). The bottom bar starts with a » toggle that
// collapses or expands the bottom host.

import { For, Show } from 'solid-js';
import { workspaceLayout } from '../../stores/workspaceLayout.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { lucide } from '../../data/lucideIcons.js';
import { accessBarItems } from './panelHostLogic.js';
import { getPanelEntry, panelTitle } from './panelRegistry.js';
import { clickAccessTab, toggleHost } from './panelActions.js';
import { showPanelTabMenu } from '../../stores/contextMenuStore.js';

const isRtl = () => document.documentElement.dir === 'rtl';

/** Chevrons point where the panel goes: in to collapse, out to expand (mirrored right to left). */
export function sideToggleIcon(host, collapsed, rtl = isRtl()) {
  const outward = (host === 'left') !== rtl ? 'chevrons-right' : 'chevrons-left';
  const inward = outward === 'chevrons-right' ? 'chevrons-left' : 'chevrons-right';
  return collapsed ? outward : inward;
}

function sideToggleTitle(host, collapsed, t) {
  const side = host === 'left' ? 'Left' : 'Right';
  const text = t(`panelHost.${collapsed ? 'expand' : 'collapse'}${side}`);
  return host === 'left' ? `${text} (Ctrl+B)` : text;
}

export default function AccessBar(props) {
  const { t } = useTranslation('common');
  const items = () => accessBarItems(workspaceLayout(), props.host);
  const collapsed = () => !!workspaceLayout().hosts[props.host]?.collapsed;

  // Right-click: the app context menu's panel-tab variant (Show ▸ / Hide /
  // Attach ▸, ContextMenu.jsx).
  const menuAt = (e, panelId) => {
    e.preventDefault();
    e.stopPropagation();
    showPanelTabMenu(e.clientX, e.clientY, panelId, { titleOf: (id) => panelTitle(id, t) });
  };

  return (
    <nav class={`ws-access-bar ws-access-${props.host}`} role="tablist"
      aria-orientation="vertical" aria-label={t('panelHost.accessBar', { host: t(`panelHost.${props.host}`) })}
      onContextMenu={(e) => {
        // Right-click on the empty part: the Show ▸ list of the first tab.
        const first = items()[0]?.id;
        if (first && e.target === e.currentTarget) menuAt(e, first);
        else e.preventDefault();
      }}>
      <Show when={props.host === 'bottom'}>
        <button type="button" class="ws-access-toggle" title={t('panelHost.toggleBottom')}
          aria-expanded={!collapsed()} onClick={() => toggleHost('bottom')}
          innerHTML={lucide(collapsed() ? 'chevrons-right' : 'chevrons-down')} />
      </Show>
      {/* Left and right: the same toggle at the top of the bar, pointing the
          way the panel will go; collapsed, the bar (and this) stays. */}
      <Show when={props.host !== 'bottom' && items().length > 0}>
        <button type="button" class={`ws-access-toggle ws-host-collapse ws-host-collapse-${props.host}`}
          title={sideToggleTitle(props.host, collapsed(), t)} aria-label={sideToggleTitle(props.host, collapsed(), t)}
          aria-expanded={!collapsed()} onClick={() => toggleHost(props.host)}
          innerHTML={lucide(sideToggleIcon(props.host, collapsed()))} />
      </Show>
      <For each={items()}>{(item) => (
        <button type="button" role="tab" class={`ws-access-tab${item.active ? ' active' : ''}`}
          data-panel={item.id} aria-selected={item.active} aria-label={panelTitle(item.id, t)}
          data-tip={panelTitle(item.id, t)} data-tip-key={getPanelEntry(item.id)?.shortcut || ''}
          onClick={() => clickAccessTab(props.host, item.id)}
          onContextMenu={(e) => menuAt(e, item.id)}
          innerHTML={getPanelEntry(item.id)?.icon || ''} />
      )}</For>
    </nav>
  );
}
