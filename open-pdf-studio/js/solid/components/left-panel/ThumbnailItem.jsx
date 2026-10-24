import { Show } from 'solid-js';
import {
  activePage, thumbnailData, draggedPage, setDraggedPage, dropTarget, setDropTarget, placeholderSize,
  selectedPages, selectPage, togglePageSelection, selectPageRange, isPageSelected
} from '../../stores/panels/thumbnailStore.js';
import { showThumbnailMenu } from '../../stores/contextMenuStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ThumbnailItem(props) {
  const { t } = useTranslation('common');
  const isActive = () => activePage() === props.pageNum;
  const imageData = () => thumbnailData[String(props.pageNum)];
  const isDragging = () => draggedPage() === props.pageNum;
  const drop = () => dropTarget();
  const isDropBefore = () => drop()?.page === props.pageNum && drop()?.position === 'before';
  const isDropAfter = () => drop()?.page === props.pageNum && drop()?.position === 'after';
  const isSelected = () => { selectedPages(); return isPageSelected(props.pageNum); };

  const size = () => placeholderSize();

  const handleClick = (e) => {
    if (e.ctrlKey && e.shiftKey) {
      selectPageRange(props.pageNum, true);
    } else if (e.shiftKey) {
      selectPageRange(props.pageNum, false);
    } else if (e.ctrlKey) {
      togglePageSelection(props.pageNum);
    } else {
      selectPage(props.pageNum);
      props.onNavigate(props.pageNum);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicked page is not in selection, select it alone
    if (!isPageSelected(props.pageNum)) {
      selectPage(props.pageNum);
    }
    const rect = e.currentTarget.getBoundingClientRect();
    showThumbnailMenu(e.button === -1 ? rect.left + 8 : e.clientX,
      e.button === -1 ? rect.top + 8 : e.clientY, props.pageNum);
  };

  return (
    <div
      class="thumbnail-item"
      style={props.rowHeight ? { height: `${props.rowHeight - 4}px`, 'box-sizing': 'border-box', 'flex-shrink': '0' } : undefined}
      role="option"
      tabIndex={isActive() ? 0 : -1}
      aria-label={`${t('page')} ${props.pageNum}`}
      aria-selected={isSelected()}
      aria-current={isActive() ? 'page' : undefined}
      classList={{
        active: isActive(),
        selected: isSelected(),
        dragging: isDragging(),
        'drop-before': isDropBefore(),
        'drop-after': isDropAfter()
      }}
      data-page={props.pageNum}
      draggable={true}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDragStart={(e) => {
        setDraggedPage(props.pageNum);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(props.pageNum));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedPage() === props.pageNum) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        setDropTarget({ page: props.pageNum, position: e.clientY < midY ? 'before' : 'after' });
      }}
      onDragLeave={() => {
        if (dropTarget()?.page === props.pageNum) setDropTarget(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropTarget(null);
        if (draggedPage() !== null && draggedPage() !== props.pageNum) {
          const rect = e.currentTarget.getBoundingClientRect();
          const dropBefore = e.clientY < (rect.top + rect.height / 2);
          props.onReorder(draggedPage(), props.pageNum, dropBefore);
        }
        setDraggedPage(null);
      }}
      onDragEnd={() => {
        setDraggedPage(null);
        setDropTarget(null);
      }}
    >
      <Show when={imageData()} fallback={
        <div class="thumbnail-canvas thumbnail-loading" style={{ width: size().width + 'px', 'aspect-ratio': `${size().width} / ${size().height}` }}>
          <div class="thumbnail-spinner" />
        </div>
      }>
        <img class="thumbnail-canvas" src={imageData().dataURL} alt="" style={{ width: imageData().width + 'px' }} />
      </Show>
      <div class="thumbnail-label">{props.pageNum}</div>
    </div>
  );
}
