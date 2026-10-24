import { createSignal, createMemo, Show, For, onMount, onCleanup } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { capturePhotos, photoDateText, formatBytes } from '../../../annotations/capture.js';
import { captureRev, findAnnotation, canEditCapture, removePhoto, savePhotoAs } from '../../../annotations/capture-actions.js';
import { getAnnotationDisplayName } from '../../../utils/helpers.js';

/**
 * Photo viewer for a markup's capture photos (movable, stays open on an
 * outside click): previous / next (arrow keys), file name, capture date.
 *
 * props.data: { annotationId, index? }
 */
export default function CaptureViewerDialog(props) {
  const { t } = useTranslation('common');
  const data = props.data || {};
  const [index, setIndex] = createSignal(Math.max(0, Number(data.index) || 0));

  const ann = createMemo(() => { captureRev(); return findAnnotation(data.annotationId); });
  const photos = createMemo(() => { captureRev(); return ann() ? capturePhotos(ann()) : []; });
  const current = createMemo(() => {
    const list = photos();
    if (!list.length) return null;
    return list[Math.min(index(), list.length - 1)];
  });
  const at = () => Math.min(index(), Math.max(0, photos().length - 1));
  const close = () => closeDialog('capture-viewer');
  const go = (delta) => {
    const n = photos().length;
    if (n) setIndex((at() + delta + n) % n);
  };

  const onKey = (e) => {
    if (e.target?.closest?.('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(1); }
  };
  onMount(() => window.addEventListener('keydown', onKey, true));
  onCleanup(() => window.removeEventListener('keydown', onKey, true));

  const remove = () => {
    const photo = current();
    if (!photo || !ann()) return;
    removePhoto(ann(), photo.id);
    if (!capturePhotos(ann()).length) close();
  };

  const title = () => {
    const a = ann();
    const label = a ? (a.subject || getAnnotationDisplayName(a)) : '';
    return label ? `${t('capture.viewerTitle')}: ${label}` : t('capture.viewerTitle');
  };

  return (
    <Dialog
      title={title()}
      dialogClass="capture-viewer-dialog"
      onClose={close}
      footer={
        <div class="capture-footer">
          <button class="capture-btn" id="capture-prev" disabled={photos().length < 2} onClick={() => go(-1)}>
            ‹ {t('capture.previous')}</button>
          <button class="capture-btn" id="capture-next" disabled={photos().length < 2} onClick={() => go(1)}>
            {t('capture.next')} ›</button>
          <span class="spacer"></span>
          <button class="capture-btn" id="capture-save" disabled={!current()} onClick={() => savePhotoAs(current())}>
            {t('capture.savePhoto')}</button>
          <button class="capture-btn danger" id="capture-remove" disabled={!current() || !canEditCapture(ann())}
            onClick={remove}>{t('capture.removePhoto')}</button>
          <button class="capture-btn" onClick={close}>{t('close')}</button>
        </div>
      }
    >
      <div class="capture-viewer">
        <div class="capture-viewer-stage">
          <Show when={current()} fallback={<span>{t('capture.noPhotos')}</span>}>
            <img id="capture-viewer-image" src={current().dataUrl} alt={current().name} />
          </Show>
        </div>
        <Show when={current()}>
          <div class="capture-viewer-meta">
            <span class="capture-viewer-name" id="capture-viewer-name" title={current().name}>{current().name}</span>
            <span id="capture-viewer-date">{photoDateText(current().date) || t('capture.noDate')}</span>
            <Show when={current().width && current().height}>
              <span>{t('capture.dimensions', { width: current().width, height: current().height })}</span>
            </Show>
            <span>{formatBytes(current().size)}</span>
            <span class="capture-viewer-counter" id="capture-viewer-counter">
              {t('capture.counter', { index: at() + 1, count: photos().length })}</span>
          </div>
          <Show when={photos().length > 1}>
            <div class="capture-viewer-strip">
              <For each={photos()}>{(photo, i) => (
                <button type="button" class={i() === at() ? 'active' : ''} title={photo.name}
                  aria-label={photo.name} onClick={() => setIndex(i())}>
                  <img src={photo.dataUrl} alt="" />
                </button>
              )}</For>
            </div>
          </Show>
        </Show>
      </div>
    </Dialog>
  );
}
