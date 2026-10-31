// The coach mark of a guided tour (js/tour/tours.js): a small card beside
// the step's anchor with a spotlight on it. Enter goes on, Esc closes for now
// (the tour continues at this step next time). The card can be dragged by
// its header and never closes on an outside click; the rest of the
// workspace stays usable while it shows.
import { Show, createEffect, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import { activeTour, resolveAnchor, tourBack, tourNext, tourPause, tourSkip } from '../../tour/tours.js';
import { tourText } from '../../tour/tour-model.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const GAP = 12;
const CARD_W = 300;
const MARGIN = 8;

function placeCard(rect, card, placement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ch = card?.offsetHeight || 150;
  const cw = card?.offsetWidth || CARD_W;
  const clampX = (x) => Math.max(MARGIN, Math.min(x, vw - cw - MARGIN));
  const clampY = (y) => Math.max(MARGIN, Math.min(y, vh - ch - MARGIN));
  if (!rect || placement === 'center') return { left: clampX((vw - cw) / 2), top: clampY((vh - ch) / 2) };
  const fits = {
    bottom: rect.bottom + GAP + ch <= vh - MARGIN,
    top: rect.top - GAP - ch >= MARGIN,
    right: rect.right + GAP + cw <= vw - MARGIN,
    left: rect.left - GAP - cw >= MARGIN,
  };
  const side = placement !== 'auto' && fits[placement] ? placement
    : ['bottom', 'right', 'left', 'top'].find((s) => fits[s]) || 'center';
  if (side === 'bottom') return { left: clampX(rect.left), top: rect.bottom + GAP };
  if (side === 'top') return { left: clampX(rect.left), top: rect.top - GAP - ch };
  if (side === 'right') return { left: rect.right + GAP, top: clampY(rect.top) };
  if (side === 'left') return { left: rect.left - GAP - cw, top: clampY(rect.top) };
  return { left: clampX(rect.left + rect.width / 2 - cw / 2), top: clampY(rect.top + rect.height / 2 - ch / 2) };
}

export default function TourCoach() {
  let card;
  const { t } = useTranslation('common');
  // The step's text in the interface language (the tour's own English otherwise).
  const words = () => {
    const active = activeTour();
    return active ? tourText(active.tour, active.index, t) : { tourTitle: '', title: '', body: [] };
  };
  const [rect, setRect] = createSignal(null);
  const [pos, setPos] = createSignal({ left: 0, top: 0 });
  const [dragged, setDragged] = createSignal(null);

  const measure = () => {
    const active = activeTour();
    if (!active) { setRect(null); return; }
    const el = resolveAnchor(active.step.anchor);
    const r = el?.getBoundingClientRect() || null;
    const prev = rect();
    if (r && prev && Math.abs(r.left - prev.left) < 0.5 && Math.abs(r.top - prev.top) < 0.5
      && Math.abs(r.width - prev.width) < 0.5 && Math.abs(r.height - prev.height) < 0.5) return;
    setRect(r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null);
  };

  createEffect(() => {
    const active = activeTour();
    untrack(() => setDragged(null));
    if (!active) return;
    untrack(measure);
    queueMicrotask(() => {
      setPos(placeCard(rect(), card, active.step.placement));
      card?.querySelector('[data-tour-next]')?.focus({ preventScroll: true });
    });
  });
  createEffect(() => {
    const r = rect();
    const active = activeTour();
    if (active && !dragged()) untrack(() => setPos(placeCard(r, card, active.step.placement)));
  });

  // Anchors move with panels and window size; follow them while a step shows.
  let timer = 0;
  onMount(() => {
    timer = setInterval(() => { if (activeTour()) measure(); }, 300);
    window.addEventListener('resize', measure);
  });
  onCleanup(() => { clearInterval(timer); window.removeEventListener('resize', measure); });

  const onKey = (e) => {
    if (!activeTour()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tourPause(); return; }
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target;
    const inCard = card?.contains(target);
    if (!inCard && target?.closest?.('input, textarea, select, [contenteditable="true"], button')) return;
    if (inCard && target?.closest?.('button') && !target.hasAttribute('data-tour-next')) return;
    e.preventDefault();
    e.stopPropagation();
    tourNext();
  };
  onMount(() => window.addEventListener('keydown', onKey, true));
  onCleanup(() => window.removeEventListener('keydown', onKey, true));

  // Drag by the header (the cursor stays the default one).
  let drag = null;
  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = card.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!drag || !card) return;
    const left = Math.max(0, Math.min(e.clientX - drag.dx, window.innerWidth - card.offsetWidth));
    const top = Math.max(0, Math.min(e.clientY - drag.dy, window.innerHeight - card.offsetHeight));
    setDragged(true);
    setPos({ left, top });
  };
  const onUp = () => { drag = null; };
  onMount(() => { window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); });
  onCleanup(() => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); });

  return (
    <Show when={activeTour()}>
      {(active) => (
        <div class="tour-layer" data-tour={active().tour.id}>
          <Show when={rect()} fallback={<div class="tour-dim" />}>
            {(r) => (
              <div class="tour-spotlight" data-tour-spotlight style={{
                left: `${r().left - 4}px`, top: `${r().top - 4}px`,
                width: `${r().width + 8}px`, height: `${r().height + 8}px`,
              }} />
            )}
          </Show>
          <div class="tour-card" ref={card} role="dialog" aria-modal="false" aria-labelledby="tour-card-title"
            data-tour-card style={{ left: `${pos().left}px`, top: `${pos().top}px` }}>
            <div class="tour-card-header" onMouseDown={onDown}>
              <span class="tour-card-eyebrow">{words().tourTitle}</span>
              <button type="button" class="tour-card-close" title={t('tour.closeTitle')}
                aria-label={t('tour.close')} onClick={() => tourPause()} data-tour-close>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div class="tour-card-body">
              <h3 id="tour-card-title">{words().title}</h3>
              {words().body.map((line) => <p>{line}</p>)}
            </div>
            <div class="tour-card-footer">
              <span class="tour-card-count" data-tour-count>{t('tour.stepOf', { index: active().index + 1, total: active().total })}</span>
              <button type="button" class="tour-btn tour-btn-quiet" onClick={() => tourSkip()} data-tour-skip>{t('tour.skip')}</button>
              <button type="button" class="tour-btn" disabled={active().index === 0} onClick={() => tourBack()} data-tour-back>{t('tour.back')}</button>
              <button type="button" class="tour-btn tour-btn-primary" onClick={() => tourNext()} data-tour-next>
                {active().index + 1 === active().total ? t('tour.done') : t('tour.next')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
