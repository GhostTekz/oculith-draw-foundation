// Small popup menu for the panel hosts: the access-bar tab context menu
// (Show ▸ / Hide / Attach ▸) and the header "Title ▾" panel menu.
// Items: { label, icon?, checked?, disabled?, run?, items? (submenu) } or
// { separator: true }. One menu at a time; Esc or a click outside closes it.
// (WP4 restyles the app context menus; this one already uses the same
// 26 px rows with an icon column and ▸ submenus.)

import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';

const [menu, setMenu] = createSignal(null);

/** Open a menu at viewport coordinates. */
export function openPanelMenu(x, y, items) {
  setMenu({ x, y, items });
}

export function closePanelMenu() {
  setMenu(null);
}

export { menu as panelMenu };

function MenuList(props) {
  const [openSub, setOpenSub] = createSignal(-1);
  return (
    <div class="ws-menu" role="menu" style={props.style}
      onContextMenu={(e) => e.preventDefault()}>
      <For each={props.items}>{(item, i) => (
        <Show when={!item.separator} fallback={<div class="ws-menu-sep" role="separator" />}>
          <div class={`ws-menu-item${item.disabled ? ' disabled' : ''}${item.items ? ' has-sub' : ''}`}
            role="menuitem" tabindex="-1" aria-disabled={item.disabled ? 'true' : undefined}
            title={item.title || undefined}
            aria-haspopup={item.items ? 'menu' : undefined}
            aria-checked={item.checked === undefined ? undefined : String(!!item.checked)}
            onPointerEnter={() => setOpenSub(item.items ? i() : -1)}
            onClick={(e) => {
              e.stopPropagation();
              if (item.disabled) return;
              if (item.items) { setOpenSub(i()); return; }
              closePanelMenu();
              item.run?.();
            }}>
            <span class="ws-menu-icon" innerHTML={item.icon || ''} />
            <span class="ws-menu-check">{item.checked ? '✓' : ''}</span>
            <span class="ws-menu-label">{item.label}</span>
            <Show when={item.items}><span class="ws-menu-arrow" aria-hidden="true">{'▸'}</span></Show>
            <Show when={item.items && openSub() === i()}>
              <MenuList items={item.items} style={{ left: '100%', top: '-4px' }} />
            </Show>
          </div>
        </Show>
      )}</For>
    </div>
  );
}

/** Render once (PanelHost mounts it); position: fixed, so DOM place does not matter. */
export function PanelMenuLayer() {
  let root;
  onMount(() => {
    const dismiss = (e) => {
      if (!menu()) return;
      if (e.type === 'keydown') {
        if (e.key === 'Escape') { e.preventDefault(); closePanelMenu(); }
        return;
      }
      if (!root?.contains(e.target)) closePanelMenu();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    window.addEventListener('blur', closePanelMenu);
    onCleanup(() => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('blur', closePanelMenu);
    });
  });
  // Keep the menu inside the window (estimated size; rows are 26 px).
  const pos = () => {
    const m = menu();
    const rows = m.items.length;
    const h = rows * 26 + 8;
    const w = 220;
    return {
      left: `${Math.max(4, Math.min(m.x, window.innerWidth - w - 4))}px`,
      top: `${Math.max(4, Math.min(m.y, window.innerHeight - h - 4))}px`,
    };
  };
  return (
    <Show when={menu()}>
      <div class="ws-menu-layer" ref={root} style={pos()}>
        <MenuList items={menu().items} />
      </div>
    </Show>
  );
}
