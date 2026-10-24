// One popup level of the menu bar (a menu or a submenu): 26 px rows with a
// 16 px icon column (the icon, or a check for a checked toggle), the label,
// the right-aligned shortcut and a ▸ for submenus. MenuBar.jsx owns the
// state (which item is highlighted, which submenu is open) and positions
// the popup (position: fixed, clamped to the window).

import { For, Show, Switch, Match, onMount, createEffect } from 'solid-js';

const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const ARROW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg>';

/**
 * Props:
 *   items()      resolved items: { kind, text, icon, shortcut, enabled, checked }
 *   level        0 = top menu, 1+ = submenu
 *   highlighted  index of the highlighted item (-1 for none)
 *   open         index of the item whose submenu is open (-1 for none)
 *   anchor       { left, top, flipLeft? } in viewport px; flipLeft is the x
 *                to use when the popup does not fit to the right
 *   onHover(i), onActivate(i), itemRef(i, el)
 */
export default function MenuPopup(props) {
  let el;

  // Keep the popup inside the window: shift it up, or open a submenu to the
  // left of its parent when it would leave the right edge.
  const place = () => {
    if (!el) return;
    const a = props.anchor;
    el.style.left = `${a.left}px`;
    el.style.top = `${a.top}px`;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (r.right > vw - 4) el.style.left = `${Math.max(4, a.flipLeft != null ? a.flipLeft - r.width : vw - 4 - r.width)}px`;
    if (r.bottom > vh - 4) el.style.top = `${Math.max(4, vh - 4 - r.height)}px`;
  };
  onMount(place);
  createEffect(() => { props.anchor; props.items(); queueMicrotask(place); });

  return (
    <div class={`menu-popup${props.level > 0 ? ' menu-popup-sub' : ''}`} role="menu" ref={el}
      data-level={props.level} onContextMenu={(e) => e.preventDefault()}>
      <For each={props.items()}>
        {(item, i) => (
          <Switch>
            <Match when={item.kind === 'separator'}>
              <div class="menu-separator" role="separator" />
            </Match>
            <Match when={true}>
              <div
                ref={(node) => props.itemRef?.(i(), node)}
                class="menu-item"
                classList={{
                  highlighted: props.highlighted === i(),
                  disabled: !item.enabled,
                  'submenu-open': props.open === i(),
                }}
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked === undefined ? undefined : String(item.checked)}
                aria-disabled={item.enabled ? undefined : 'true'}
                aria-haspopup={item.kind === 'submenu' ? 'menu' : undefined}
                data-command={item.command || undefined}
                onPointerEnter={() => props.onHover(i())}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => props.onActivate(i())}
              >
                <span class="menu-item-icon" classList={{ checked: !!item.checked }}
                  innerHTML={item.checked && !item.icon ? CHECK : (item.icon || '')} />
                <span class="menu-item-label">{item.text}</span>
                <span class="menu-item-shortcut">{item.shortcut || ''}</span>
                <Show when={item.kind === 'submenu'} fallback={<span class="menu-item-arrow" />}>
                  <span class="menu-item-arrow" innerHTML={ARROW} />
                </Show>
              </div>
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
