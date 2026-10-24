// Right-edge vertical toolbar (the external editor profile): 36 px wide, 34×34 buttons with
// 20 px icons, Markup | Draw | Measure groups with separators, a grip at the
// top (drag it off to float the tool palette) and a ▾ overflow at the bottom
// when the window is too short. Shown per workspaceLayout.toolbars.markup /
// .measure while the tool palette is docked.
//
// The buttons are the generic command toolbar (components/Toolbar.jsx) over
// the tools.markup.* / tools.measure.* command ids in verticalToolbarItems.js;
// this component adds the grip, the height fit and the overflow menu.

import { Show, createSignal, onCleanup } from 'solid-js';
import { isToolbarVisible } from '../../stores/workspaceLayout.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { lucide } from '../../data/lucideIcons.js';
import {
  getCommand, commandLabel, isCommandEnabled, isCommandChecked, runCommand, commandsVersion,
} from '../../commands/index.js';
import Toolbar from '../Toolbar.jsx';
import { toolPaletteFloating, startToolbarDrag, showPaletteCtxMenu } from '../ToolPalette.jsx';
import { toolbarEntries, toolbarIds, fitToolbarEntries } from './verticalToolbarItems.js';
import { openPanelMenu } from './PanelMenu.jsx';

const GRIP_PX = 14;

export default function VerticalToolbar() {
  const { t } = useTranslation('common');
  const [available, setAvailable] = createSignal(10000);
  const shown = () => !toolPaletteFloating() && (isToolbarVisible('markup') || isToolbarVisible('measure'));
  const entries = () => { commandsVersion(); return toolbarEntries(isToolbarVisible, (id) => !!getCommand(id)); };
  const fitted = () => fitToolbarEntries(entries(), available());

  let observer = null;
  const bind = (el) => {
    observer?.disconnect();
    if (!el) return;
    const measure = () => setAvailable(Math.max(0, el.clientHeight - GRIP_PX - 4));
    observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
  };
  onCleanup(() => observer?.disconnect());

  const openOverflow = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = fitted().overflow.map((item) => {
      if (item.separator) return { separator: true };
      const cmd = getCommand(item.command);
      return {
        label: commandLabel(cmd, t), icon: cmd.icon, checked: !!isCommandChecked(cmd),
        disabled: !isCommandEnabled(cmd), run: () => runCommand(item.command),
      };
    });
    openPanelMenu(r.left - 200, r.top - Math.min(items.length * 26, r.top - 8), items);
  };

  return (
    <Show when={shown()}>
      <div class="ws-vtoolbar" ref={bind} onContextMenu={showPaletteCtxMenu}>
        <div class="ws-vtoolbar-grip" onMouseDown={startToolbarDrag} innerHTML={lucide('grip-horizontal')} />
        <Toolbar ids={toolbarIds(fitted().visible)} orientation="vertical" size="md"
          label={t('panelHost.toolbar')} class="ws-vtoolbar-buttons" />
        <Show when={fitted().overflow.length}>
          <button type="button" class="ws-vtoolbar-more" title={t('panelHost.moreTools')}
            aria-label={t('panelHost.moreTools')} aria-haspopup="menu" onClick={openOverflow}
            innerHTML={lucide('chevron-down')} />
        </Show>
      </div>
    </Show>
  );
}
