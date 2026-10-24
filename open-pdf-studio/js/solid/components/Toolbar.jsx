// Generic toolbar: a row or column of buttons for command-registry ids
// (js/solid/commands/registry.js). Used by the plan-review workspace for the
// vertical Markup/Measure toolbars (WP2) and any other named toolbar.
//
// Props (stable API, see docs/WORKSPACE-SPEC.md §9.3):
//   ids          array of command ids; '|' (or '-') draws a separator.
//                Unknown ids are skipped, so a toolbar can list commands a
//                later package registers.
//   orientation  'horizontal' (default) | 'vertical'
//   size         'sm' (26 px buttons, 16 px icons) | 'md' (34 px, 20 px; default)
//   label        accessible name of the toolbar (aria-label), optional
//   class        extra class on the root, optional
//
// Each button shows the command icon, a tooltip "Label (Shortcut)", is
// disabled when isCommandEnabled() is false and pressed (aria-pressed,
// .active) when isCommandChecked() is true. Click runs runCommand(id).
// Arrow keys move focus along the toolbar (roving tabindex).

import { For, Show } from 'solid-js';
import { getCommand, commandLabel, isCommandEnabled, isCommandChecked, runCommand, commandsVersion } from '../commands/registry.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const SEPARATORS = new Set(['|', '-']);

export function toolbarItems(ids) {
  // Resolve ids to commands; drop unknown ids, leading/trailing and doubled
  // separators. Exported for tests.
  const out = [];
  for (const id of ids || []) {
    if (SEPARATORS.has(id)) {
      if (out.length && out[out.length - 1] !== '|') out.push('|');
    } else if (getCommand(id)) {
      out.push(id);
    }
  }
  while (out[out.length - 1] === '|') out.pop();
  return out;
}

export default function Toolbar(props) {
  const { t } = useTranslation('common');
  const vertical = () => props.orientation === 'vertical';
  const items = () => { commandsVersion(); return toolbarItems(props.ids); };

  const onKeyDown = (e) => {
    const keys = vertical() ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (!keys.includes(e.key) && e.key !== 'Home' && e.key !== 'End') return;
    const buttons = [...e.currentTarget.querySelectorAll('button.ox-toolbar-btn:not(:disabled)')];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else next = (at + (e.key === keys[1] ? 1 : -1) + buttons.length) % buttons.length;
    e.preventDefault();
    buttons[next].focus();
  };

  return (
    <div
      class={`ox-toolbar ox-toolbar-${vertical() ? 'vertical' : 'horizontal'} ox-toolbar-${props.size === 'sm' ? 'sm' : 'md'}${props.class ? ' ' + props.class : ''}`}
      role="toolbar"
      aria-orientation={vertical() ? 'vertical' : 'horizontal'}
      aria-label={props.label}
      onKeyDown={onKeyDown}
    >
      <For each={items()}>
        {(id, index) => (
          <Show when={id !== '|'} fallback={<span class="ox-toolbar-sep" role="separator" />}>
            {(() => {
              const cmd = getCommand(id);
              const label = () => commandLabel(cmd, t);
              const checked = () => isCommandChecked(cmd);
              return (
                <button
                  type="button"
                  class={`ox-toolbar-btn${checked() ? ' active' : ''}`}
                  data-command={id}
                  title={cmd.shortcut ? `${label()} (${cmd.shortcut})` : label()}
                  aria-label={label()}
                  aria-pressed={checked() === undefined ? undefined : String(checked())}
                  disabled={!isCommandEnabled(cmd)}
                  tabIndex={index() === 0 ? 0 : -1}
                  onClick={() => runCommand(id)}
                >
                  <span class="ox-toolbar-icon" innerHTML={cmd.icon || ''} />
                </button>
              );
            })()}
          </Show>
        )}
      </For>
    </div>
  );
}
