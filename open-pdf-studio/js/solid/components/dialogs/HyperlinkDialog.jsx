import { createSignal, createMemo, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { normalizeHyperlinkUrl } from '../../../pdf/saver/hyperlink-dict.js';

/**
 * Target of a new hyperlink markup (Hyperlink tool, Shift+H): a web address
 * or a page of this document.
 *
 * props.data:
 *   - onOk({ url } | { page }): called with the chosen target
 *   - initial: { url?, page? } to edit an existing link
 */
export default function HyperlinkDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const data = props.data || {};
  const pageCount = getActiveDocument()?.pdfDoc?.numPages || 1;
  const [kind, setKind] = createSignal(data.initial?.page ? 'page' : 'url');
  const [url, setUrl] = createSignal(data.initial?.url || '');
  const [page, setPage] = createSignal(String(data.initial?.page || getActiveDocument()?.currentPage || 1));

  const target = createMemo(() => {
    if (kind() === 'url') {
      const u = normalizeHyperlinkUrl(url());
      return u ? { url: u } : null;
    }
    const p = Number(page());
    return Number.isInteger(p) && p >= 1 && p <= pageCount ? { page: p } : null;
  });

  const close = () => closeDialog('hyperlink');
  const ok = () => {
    const chosen = target();
    if (!chosen) return;
    close();
    data.onOk?.(chosen);
  };

  return (
    <Dialog
      title={t('hyperlink.title')}
      dialogClass="hyperlink-dialog"
      onClose={close}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={close}>{tCommon('cancel') || 'Cancel'}</button>
          <button class="ai-plan-btn" id="hyperlink-ok" style="width:auto;padding:5px 16px"
            disabled={!target()} onClick={ok}>{tCommon('ok') || 'OK'}</button>
        </div>
      }
    >
      <form style="min-width:320px" onSubmit={(e) => { e.preventDefault(); ok(); }}>
        <div class="ai-form-field">
          <label>
            <input type="radio" name="hyperlink-kind" value="url" checked={kind() === 'url'}
              onChange={() => setKind('url')} /> {t('hyperlink.webAddress')}
          </label>
          <input type="text" class="ribbon-input" id="hyperlink-url" value={url()}
            placeholder="https://"
            disabled={kind() !== 'url'}
            onInput={(e) => setUrl(e.currentTarget.value)}
            style="width:100%;box-sizing:border-box" autofocus />
          <Show when={kind() === 'url' && url().trim() && !target()}>
            <div style="color:var(--theme-error,#dc2626);padding-top:2px">{t('hyperlink.invalidUrl')}</div>
          </Show>
        </div>
        <div class="ai-form-field">
          <label>
            <input type="radio" name="hyperlink-kind" value="page" checked={kind() === 'page'}
              onChange={() => setKind('page')} /> {t('hyperlink.pageInDocument', { count: pageCount })}
          </label>
          <input type="number" class="ribbon-input" id="hyperlink-page" min="1" max={pageCount} step="1"
            value={page()} disabled={kind() !== 'page'}
            onInput={(e) => setPage(e.currentTarget.value)}
            style="width:90px;box-sizing:border-box" />
        </div>
      </form>
    </Dialog>
  );
}
