// The plan-review menu bar, merged with the window title row (spec §3 R1):
// one 30 px row with the Oculith logo, the menus (Oculith, File, Edit, View,
// Document, Batch, Tools, Window, Help), a drag region and the window
// controls. Menus come from commands/menus.js and run registry commands.
//
// Behaviour (Windows/the external editor menus):
//   - click a title opens its menu; while one is open, hovering another title
//     switches to it; click outside, Esc or Tab closes
//   - arrows, Home/End, Enter/Space in the menus (menuModel.js), ▸ submenus
//   - Alt+letter opens a menu (mnemonic), unless that Alt binding is a
//     command shortcut: Alt+T and Alt+B are the Thumbnails and Bookmarks
//     panels (the external editor), so Tools and Batch open with Alt, then T / B
//   - a lone Alt press gives the bar keyboard focus (arrows, letters, Enter)
//   - F9 (view.menuBar) hides the menus; Alt and the mnemonics still show them

import { For, Show, createSignal, createMemo, onMount, onCleanup, untrack } from 'solid-js';
import { Portal } from 'solid-js/web';
import { MENUS, menuItem, menuIndexForMnemonic } from '../../commands/menus.js';
import {
  getCommand, listCommands, commandLabel, isCommandEnabled, isCommandChecked, runCommand, commandsVersion,
} from '../../commands/index.js';
import { isToolbarVisible } from '../../stores/workspaceLayout.js';
import { lazyModule } from '../../commands/util.js';
import { menuKeyAction, barKeyAction, edgeIndex, isNavigable } from './menuModel.js';
import MenuPopup from './MenuPopup.jsx';
import CommandPalette from '../CommandPalette.jsx';
import GoToSheet from '../GoToSheet.jsx';
import { AppLogo, WindowControls, hasDialogs } from '../TitleBar.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { isTauri } from '../../../core/platform.js';

const stylePresets = lazyModule(() => import('../../stores/stylePresetsStore.js'));

// Submenus whose items are built when they open (menus.js `dynamic`).
const DYNAMIC_MENUS = {
  stylePresets: () => {
    const presets = stylePresets()?.getStylePresets() || [];
    if (!presets.length) return [{ placeholder: 'common:menu.noStylePresets' }];
    return presets.map((p) => ({ command: 'format.applyStylePreset', args: [p.id], text: p.name }));
  },
};

/** Is this Alt binding taken by a command (e.g. Alt+T = Thumbnails)? */
function altBindingTaken(letter) {
  const binding = `Alt+${letter.toUpperCase()}`;
  return listCommands().some((c) => c.shortcut === binding);
}

export default function MenuBar() {
  const { t } = useTranslation('common');
  const [openIndex, setOpenIndex] = createSignal(-1);
  const [path, setPath] = createSignal([]); // highlighted index per level
  const [depth, setDepth] = createSignal(0); // deepest open level (0 = top popup)
  const [barFocus, setBarFocus] = createSignal(-1); // Alt-mode highlighted title
  const [altDown, setAltDown] = createSignal(false);
  const titleEls = [];
  const itemEls = []; // itemEls[level][index]
  let rowEl;

  const mnemonics = MENUS.map((m) => m.mnemonic);
  const isOpen = () => openIndex() >= 0;
  const menuVisible = () => isToolbarVisible('menu');
  const revealed = () => menuVisible() || isOpen() || barFocus() >= 0;

  // --- items -------------------------------------------------------------------

  function childrenOf(raw) {
    const item = raw === undefined ? null : menuItem(raw);
    if (!item || item.kind !== 'submenu') return null;
    return item.dynamic ? DYNAMIC_MENUS[item.dynamic]?.() || [] : item.items;
  }

  /** Raw items of popup level k (0 = the open menu) along the highlight path. */
  function rawLevel(k, p = path()) {
    const i = openIndex();
    if (i < 0) return [];
    let raw = MENUS[i].items;
    for (let j = 0; j < k; j++) {
      raw = childrenOf(raw[p[j]]);
      if (!raw) return [];
    }
    return raw;
  }

  function resolve(raw) {
    commandsVersion();
    return raw.map((r) => {
      const item = menuItem(r);
      if (item.kind === 'separator') return item;
      if (item.kind === 'placeholder') return { ...item, text: t(item.label), enabled: false };
      if (item.kind === 'submenu') {
        return { ...item, text: t(item.label), enabled: (childrenOf(r) || []).length > 0 };
      }
      const cmd = getCommand(item.command);
      if (!cmd) return { ...item, text: t(item.pending || item.command), enabled: false };
      return {
        ...item,
        text: r.text ?? (item.label ? t(item.label) : commandLabel(cmd, t)),
        icon: cmd.icon,
        shortcut: item.args.length ? null : cmd.shortcut,
        enabled: isCommandEnabled(cmd),
        checked: item.args.length ? undefined : isCommandChecked(cmd),
      };
    });
  }

  /** Resolved items of level k right now (keyboard and click handlers). */
  const itemsAt = (k) => untrack(() => resolve(rawLevel(k)));
  const levelIds = createMemo(() => (openIndex() < 0 ? [] : Array.from({ length: depth() + 1 }, (_, k) => k)));

  // --- open / close ----------------------------------------------------------------

  function openMenu(index, { focusFirst = false } = {}) {
    if (hasDialogs()) return;
    const n = MENUS.length;
    const i = ((index % n) + n) % n;
    setOpenIndex(i);
    setDepth(0);
    setBarFocus(-1);
    setPath([focusFirst ? edgeIndex(untrack(() => resolve(MENUS[i].items)), 1) : -1]);
  }

  function closeMenus() {
    setOpenIndex(-1);
    setDepth(0);
    setPath([]);
    setBarFocus(-1);
  }

  function highlight(level, index) {
    setPath((p) => [...p.slice(0, level), index]);
  }

  function openSubmenu(level, index) {
    const item = itemsAt(level)[index];
    if (!item || item.kind !== 'submenu' || !item.enabled) return;
    const p = [...path().slice(0, level), index];
    setPath([...p, edgeIndex(untrack(() => resolve(rawLevel(level + 1, p))), 1)]);
    setDepth(level + 1);
  }

  function activate(level, index) {
    const item = itemsAt(level)[index];
    if (!item || !isNavigable(item)) return;
    if (item.kind === 'submenu') { openSubmenu(level, index); return; }
    closeMenus();
    runCommand(item.command, ...item.args);
  }

  function hover(level, index) {
    const item = itemsAt(level)[index];
    highlight(level, index);
    if (item?.kind === 'submenu' && item.enabled) {
      setDepth(level + 1);
      setPath((p) => [...p.slice(0, level + 1), -1]);
    } else {
      setDepth(level);
    }
  }

  // --- positions --------------------------------------------------------------------

  function anchorFor(level) {
    if (level === 0) {
      const r = titleEls[openIndex()]?.getBoundingClientRect();
      return { left: r ? r.left : 0, top: rowEl ? rowEl.getBoundingClientRect().bottom : 30 };
    }
    const el = itemEls[level - 1]?.[path()[level - 1]];
    const r = el?.getBoundingClientRect();
    if (!r) return { left: 0, top: 0 };
    return { left: r.right - 2, top: r.top - 4, flipLeft: r.left + 2 };
  }

  // --- keyboard ---------------------------------------------------------------------

  function onKeyDown(e) {
    if (e.key === 'Alt') {
      setAltDown(true);
      return;
    }
    setAltDown(false);

    if (isOpen()) {
      const d = depth();
      const items = itemsAt(d);
      const index = path()[d] ?? -1;
      const action = menuKeyAction(e.key, items, index, d);
      if (!action) {
        // A letter jumps to the next item starting with it.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const letter = e.key.toLowerCase();
          const start = index < 0 ? 0 : index + 1;
          for (let k = 0; k < items.length; k++) {
            const j = (start + k) % items.length;
            if (isNavigable(items[j]) && items[j].text?.toLowerCase().startsWith(letter)) { highlight(d, j); break; }
          }
        }
        if (!(e.altKey && /^[a-z]$/i.test(e.key))) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        if (action.type === 'move') highlight(d, action.index);
        else if (action.type === 'openSubmenu') openSubmenu(d, index);
        else if (action.type === 'closeSubmenu') { setDepth(d - 1); setPath((p) => p.slice(0, d)); }
        else if (action.type === 'switchMenu') openMenu(openIndex() + action.delta, { focusFirst: true });
        else if (action.type === 'activate') activate(d, index);
        else if (action.type === 'close') closeMenus();
        return;
      }
    }

    if (barFocus() >= 0 && !e.ctrlKey && !e.metaKey) {
      const action = barKeyAction(e.key, mnemonics, barFocus());
      e.preventDefault();
      e.stopPropagation();
      if (action.type === 'move') setBarFocus(action.index);
      else if (action.type === 'open') openMenu(action.index, { focusFirst: true });
      else setBarFocus(-1);
      return;
    }

    // Alt+letter mnemonics (not with Ctrl or Shift: Shift+Alt+L etc. are
    // measure tools). A binding that is a command shortcut is left alone.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Key[A-Z]$/.test(e.code || '')) {
      const letter = e.code.slice(3);
      const index = menuIndexForMnemonic(letter);
      if (index >= 0 && !altBindingTaken(letter) && !hasDialogs()) {
        e.preventDefault();
        e.stopPropagation();
        openMenu(index, { focusFirst: true });
      }
    }
  }

  // A lone Alt press (down and up with nothing in between) focuses the bar.
  function onKeyUp(e) {
    if (e.key !== 'Alt' || !altDown()) return;
    setAltDown(false);
    e.preventDefault();
    if (isOpen()) closeMenus();
    else if (barFocus() >= 0) setBarFocus(-1);
    else if (!hasDialogs()) setBarFocus(0);
  }

  function onPointerDown(e) {
    setAltDown(false);
    if (!isOpen() && barFocus() < 0) return;
    if (e.target.closest?.('.menu-popup, .menu-bar-title')) return;
    closeMenus();
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', closeMenus);
  });
  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', closeMenus);
  });

  // --- render -------------------------------------------------------------------------

  const titleText = (menu) => {
    const text = t(menu.label);
    const at = (altDown() || barFocus() >= 0) ? text.toUpperCase().indexOf(menu.mnemonic) : -1;
    if (at < 0) return text;
    return <>{text.slice(0, at)}<u>{text[at]}</u>{text.slice(at + 1)}</>;
  };

  return (
    <div
      ref={rowEl}
      class="menu-bar"
      classList={{ 'dialogs-open': hasDialogs(), 'menus-hidden': !revealed(), 'no-window-controls': !isTauri() }}
      data-tauri-drag-region
    >
      <div class="menu-bar-logo" data-tauri-drag-region><AppLogo /></div>
      <div class="menu-bar-menus" role="menubar" aria-label={t('menu.menuBar')}>
        <For each={MENUS}>
          {(menu, i) => (
            <button
              type="button"
              ref={(el) => { titleEls[i()] = el; }}
              class="menu-bar-title"
              classList={{ open: openIndex() === i(), focused: barFocus() === i() }}
              id={`menu-${menu.id}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openIndex() === i()}
              tabIndex={-1}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                if (openIndex() === i()) closeMenus(); else openMenu(i());
              }}
              onPointerEnter={() => { if (isOpen() && openIndex() !== i()) openMenu(i()); }}
            >
              {titleText(menu)}
            </button>
          )}
        </For>
      </div>
      <div class="menu-bar-drag" data-tauri-drag-region />
      <WindowControls />

      <Show when={isOpen()}>
        <Portal>
          <For each={levelIds()}>
            {(level) => {
              const parentIndex = createMemo(() => (level === 0 ? openIndex() : path()[level - 1]));
              const raw = createMemo(() => { parentIndex(); return untrack(() => rawLevel(level)); });
              const items = createMemo(() => resolve(raw()));
              return (
                <MenuPopup
                  items={items}
                  level={level}
                  highlighted={path()[level] ?? -1}
                  open={depth() > level ? path()[level] : -1}
                  anchor={(parentIndex(), anchorFor(level))}
                  itemRef={(index, el) => { (itemEls[level] ||= [])[index] = el; }}
                  onHover={(index) => hover(level, index)}
                  onActivate={(index) => activate(level, index)}
                />
              );
            }}
          </For>
        </Portal>
      </Show>
      <CommandPalette />
      <GoToSheet />
    </div>
  );
}
