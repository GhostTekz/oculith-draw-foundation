// Help > Find Tools + Commands (the external editor; Ctrl+Shift+P is our alias): a search
// box over the command registry. Typing filters with searchCommands();
// each row shows the menu it lives in ("Document ▸"), the label and the
// shortcut. Arrow keys move, Enter runs, Esc or a click outside closes.
// It is a transient picker like a menu, not a modal dialog.

import { For, Show, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { commandLabel, isCommandEnabled, runCommand } from '../commands/index.js';
import { OPEN_COMMAND_PALETTE } from '../commands/oculith.js';
import { paletteResults } from '../commands/palette.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// Opened by runCommand('help.findCommands') (Ctrl+Shift+P), which fires
// OPEN_COMMAND_PALETTE.
const [open, setOpen] = createSignal(false);
export const commandPaletteOpen = open;

export default function CommandPalette() {
  const { t } = useTranslation('common');
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  let inputEl;
  let listEl;

  const results = createMemo(() => (open() ? paletteResults(query(), t) : []));

  const onOpen = () => {
    setQuery('');
    setActive(0);
    setOpen(true);
    queueMicrotask(() => inputEl?.focus());
  };
  onMount(() => window.addEventListener(OPEN_COMMAND_PALETTE, onOpen));
  onCleanup(() => window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen));

  const close = () => setOpen(false);
  const run = (row) => {
    if (!row || !isCommandEnabled(row.cmd)) return;
    close();
    runCommand(row.cmd.id);
  };
  const move = (delta) => {
    const n = results().length;
    if (!n) return;
    const next = (active() + delta + n) % n;
    setActive(next);
    listEl?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e) => {
    // Keep the app's shortcuts out while typing here.
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results()[active()]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <Show when={open()}>
      <Portal>
        <div class="command-palette-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div class="command-palette" role="dialog" aria-label={t('menu.palette.title')}>
            <input
              ref={inputEl}
              class="command-palette-input"
              type="text"
              spellcheck={false}
              autocomplete="off"
              placeholder={t('menu.palette.placeholder')}
              value={query()}
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={results().length ? `command-palette-row-${active()}` : undefined}
              onInput={(e) => { setQuery(e.currentTarget.value); setActive(0); }}
              onKeyDown={onKeyDown}
            />
            <div class="command-palette-list" id="command-palette-list" role="listbox" ref={listEl}>
              <For each={results()} fallback={<div class="command-palette-empty">{t('menu.palette.empty')}</div>}>
                {(row, i) => (
                  <div
                    id={`command-palette-row-${i()}`}
                    class="command-palette-row"
                    classList={{ active: active() === i(), disabled: !isCommandEnabled(row.cmd) }}
                    role="option"
                    aria-selected={active() === i()}
                    aria-disabled={isCommandEnabled(row.cmd) ? undefined : 'true'}
                    data-command={row.cmd.id}
                    onPointerMove={() => setActive(i())}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => run(row)}
                  >
                    <span class="command-palette-icon" innerHTML={row.cmd.icon || ''} />
                    <span class="command-palette-path">{row.path.length ? `${row.path.join(' ▸ ')} ▸` : ''}</span>
                    <span class="command-palette-label">{commandLabel(row.cmd, t)}</span>
                    <span class="command-palette-shortcut">{row.cmd.shortcut || ''}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
