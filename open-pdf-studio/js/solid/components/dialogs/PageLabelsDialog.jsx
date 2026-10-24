import { createSignal, createMemo, For, Index, Show, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { applyNumbering, LABEL_STYLES, proposeLabelsFromTexts } from '../../../pdf/page-labels.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';

const NAME = 'page-labels';
const STYLE_KEYS = { D: 'styleDecimal', R: 'styleRomanUpper', r: 'styleRomanLower', A: 'styleLettersUpper', a: 'styleLettersLower', '': 'styleNone' };

/**
 * Document > Page Labels (the external editor "Page Labels"): one row per page with its
 * label, a numbering range (prefix, style, start) for a run of pages, and
 * Create from Page Region, which reads the title-block number of every page
 * and shows it here before Apply.
 *
 * props.data:
 *   labels?    labels being edited (kept across the region pick)
 *   original?  labels in the document when the dialog first opened
 *   proposal?  rows from proposeLabelsFromTexts, shown as a Region column
 */
export default function PageLabelsDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const data = props.data || {};
  const doc = getActiveDocument();
  const pageCount = doc?.pdfDoc?.numPages || 0;
  const currentPage = doc?.currentPage || 1;
  const [labels, setLabels] = createSignal(data.labels || []);
  const [original, setOriginal] = createSignal(data.original || data.labels || []);
  const [loading, setLoading] = createSignal(!data.labels);
  const [busy, setBusy] = createSignal(false);
  const proposal = data.proposal || null;

  const [from, setFrom] = createSignal(1);
  const [to, setTo] = createSignal(Math.max(1, pageCount));
  const [style, setStyle] = createSignal('D');
  const [prefix, setPrefix] = createSignal('');
  const [start, setStart] = createSignal(1);

  onMount(async () => {
    if (data.labels) return;
    const { readDocumentLabels } = await import('../../../pdf/page-labels-app.js');
    const read = await readDocumentLabels(doc);
    setLabels(read);
    setOriginal(read);
    setLoading(false);
  });

  const changed = createMemo(() => labels().some((l, i) => (l || '') !== (original()[i] || '')));
  const close = () => closeDialog(NAME);

  const setLabel = (index, value) => setLabels(prev => prev.map((l, i) => (i === index ? value : l)));
  const applyRange = () => {
    const f = Math.trunc(Number(from())), e = Math.trunc(Number(to())), s = Math.trunc(Number(start()));
    if (!(f >= 1 && e >= 1 && f <= pageCount && e <= pageCount && s >= 1)) return;
    setLabels(prev => applyNumbering(prev, { from: f, to: e, style: style(), prefix: prefix(), start: s }));
  };

  const fromRegion = async () => {
    const edited = labels();
    const keep = original();
    close();
    const [{ pickPageRegion }, { regionTextsOfDocument }] = await Promise.all([
      import('../../../tools/region-pick.js'), import('../../../pdf/page-labels-app.js'),
    ]);
    updateStatusMessage(t('pageLabels.dragRegion'), 8000);
    const region = await pickPageRegion();
    if (!region) {
      updateStatusMessage(t('pageLabels.regionCancelled'));
      openDialog(NAME, { labels: edited, original: keep });
      return;
    }
    updateStatusMessage(t('pageLabels.readingRegion'));
    const texts = await regionTextsOfDocument(region, (p, n) => updateStatusMessage(t('pageLabels.readingPage', { page: p, count: n }), 2000));
    if (!texts) { openDialog(NAME, { labels: edited, original: keep }); return; }
    const rows = proposeLabelsFromTexts(texts, edited);
    const found = rows.filter(r => r.found).length;
    updateStatusMessage(t('pageLabels.regionFound', { found, count: rows.length }));
    openDialog(NAME, { labels: rows.map(r => r.label), original: keep, proposal: rows });
  };

  const apply = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const { applyDocumentLabels } = await import('../../../pdf/page-labels-app.js');
      const ok = await applyDocumentLabels(labels());
      updateStatusMessage(ok ? t('pageLabels.applied') : t('pageLabels.notApplied'));
      if (ok) close();
    } finally {
      setBusy(false);
    }
  };

  const noteText = (row) => (row?.note === 'blank' ? t('pageLabels.noteBlank') : row?.note === 'duplicate' ? t('pageLabels.noteDuplicate') : '');

  return (
    <Dialog
      title={t('pageLabels.title')}
      dialogClass="sheet-links-dialog page-labels-dialog"
      bodyClass="sheet-links-body"
      onClose={close}
      footer={
        <div class="sheet-links-footer">
          <div>
            <button class="sheet-links-btn" id="page-labels-from-region" disabled={loading() || busy()} onClick={fromRegion}>
              {t('pageLabels.fromRegion')}
            </button>
            <button class="sheet-links-btn" id="page-labels-clear" disabled={loading() || busy()}
              onClick={() => setLabels(Array.from({ length: pageCount }, () => ''))}>
              {t('pageLabels.clearAll')}
            </button>
          </div>
          <div>
            <button class="sheet-links-btn" onClick={close}>{tCommon('cancel')}</button>
            <button class="sheet-links-btn primary" id="page-labels-apply" disabled={loading() || busy() || !changed()} onClick={apply}>
              {t('pageLabels.apply')}
            </button>
          </div>
        </div>
      }
    >
      <Show when={proposal}>
        <div class="sheet-links-muted" id="page-labels-proposal-info">
          {t('pageLabels.proposalInfo', { found: proposal.filter(r => r.found).length, count: proposal.length })}
        </div>
      </Show>
      <div class="sheet-links-table-wrap">
        <table class="sheet-links-table" id="page-labels-table">
          <thead>
            <tr>
              <th class="num">{t('pageLabels.page')}</th>
              <th>{t('pageLabels.label')}</th>
              <Show when={proposal}>
                <th>{t('pageLabels.current')}</th>
                <th>{t('pageLabels.regionText')}</th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <Show when={!loading()} fallback={<tr><td colSpan={4} class="sheet-links-muted">{t('pageLabels.loading')}</td></tr>}>
              <Index each={labels()}>
                {(label, index) => {
                  const i = () => index;
                  return (
                  <tr classList={{ 'is-current': i() + 1 === currentPage }}>
                    <td class="num">{i() + 1}</td>
                    <td>
                      <input type="text" value={label()} placeholder={String(i() + 1)} aria-label={t('pageLabels.labelOfPage', { page: i() + 1 })}
                        onChange={(e) => setLabel(i(), e.currentTarget.value)} />
                    </td>
                    <Show when={proposal}>
                      <td class="sheet-links-muted">{proposal[i()]?.current || ''}</td>
                      <td>
                        {proposal[i()]?.found || ''}
                        <Show when={noteText(proposal[i()])}>
                          {' '}<span class="sheet-links-note">{noteText(proposal[i()])}</span>
                        </Show>
                      </td>
                    </Show>
                  </tr>
                  );
                }}
              </Index>
            </Show>
          </tbody>
        </table>
      </div>
      <fieldset class="sheet-links-fieldset">
        <legend>{t('pageLabels.numbering')}</legend>
        <div class="sheet-links-row">
          <label>{t('pageLabels.fromPage')}
            <input type="number" min="1" max={pageCount} value={from()} onInput={(e) => setFrom(e.currentTarget.value)} />
          </label>
          <label>{t('pageLabels.toPage')}
            <input type="number" min="1" max={pageCount} value={to()} onInput={(e) => setTo(e.currentTarget.value)} />
          </label>
          <label>{t('pageLabels.style')}
            <select value={style()} onChange={(e) => setStyle(e.currentTarget.value)}>
              <For each={LABEL_STYLES}>{(s) => <option value={s}>{t(`pageLabels.${STYLE_KEYS[s]}`)}</option>}</For>
            </select>
          </label>
        </div>
        <div class="sheet-links-row">
          <label>{t('pageLabels.prefix')}
            <input type="text" value={prefix()} style="width:110px" onInput={(e) => setPrefix(e.currentTarget.value)} />
          </label>
          <label>{t('pageLabels.start')}
            <input type="number" min="1" value={start()} disabled={!style()} onInput={(e) => setStart(e.currentTarget.value)} />
          </label>
          <button class="sheet-links-btn" id="page-labels-apply-range" disabled={loading()} onClick={applyRange}>
            {t('pageLabels.applyNumbering')}
          </button>
        </div>
      </fieldset>
    </Dialog>
  );
}
