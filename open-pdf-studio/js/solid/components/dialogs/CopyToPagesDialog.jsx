import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument, imageCache } from '../../../core/state.js';
import { parsePageRange } from '../../../annotations/page-range.js';
import { copiesForPages } from '../../../annotations/copy-to-pages.js';
import { recordBulkAdd } from '../../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';
import { generateImageId } from '../../../utils/helpers.js';

/**
 * Copy to pages… : the selected markups, at the same place, on each page in
 * the range except the page they already occupy. One undo step.
 * data: { annotationIds }.
 */
export default function CopyToPagesDialog(props) {
  const { t } = useTranslation('common');
  const close = () => closeDialog('copy-to-pages');
  const [range, setRange] = createSignal('');
  const [error, setError] = createSignal('');

  const copy = () => {
    const doc = getActiveDocument();
    const pageCount = doc?.pdfDoc?.numPages || 0;
    if (!doc || !pageCount) { setError(t('copyToPages.none')); return; }
    const parsed = parsePageRange(range(), pageCount);
    if (parsed.error) { setError(t(`copyToPages.${parsed.error}`)); return; }
    const wanted = new Set(Array.isArray(props.data?.annotationIds) ? props.data.annotationIds : []);
    const sources = (doc.annotations || []).filter((ann) => wanted.has(ann.id));
    if (!sources.length) { setError(t('copyToPages.none')); return; }
    const copies = copiesForPages(sources, parsed.pages, {
      afterEach(source, clone) {
        if (clone.type !== 'image' && clone.type !== 'signature') return;
        const image = imageCache.get(source.imageId);
        if (!image) return;
        const imageId = generateImageId();
        imageCache.set(imageId, image);
        clone.imageId = imageId;
      },
    });
    if (!copies.length) { setError(t('copyToPages.none')); return; }
    for (const ann of copies) doc.annotations.push(ann);
    recordBulkAdd(copies);
    doc.selectedAnnotations = copies;
    doc.selectedAnnotation = copies[0];
    if (doc.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
    try { updateStatusMessage(t('copyToPages.done', { count: copies.length })); } catch { /* optional */ }
    close();
  };

  return (
    <Dialog title={t('copyToPages.title')} dialogClass="copy-to-pages-dialog" onClose={close}
      footer={<div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
        <button type="button" class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
          onClick={close}>{t('cancel')}</button>
        <button type="button" class="ai-plan-btn" id="copy-to-pages-ok" style="width:auto;padding:5px 16px"
          onClick={copy}>{t('copyToPages.ok')}</button>
      </div>}>
      <form style="min-width:320px" onSubmit={(e) => { e.preventDefault(); copy(); }}>
        <p style="margin:0 0 8px;max-width:360px">{t('copyToPages.hint')}</p>
        <label class="ai-form-field">{t('copyToPages.range')}
          <input id="copy-to-pages-range" class="ribbon-input" spellcheck={false} autofocus
            placeholder={t('copyToPages.placeholder')} value={range()}
            onInput={(e) => { setRange(e.currentTarget.value); setError(''); }} />
        </label>
        <Show when={error()}><p class="mts-message error" role="alert">{error()}</p></Show>
      </form>
    </Dialog>
  );
}
