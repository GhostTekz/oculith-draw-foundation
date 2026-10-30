import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { useTranslation } from '../../i18n/useTranslation.js';
import './detached-thumbnails.css';

const ROW_HEIGHT = 194;
const OVERSCAN = 3;
const MAX_RANGE = 24;
const source = new URLSearchParams(location.search).get('source') || '';
const validSource = /^(main|pdf-[a-zA-Z0-9-]+)$/.test(source);

export default function DetachedThumbnailsWindow() {
  const { t } = useTranslation('properties');
  const [child, setChild] = createSignal('');
  const [state, setState] = createSignal({ docId: '', count: 0, activePage: 0, title: '' });
  const [images, setImages] = createSignal({});
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(500);
  const [connected, setConnected] = createSignal(true);
  let viewport;
  let observer;
  let heartbeat;
  let unlisten = [];

  const range = createMemo(() => {
    const count = state().count;
    if (!count) return { start: 1, end: 0 };
    const start = Math.min(count, Math.max(1, Math.floor(scrollTop() / ROW_HEIGHT) + 1 - OVERSCAN));
    const end = Math.min(count, start + Math.min(MAX_RANGE, Math.ceil(viewportHeight() / ROW_HEIGHT) + 2 * OVERSCAN) - 1);
    return { start, end };
  }, undefined, { equals: (a, b) => a?.start === b?.start && a?.end === b?.end });
  const pages = () => Array.from({ length: Math.max(0, range().end - range().start + 1) },
    (_, index) => range().start + index);
  const emit = (name, payload) => Promise.resolve(window.__TAURI__?.event?.emitTo?.(source, name,
    { child: child(), ...payload })).catch(() => setConnected(false));
  const close = () => window.__TAURI__?.window?.getCurrentWindow?.()?.close?.();
  const focusDrawing = async () => {
    const W = window.__TAURI__?.webviewWindow?.WebviewWindow;
    const drawing = await W?.getByLabel(source);
    if (drawing) await drawing.setFocus();
    else setConnected(false);
  };

  createEffect(() => {
    const { start, end } = range();
    const docId = state().docId;
    if (child() && docId && end >= start) {
      setImages((current) => Object.fromEntries(Object.entries(current)
        .filter(([page]) => Number(page) >= start && Number(page) <= end)));
      void emit('thumbnail-view:range', { docId, start, end });
    }
  });

  onMount(async () => {
    if (!validSource || !window.__TAURI__?.event?.listen) { setConnected(false); return; }
    observer = new ResizeObserver(() => setViewportHeight(viewport?.clientHeight || 500));
    if (viewport) observer.observe(viewport);
    try {
      unlisten.push(await window.__TAURI__.event.listen('thumbnail-view:state', (event) => {
        const next = event.payload;
        if (next?.source !== source || !Number.isSafeInteger(next.count) || next.count < 0) return;
        const previous = state();
        if (next.docId !== previous.docId) {
          setImages({});
          if (viewport) viewport.scrollTop = Math.max(0, (next.activePage - 1) * ROW_HEIGHT);
        } else if (next.activePage !== previous.activePage && viewport && next.activePage > 0) {
          const top = (next.activePage - 1) * ROW_HEIGHT;
          if (top < viewport.scrollTop || top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) {
            viewport.scrollTop = top;
          }
        }
        setScrollTop(viewport?.scrollTop || 0);
        setState({ docId: next.docId, count: next.count,
          activePage: next.activePage, title: next.title || '' });
        setConnected(true);
      }));
      unlisten.push(await window.__TAURI__.event.listen('thumbnail-view:images', (event) => {
        const payload = event.payload;
        if (payload?.source !== source || payload.docId !== state().docId
            || !Array.isArray(payload.pages)) return;
        setImages((current) => {
          const next = { ...current };
          for (const image of payload.pages) {
            if (Number.isSafeInteger(image.page) && image.page >= 1 && image.page <= state().count) {
              if (image.dataURL === null) delete next[image.page];
              else if (typeof image.dataURL === 'string' && image.dataURL.startsWith('data:image/')) {
                next[image.page] = image;
              }
            }
          }
          return next;
        });
      }));
      setChild(await window.__TAURI__.core.invoke('current_window_label'));
      await emit('thumbnail-view:ready', {});
      heartbeat = setInterval(async () => {
        const W = window.__TAURI__?.webviewWindow?.WebviewWindow;
        try { if (!await W?.getByLabel(source)) { setConnected(false); void close(); } }
        catch { /* a transient native query should not close this view */ }
      }, 4000);
    } catch { setConnected(false); }
  });
  onCleanup(() => {
    observer?.disconnect();
    if (heartbeat) clearInterval(heartbeat);
    for (const stop of unlisten) stop();
    if (child()) void emit('thumbnail-view:closed', {});
  });
  window.addEventListener('beforeunload', () => {
    if (child()) void emit('thumbnail-view:closed', {});
  }, { once: true });

  return (
    <main class="detached-thumbnails">
      <header class="detached-thumbnails-header">
        <div><strong>{t('leftPanel.thumbnails')}</strong><small>{state().title || 'No drawing open'}</small></div>
        <button type="button" onClick={focusDrawing} disabled={!connected()} title="Focus drawing window">Drawing</button>
      </header>
      <Show when={connected()} fallback={<p class="detached-thumbnails-empty">The drawing window is unavailable. Close this view and reopen it from a drawing.</p>}>
        <Show when={state().count} fallback={<p class="detached-thumbnails-empty">Open a PDF drawing to see its pages here.</p>}>
          <div class="detached-thumbnails-list" ref={viewport} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            role="listbox" aria-label={t('leftPanel.thumbnails')}>
            <div style={{ height: `${(range().start - 1) * ROW_HEIGHT}px` }} aria-hidden="true" />
            <For each={pages()}>{(page) => (
              <button type="button" class="detached-thumbnail"
                classList={{ active: state().activePage === page }}
                style={{ height: `${ROW_HEIGHT}px` }} role="option"
                aria-selected={state().activePage === page} aria-label={`Page ${page}`}
                onClick={() => void emit('thumbnail-view:goto', { docId: state().docId, page })}>
                <Show when={images()[page]?.dataURL} fallback={<span class="detached-thumbnail-loading">Loading page {page}…</span>}>
                  <img src={images()[page].dataURL} alt="" draggable="false" />
                </Show>
                <span class="detached-thumbnail-number">{page}</span>
              </button>
            )}</For>
            <div style={{ height: `${(state().count - range().end) * ROW_HEIGHT}px` }} aria-hidden="true" />
          </div>
        </Show>
      </Show>
      <footer class="detached-thumbnails-footer">
        <span>{state().count ? `Page ${state().activePage} of ${state().count}` : 'No pages'}</span>
        <button type="button" onClick={close}>Close</button>
      </footer>
    </main>
  );
}
