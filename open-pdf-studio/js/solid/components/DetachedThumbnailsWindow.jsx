// The floating thumbnail tile: a compact tool window beside the drawing (or on
// another monitor) for picking sheets quickly. Its drawing window renders the
// pages; this view only shows what it is sent and asks for the visible pages.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { lucide } from '../data/lucideIcons.js';
import { TILE_GAP, TILE_MAX_PAGES, TILE_PAD, filterPages, gridMetrics, pageCaption, scrollToShow, stepIndex, visibleSlice } from '../../ui/panels/thumbnail-tile-grid.js';
import { TILE_MEMORY_KEY, monitorAreas, tileMemory } from '../../ui/panels/thumbnail-tile-placement.js';
import './detached-thumbnails.css';

const SIZE_KEY = 'oculithDraw.thumbnailTile.size';
const SIZES = [['s', 'Small thumbnails'], ['m', 'Medium thumbnails'], ['l', 'Large thumbnails']];
const source = new URLSearchParams(location.search).get('source') || '';
const validSource = /^(main|pdf-[a-zA-Z0-9-]+)$/.test(source);

/** Scale a cached thumbnail to fill its box (the cache renders small pages). */
function fitImage(image, boxWidth, boxHeight) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  if (!(width > 0 && height > 0)) return undefined;
  const fit = Math.min(boxWidth / width, boxHeight / height);
  return { width: `${Math.max(1, Math.floor(width * fit))}px`, height: `${Math.max(1, Math.floor(height * fit))}px` };
}

function readSize() {
  try {
    const saved = globalThis.localStorage?.getItem(SIZE_KEY);
    return ['s', 'm', 'l'].includes(saved) ? saved : 'm';
  } catch { return 'm'; }
}

export default function DetachedThumbnailsWindow() {
  const [child, setChild] = createSignal('');
  const [state, setState] = createSignal({ docId: '', count: 0, activePage: 0, title: '' });
  const [info, setInfo] = createSignal({ docId: '', list: [] });
  const [images, setImages] = createSignal({});
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportSize, setViewportSize] = createSignal({ width: 280, height: 500 });
  const [connected, setConnected] = createSignal(true);
  const [query, setQuery] = createSignal('');
  const [size, setSize] = createSignal(readSize());
  const [cursor, setCursor] = createSignal(0);
  let viewport;
  let filterInput;
  let heartbeat;
  let saveTimer;
  const unlisten = [];
  // The grid appears and disappears with the document; measure whichever is current.
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (viewport?.isConnected) setViewportSize({ width: viewport.clientWidth || 280, height: viewport.clientHeight || 500 });
  }) : null;
  const gridRef = (element) => {
    viewport = element;
    observer?.observe(element);
  };

  const infoFor = (page) => {
    const current = info();
    if (current.docId !== state().docId) return null;
    const entry = current.list[page - 1];
    return entry ? { label: entry[0], sheet: entry[1], title: entry[2] } : null;
  };
  const filtered = createMemo(() => filterPages(state().count, infoFor, query()));
  const metrics = createMemo(() => gridMetrics(viewportSize().width, size()));
  const slice = createMemo(() => visibleSlice(filtered().length, metrics(), scrollTop(), viewportSize().height),
    undefined, { equals: (a, b) => a?.start === b?.start && a?.end === b?.end && a?.top === b?.top && a?.bottom === b?.bottom });
  const pages = createMemo(() => filtered().slice(slice().start, slice().end));

  const emit = (name, payload) => Promise.resolve(window.__TAURI__?.event?.emitTo?.(source, name,
    { child: child(), ...payload })).catch(() => setConnected(false));
  const close = () => window.__TAURI__?.window?.getCurrentWindow?.()?.close?.();
  const dock = async () => {
    await emit('thumbnail-view:dock', {});
    void close();
  };
  const go = (page, focusDrawing) => {
    if (!page || !state().docId) return;
    setCursor(page);
    void emit('thumbnail-view:goto', { docId: state().docId, page, focus: !!focusDrawing });
  };
  const chooseSize = (next) => {
    setSize(next);
    try { globalThis.localStorage?.setItem(SIZE_KEY, next); } catch { /* not remembered */ }
  };
  const reveal = (page) => {
    const index = filtered().indexOf(page);
    if (!viewport || index < 0) return;
    const top = scrollToShow(index, metrics(), viewport.scrollTop, viewport.clientHeight);
    if (top !== viewport.scrollTop) viewport.scrollTop = top;
    setScrollTop(viewport.scrollTop);
  };

  // Keep the keyboard cursor on a page the filter shows.
  createEffect(() => {
    const list = filtered();
    if (list.length && !list.includes(cursor())) {
      const active = state().activePage;
      setCursor(list.includes(active) ? active : list[0]);
    }
  });
  createEffect(() => { query(); if (viewport) { viewport.scrollTop = 0; setScrollTop(0); } });
  createEffect(() => { size(); queueMicrotask(() => reveal(cursor())); });

  createEffect(() => {
    const wanted = pages();
    const docId = state().docId;
    if (!child() || !docId || !wanted.length) return;
    const keep = new Set(wanted);
    setImages((current) => Object.fromEntries(Object.entries(current).filter(([page]) => keep.has(Number(page)))));
    void emit('thumbnail-view:range', { docId, pages: wanted.slice(0, TILE_MAX_PAGES) });
  });

  const onKeyDown = (event) => {
    const inFilter = event.target === filterInput;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (inFilter && query()) setQuery('');
      else void close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      filterInput?.focus();
      filterInput?.select();
      return;
    }
    if (event.target.closest?.('.thumb-tile-bar, .thumb-tile-sizes')) return;
    const list = filtered();
    if (event.key === 'Enter' || (!inFilter && event.key === ' ')) {
      event.preventDefault();
      go(list.includes(cursor()) ? cursor() : list[0], false);
      return;
    }
    // Left/Right/Home/End stay with the text box while typing a filter.
    if (inFilter && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) return;
    const next = stepIndex(list.indexOf(cursor()), event.key, metrics().columns, list.length);
    if (next === null) return;
    event.preventDefault();
    setCursor(list[next]);
    reveal(list[next]);
  };

  const rememberGeometry = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const api = window.__TAURI__?.window;
      const win = api?.getCurrentWindow?.();
      if (!win) return;
      try {
        const [position, outer, monitor] = await Promise.all([
          win.outerPosition(), win.outerSize(), api.currentMonitor?.() ?? null,
        ]);
        const memory = tileMemory({ x: position.x, y: position.y, width: outer.width, height: outer.height },
          monitorAreas(monitor ? [monitor] : [])[0] || null);
        if (memory) globalThis.localStorage?.setItem(TILE_MEMORY_KEY, JSON.stringify(memory));
      } catch { /* the next move or resize tries again */ }
    }, 400);
  };

  onMount(async () => {
    if (!validSource || !window.__TAURI__?.event?.listen) { setConnected(false); return; }
    try {
      unlisten.push(await window.__TAURI__.event.listen('thumbnail-view:state', (event) => {
        const next = event.payload;
        if (next?.source !== source || !Number.isSafeInteger(next.count) || next.count < 0) return;
        const previous = state();
        const newDocument = next.docId !== previous.docId;
        if (newDocument) setImages({});
        setState({ docId: next.docId, count: next.count,
          activePage: next.activePage, title: next.title || '' });
        setConnected(true);
        if (newDocument || next.activePage !== previous.activePage) {
          if (next.activePage > 0) setCursor(next.activePage);
          queueMicrotask(() => reveal(next.activePage));
        }
      }));
      unlisten.push(await window.__TAURI__.event.listen('thumbnail-view:info', (event) => {
        const payload = event.payload;
        if (payload?.source !== source || typeof payload.docId !== 'string' || !Array.isArray(payload.info)) return;
        const list = payload.info.map((entry) => (Array.isArray(entry)
          ? entry.slice(0, 3).map((value) => (typeof value === 'string' ? value.slice(0, 120) : '')) : ['', '', '']));
        setInfo({ docId: payload.docId, list });
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
      const W = window.__TAURI__?.webviewWindow?.WebviewWindow;
      const win = window.__TAURI__?.window?.getCurrentWindow?.();
      if (win?.onMoved) unlisten.push(await win.onMoved(rememberGeometry));
      if (win?.onResized) unlisten.push(await win.onResized(rememberGeometry));
      // Close with the drawing window (an owned window already does on Windows).
      const drawing = await W?.getByLabel(source);
      if (drawing?.once) unlisten.push(await drawing.once('tauri://destroyed', () => void close()));
      heartbeat = setInterval(async () => {
        try { if (!await W?.getByLabel(source)) { setConnected(false); void close(); } }
        catch { /* a transient native query should not close this view */ }
      }, 4000);
    } catch { setConnected(false); }
    filterInput?.focus();
  });
  onCleanup(() => {
    observer?.disconnect();
    clearTimeout(saveTimer);
    if (heartbeat) clearInterval(heartbeat);
    for (const stop of unlisten) stop();
    if (child()) void emit('thumbnail-view:closed', {});
  });
  window.addEventListener('beforeunload', () => {
    if (child()) void emit('thumbnail-view:closed', {});
  }, { once: true });

  const countText = () => {
    const count = state().count;
    if (!count) return 'No pages';
    if (query()) return `${filtered().length} of ${count} pages`;
    return `Page ${state().activePage} of ${count}`;
  };

  return (
    <main class="thumb-tile" onKeyDown={onKeyDown}>
      <header class="thumb-tile-bar" data-tauri-drag-region>
        <div class="thumb-tile-title" data-tauri-drag-region>
          <strong data-tauri-drag-region>Pages</strong>
          <small data-tauri-drag-region title={state().title}>{state().title || 'No drawing open'}</small>
        </div>
        <button type="button" class="thumb-tile-icon" title="Dock in the side panel" aria-label="Dock in the side panel"
          disabled={!connected()} onClick={dock} innerHTML={lucide('panel-left')} />
        <button type="button" class="thumb-tile-icon thumb-tile-close" title="Close (Esc)" aria-label="Close"
          onClick={close} innerHTML={lucide('x')} />
      </header>
      <div class="thumb-tile-tools">
        <label class="thumb-tile-filter">
          <span innerHTML={lucide('search')} aria-hidden="true" />
          <input ref={filterInput} type="search" placeholder="Filter sheet, title, page" aria-label="Filter pages"
            spellcheck={false} value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <div class="thumb-tile-sizes" role="radiogroup" aria-label="Thumbnail size">
          <For each={SIZES}>{([id, label]) => (
            <button type="button" role="radio" aria-checked={size() === id} title={label} aria-label={label}
              classList={{ active: size() === id }} onClick={() => chooseSize(id)}>{id.toUpperCase()}</button>
          )}</For>
        </div>
      </div>
      <Show when={connected()} fallback={<p class="thumb-tile-empty">The drawing window is unavailable. Close this view and reopen it from a drawing.</p>}>
        <Show when={state().count} fallback={<p class="thumb-tile-empty">Open a PDF drawing to see its pages here.</p>}>
          <Show when={filtered().length} fallback={<p class="thumb-tile-empty">No page matches “{query()}”.</p>}>
            <div class="thumb-tile-grid" ref={gridRef} tabIndex={-1}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              role="listbox" aria-label="Pages" aria-activedescendant={`thumb-tile-${cursor()}`}>
              <div class="thumb-tile-items" style={{
                'padding-top': `${slice().top + TILE_PAD}px`, 'padding-bottom': `${slice().bottom + TILE_PAD}px`,
                'padding-left': `${TILE_PAD}px`, 'padding-right': `${TILE_PAD}px`, gap: `${TILE_GAP}px`,
                'grid-template-columns': `repeat(${metrics().columns}, ${metrics().tileWidth}px)`,
                'grid-auto-rows': `${metrics().rowHeight - TILE_GAP}px`,
              }}>
                <For each={pages()}>{(page) => {
                  const caption = () => pageCaption(page, infoFor(page));
                  return (
                    <button type="button" class="thumb-tile-page" id={`thumb-tile-${page}`} tabIndex={-1}
                      classList={{ active: state().activePage === page, cursor: cursor() === page }}
                      role="option" aria-selected={state().activePage === page}
                      aria-label={`Page ${page}${caption().primary !== String(page) ? `, ${caption().primary}` : ''}${caption().secondary ? `, ${caption().secondary}` : ''}`}
                      title={[caption().primary, caption().secondary].filter(Boolean).join(' · ')}
                      onClick={() => go(page, true)}>
                      <span class="thumb-tile-image" style={{ height: `${metrics().imageHeight}px` }}>
                        <Show when={images()[page]?.dataURL} fallback={<span class="thumb-tile-loading" />}>
                          <img src={images()[page].dataURL} alt="" draggable="false"
                            style={fitImage(images()[page], metrics().tileWidth - 8, metrics().imageHeight)} />
                        </Show>
                      </span>
                      <span class="thumb-tile-caption">
                        <span class="thumb-tile-primary">{caption().primary}</span>
                        <span class="thumb-tile-secondary">{caption().secondary || (caption().primary !== String(page) ? `Page ${page}` : '')}</span>
                      </span>
                    </button>
                  );
                }}</For>
              </div>
            </div>
          </Show>
        </Show>
      </Show>
      <footer class="thumb-tile-footer">
        <span>{countText()}</span>
      </footer>
    </main>
  );
}
