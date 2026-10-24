import { For, onMount, onCleanup, createEffect, createMemo, createSignal } from 'solid-js';
import { pageCount, selectPage, selectPageRange, togglePageSelection, selectAllPages, clearPageSelection, getSelectedPagesArray, formatPageRangeString, setContainerRef, setThumbnailScrollToPage, isPageSelected, placeholderSize, thumbnailData } from '../../../stores/panels/thumbnailStore.js';
import { thumbnailRowHeights, thumbnailWindow } from '../../../../pdf/thumbnail-window.js';
import { activeTab, panelShown } from '../../../stores/leftPanelStore.js';
import { showThumbnailMenu } from '../../../stores/contextMenuStore.js';
import ThumbnailItem from '../ThumbnailItem.jsx';
import { useTranslation } from '../../../../i18n/useTranslation.js';

export default function ThumbnailsPanel() {
  const { t } = useTranslation('properties');
  let container;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [panelSize, setPanelSize] = createSignal({ width: 180, height: 600 });
  const virtual = () => pageCount() >= 80;
  const rowHeights = createMemo(() => thumbnailRowHeights(
    pageCount(), Math.max(1, panelSize().width - 20),
    (page) => thumbnailData[String(page)], placeholderSize(),
  ));
  const visible = createMemo(() => thumbnailWindow(rowHeights(), scrollTop(), panelSize().height));

  const scrollToPage = (pageNum, focus = false) => {
    if (!container || pageNum < 1 || pageNum > pageCount()) return false;
    if (virtual()) {
      const geometry = visible();
      const top = geometry.offsets[pageNum - 1];
      const bottom = geometry.offsets[pageNum];
      if (top < container.scrollTop) container.scrollTop = top;
      else if (bottom > container.scrollTop + container.clientHeight) {
        container.scrollTop = bottom - container.clientHeight;
      }
      setScrollTop(container.scrollTop);
    }
    requestAnimationFrame(() => {
      const row = container?.querySelector(`.thumbnail-item[data-page="${pageNum}"]`);
      if (!virtual()) row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (focus) row?.focus();
    });
    return true;
  };

  onMount(() => {
    if (!container) return;
    const measure = () => setPanelSize({ width: container.clientWidth, height: container.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    setThumbnailScrollToPage(scrollToPage);
    onCleanup(() => {
      observer.disconnect();
      setThumbnailScrollToPage(null);
    });
  });

  // Thumbnails that markup edits made stale while this panel was hidden
  // (left-panel.js invalidateThumbnails) are redone when it comes up.
  createEffect(() => {
    if (panelShown('thumbnails')) {
      import('../../../../ui/panels/left-panel.js').then(m => m.flushDeferredThumbnails()).catch(() => {});
    }
  });

  const pages = () => {
    const count = pageCount();
    if (!virtual()) return Array.from({ length: count }, (_, i) => i + 1);
    const { start, end } = visible();
    return Array.from({ length: end - start }, (_, i) => start + i + 1);
  };

  const handleNavigate = (pageNum) => {
    import('../../../../pdf/renderer.js').then(m => m.goToPage(pageNum));
  };

  const handleReorder = async (fromPage, toPage, dropBefore) => {
    const { reorderPages } = await import('../../../../pdf/page-manager.js');
    const numPages = pageCount();
    const currentOrder = Array.from({ length: numPages }, (_, i) => i + 1);
    const fromIdx = currentOrder.indexOf(fromPage);
    currentOrder.splice(fromIdx, 1);
    let toIdx = currentOrder.indexOf(toPage);
    if (!dropBefore) toIdx++;
    currentOrder.splice(toIdx, 0, fromPage);
    await reorderPages(currentOrder);
  };

  const handleKeyDown = async (e) => {
    const item = e.target.closest?.('.thumbnail-item[data-page]');
    if (!item && e.target !== e.currentTarget) return;
    const page = item ? Number(item.dataset.page) : null;
    const move = { ArrowUp: -1, ArrowDown: 1, Home: 1 - page, End: pageCount() - page }[e.key];
    if (page && move !== undefined) {
      e.preventDefault();
      const nextPage = Math.max(1, Math.min(pageCount(), page + move));
      scrollToPage(nextPage, true);
      if (e.shiftKey) selectPageRange(nextPage, e.ctrlKey || e.metaKey);
      else if (!e.ctrlKey && !e.metaKey) {
        selectPage(nextPage);
        handleNavigate(nextPage);
      }
    } else if (page && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      if (e.shiftKey) selectPageRange(page, e.ctrlKey || e.metaKey);
      else if (e.ctrlKey || e.metaKey) togglePageSelection(page);
      else {
        selectPage(page);
        handleNavigate(page);
      }
    } else if (page && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      e.preventDefault();
      if (!isPageSelected(page)) selectPage(page);
      const rect = item.getBoundingClientRect();
      showThumbnailMenu(rect.left + 8, rect.top + 8, page);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAllPages();
    } else if (e.key === 'Escape') {
      clearPageSelection();
    } else if (e.key === 'Delete') {
      const selected = getSelectedPagesArray();
      if (selected.length > 0 && selected.length < pageCount()) {
        const rangeStr = formatPageRangeString(selected);
        const { openDialog } = await import('../../../stores/dialogStore.js');
        openDialog('delete-pages', {
          totalPages: pageCount(),
          currentPage: selected[0],
          pageRange: rangeStr
        });
      }
    }
  };

  return (
    <div class={`left-panel-content${activeTab() === 'thumbnails' ? ' active' : ''}`} id="thumbnails-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.thumbnails')}</span>
      </div>
      <div class="thumbnails-container" id="thumbnails-container" ref={(el) => { container = el; setContainerRef(el); }} tabIndex={pageCount() ? -1 : 0} onKeyDown={handleKeyDown} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div class="thumbnail-pages" classList={{ virtual: virtual() }} role="listbox" aria-label={t('leftPanel.thumbnails')} aria-multiselectable="true">
          {virtual() && <div class="thumbnail-spacer" style={{ height: `${visible().top}px` }} aria-hidden="true" />}
          <For each={pages()}>
            {(pageNum) => (
              <ThumbnailItem
                pageNum={pageNum}
                rowHeight={virtual() ? rowHeights()[pageNum - 1] : undefined}
                onNavigate={handleNavigate}
                onReorder={handleReorder}
              />
            )}
          </For>
          {virtual() && <div class="thumbnail-spacer" style={{ height: `${visible().bottom}px` }} aria-hidden="true" />}
        </div>
        {/* Trailing "+" tile: append a new page (A4/A3/… chooser) to the PDF. */}
        <button
          type="button"
          class="thumbnail-item thumbnail-add-page"
          title={t('leftPanel.addPage') || 'Pagina toevoegen'}
          aria-label={t('leftPanel.addPage') || 'Add page'}
          onClick={async () => {
            // Jump to the last page first so the insert dialog's "after
            // current page" default appends at the END of the document.
            const m = await import('../../../../pdf/renderer.js');
            await m.goToPage(pageCount());
            const { showInsertPageDialog } = await import('../../../../ui/chrome/dialogs.js');
            showInsertPageDialog();
          }}
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'min-height': '80px',
            border: '1px dashed var(--theme-border, #999)',
            color: 'var(--theme-text, #666)',
            'font-size': '28px',
            cursor: 'pointer',
            'user-select': 'none',
            width: '100%',
          }}
        >+</button>
      </div>
    </div>
  );
}
