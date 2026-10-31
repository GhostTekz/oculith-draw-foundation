import { createMemo, createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { applyPageScale } from '../../../annotations/measurement.js';
import { voegViewportsToe, standaardViewportNaam } from '../../../annotations/named-viewports.js';
import { formatRatio, ratioFromPixelsPerUnit } from '../../../annotations/scale-entry.js';
import {
  applyRows, rejectRows, reviewRows, rowScale, sameNoteRows, scanAllPages, scanPageScales,
} from '../../../annotations/scale-proposals.js';
import { beginUndoTransaction, endUndoTransaction } from '../../../core/undo-manager.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Review scale proposals: the scales read from the sheets' title blocks,
// view titles and graphic scales. Nothing is applied until the user
// confirms a row; until then the page keeps "Scale not set".
//
// data.pageNum: review that page (from the status bar chip), with "Apply to
// all sheets with the same note". Without it: every page that was read,
// with "Detect scales for all pages".
export default function ScaleReviewDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const data = props.data || {};
  const pageNum = Number(data.pageNum) || null;
  const doc = getActiveDocument();

  const [version, setVersion] = createSignal(0);
  const [progress, setProgress] = createSignal(null);
  const [error, setError] = createSignal('');
  const [typed, setTyped] = createSignal({});
  const [unchecked, setUnchecked] = createSignal(new Set());
  const [checkedExtra, setCheckedExtra] = createSignal(new Set());
  let cancelled = false;

  const rows = createMemo(() => {
    version();
    const d = getActiveDocument();
    return d === doc ? reviewRows(d, pageNum ? [pageNum] : undefined) : [];
  });
  const pending = () => rows().filter(r => r.status === 'pending');
  // Checked by default: a pending proposal that is likely right and does
  // not replace a scale the page already has.
  const defaultChecked = (r) => r.confidence >= 0.6 && !r.currentScale;
  const isChecked = (r) => r.status === 'pending' && (unchecked().has(r.id) ? false : defaultChecked(r) || checkedExtra().has(r.id));
  const toggle = (r, on) => {
    const off = new Set(unchecked());
    const extra = new Set(checkedExtra());
    if (on) { off.delete(r.id); extra.add(r.id); } else { off.add(r.id); extra.delete(r.id); }
    setUnchecked(off);
    setCheckedExtra(extra);
  };
  const selected = () => pending().filter(isChecked);
  const refresh = () => setVersion(v => v + 1);

  const sourceName = (key) => t(`scaleReview.sources.${key}`);
  const typedText = (r) => typed()[r.id] ?? r.scaleText;
  const rowValid = (r) => !!rowScale(r, typedText(r));

  if (pageNum && doc && !doc.scaleProposals?.[pageNum]) {
    scanPageScales(doc, pageNum).then(refresh).catch(() => {});
  }

  async function detectAll() {
    const d = getActiveDocument();
    if (!d || d !== doc) return;
    cancelled = false;
    setProgress({ done: 0, total: Number(d.pdfDoc?.numPages) || 0 });
    try {
      await scanAllPages(d, { rescan: true, cancelled: () => cancelled,
        onProgress: (done, total) => setProgress({ done, total }) });
    } finally {
      setProgress(null);
      refresh();
    }
  }

  function apply(picks) {
    const d = getActiveDocument();
    if (!d || d !== doc || !picks.length) return;
    const result = applyRows(d, picks, {
      applyPageScale, addViewports: voegViewportsToe,
      beginUndo: beginUndoTransaction, endUndo: endUndoTransaction,
      label: sourceName,
      viewName: (page) => standaardViewportNaam(d, page, t('scaleReview.viewName')),
    });
    if (result.invalid.length) {
      setError(t('scaleReview.invalid', { text: result.invalid.map(r => typedText(r)).join(', ') }));
    } else {
      setError('');
    }
    refresh();
    if (!result.invalid.length && pageNum) closeDialog('scaleReview');
  }

  const applySelected = () => apply(selected().map(row => ({ row, typed: typedText(row) })));

  function applySameNote() {
    const d = getActiveDocument();
    const base = selected().filter(r => r.target === 'page');
    const seen = new Set();
    const picks = [];
    for (const row of base) {
      for (const r of [row, ...sameNoteRows(d, row)]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        // The same note: what the user typed for this page counts for the others too.
        picks.push({ row: r, typed: typedText(row) });
      }
    }
    // The views on this page come along when checked.
    for (const row of selected().filter(r => r.target === 'view')) picks.push({ row, typed: typedText(row) });
    apply(picks);
  }

  function rejectSelected() {
    const d = getActiveDocument();
    if (!d || d !== doc) return;
    rejectRows(d, selected());
    refresh();
  }

  const close = () => { cancelled = true; closeDialog('scaleReview'); };

  const targetText = (r) => (r.target === 'page' ? t('scaleReview.pageScale') : (r.title || t('scaleReview.viewName')));
  const statusText = (r) => {
    if (r.status === 'info') return t(r.kind === 'nts' ? 'scaleReview.nts' : 'scaleReview.asNoted');
    if (r.status !== 'pending') return t(`scaleReview.status.${r.status}`);
    const notes = [];
    if (r.currentScale) {
      notes.push(t('scaleReview.already', { ratio: formatRatio(ratioFromPixelsPerUnit(r.currentScale.pixelsPerUnit, r.currentScale.unit)) }));
    }
    if (r.bar === 'agrees') notes.push(t('scaleReview.barAgrees'));
    if (r.bar === 'conflicts') notes.push(t('scaleReview.barConflicts'));
    if (r.sheetCheck === 'scaled') notes.push(t('scaleReview.sheetScaled'));
    if (r.sheetCheck === 'unknown') notes.push(t('scaleReview.sheetUnknown'));
    return notes.join('; ') || t('scaleReview.status.pending');
  };

  const footer = (
    <>
      <div class="scale-review-footer-left">
        <button class="pref-btn" disabled={!selected().length} onClick={rejectSelected}>{t('scaleReview.reject')}</button>
      </div>
      <div class="set-scale-footer-right">
        <Show when={pageNum}>
          <button class="pref-btn pref-btn-secondary" disabled={!selected().some(r => r.target === 'page')}
            title={t('scaleReview.applySameNoteTitle')} onClick={applySameNote}>
            {t('scaleReview.applySameNote')}
          </button>
        </Show>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('close')}</button>
        <button class="pref-btn pref-btn-primary" disabled={!selected().length || !selected().every(rowValid)}
          onClick={applySelected}>{tCommon('apply')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={pageNum ? t('scaleReview.titlePage', { page: pageNum }) : t('scaleReview.title')}
      overlayClass="set-scale-overlay"
      dialogClass="scale-review-dialog"
      onClose={close}
      footer={footer}
    >
      <div class="scale-review-bar">
        <button class="set-scale-btn" disabled={!!progress()} onClick={detectAll}>{t('scaleReview.detectAll')}</button>
        <Show when={progress()}>
          <span class="scale-review-progress">{t('scaleReview.reading', { page: progress().done, count: progress().total })}</span>
        </Show>
        <span class="scale-review-hint">{t('scaleReview.hint')}</span>
      </div>
      <div class="scale-review-table-wrap">
        <table class="scale-review-table">
          <thead>
            <tr>
              <th />
              <th>{t('scaleReview.page')}</th>
              <th>{t('scaleReview.target')}</th>
              <th>{t('scaleReview.scale')}</th>
              <th>{t('scaleReview.source')}</th>
              <th>{t('scaleReview.confidence')}</th>
              <th>{t('scaleReview.statusColumn')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(r) => (
                <tr classList={{ 'scale-review-done': r.status !== 'pending', 'scale-review-info': r.status === 'info' }}>
                  <td>
                    <Show when={r.status === 'pending'}>
                      <input type="checkbox" checked={isChecked(r)} aria-label={t('scaleReview.include')}
                        onChange={(e) => toggle(r, e.currentTarget.checked)} />
                    </Show>
                  </td>
                  <td class="scale-review-num">{r.page}</td>
                  <td class="scale-review-target" title={targetText(r)}>{targetText(r)}</td>
                  <td>
                    <Show when={r.status === 'pending'} fallback={<span>{r.ratioText || r.scaleText}</span>}>
                      <input type="text" class="set-scale-input scale-review-scale"
                        classList={{ 'scale-review-invalid': !rowValid(r) }}
                        value={typedText(r)} aria-label={t('scaleReview.scale')}
                        onInput={(e) => setTyped({ ...typed(), [r.id]: e.currentTarget.value })} />
                      <span class="scale-review-ratio">{rowScale(r, typedText(r)) ? formatRatio(rowScale(r, typedText(r)).ratio) : ''}</span>
                    </Show>
                  </td>
                  <td class="scale-review-source" title={r.sourceText}>
                    {r.source ? `${sourceName(r.source)}: ` : ''}{r.sourceText}
                  </td>
                  <td class="scale-review-num">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : ''}</td>
                  <td class="scale-review-status">{statusText(r)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={!rows().length}>
          <div class="scale-review-empty">{progress() ? '' : t('scaleReview.empty')}</div>
        </Show>
      </div>
      <Show when={error()}>
        <div class="set-scale-error">{error()}</div>
      </Show>
    </Dialog>
  );
}
