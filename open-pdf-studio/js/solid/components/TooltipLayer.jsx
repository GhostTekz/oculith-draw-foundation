// One tooltip for the shell's toolbars: any element with data-tip (the
// label), optional data-tip-key (its shortcut, shown as keys) and
// data-tip-desc (a line of help) gets a token-styled tooltip after a short
// hover, below it (above near the bottom edge). No animation; it hides on
// leave, press, scroll and Esc. Mounted once in App.jsx.

import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { shortcutParts } from '../commands/shortcut-display.js';

const DELAY_MS = 450;
// A tooltip shown less than this long ago makes the next one show at once
// (moving along a toolbar).
const WARM_MS = 600;

export default function TooltipLayer() {
  const [tip, setTip] = createSignal(null);
  let timer = 0;
  let current = null;
  let hiddenAt = 0;
  let el;

  const place = (target) => {
    const r = target.getBoundingClientRect();
    return { target, label: target.dataset.tip, keys: target.dataset.tipKey || '', desc: target.dataset.tipDesc || '', r };
  };
  const hide = () => {
    clearTimeout(timer);
    if (tip()) hiddenAt = performance.now();
    current = null;
    setTip(null);
  };
  const onOver = (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target === current) return;
    hide();
    if (!target || !target.dataset.tip) return;
    current = target;
    const warm = performance.now() - hiddenAt < WARM_MS;
    timer = setTimeout(() => {
      if (current !== target || !target.isConnected) return;
      setTip(place(target));
      // Again once the tooltip has its size, to keep it inside the window.
      requestAnimationFrame(() => { if (current === target) setTip(place(target)); });
    }, warm ? 0 : DELAY_MS);
  };
  const onKey = (e) => { if (e.key === 'Escape') hide(); };

  onMount(() => {
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', hide);
    onCleanup(() => {
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', hide);
      clearTimeout(timer);
    });
  });

  // Below the element, kept inside the window; above it near the bottom.
  const style = () => {
    const t = tip();
    const w = Math.min(320, Math.max(80, el?.offsetWidth || 160));
    const h = el?.offsetHeight || 28;
    const left = Math.max(4, Math.min(t.r.left + t.r.width / 2 - w / 2, window.innerWidth - w - 4));
    const below = t.r.bottom + 6;
    const top = below + h > window.innerHeight - 4 ? Math.max(4, t.r.top - h - 6) : below;
    return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
  };

  return (
    <Show when={tip()}>
      <Portal>
        <div class="ox-tooltip" role="tooltip" ref={el} style={style()}>
          <div class="ox-tooltip-head">
            <span class="ox-tooltip-label">{tip().label}</span>
            <Show when={tip().keys}>
              <span class="ox-tooltip-keys"><For each={shortcutParts(tip().keys)}>{(k) => <kbd>{k}</kbd>}</For></span>
            </Show>
          </div>
          <Show when={tip().desc}><div class="ox-tooltip-desc">{tip().desc}</div></Show>
        </div>
      </Portal>
    </Show>
  );
}
