import { createSignal, createMemo, Index, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { BATCH_LINK_DEFAULTS } from '../../../pdf/batch-link.js';

const NAME = 'batch-link';

/**
 * Batch > Link (the external editor Batch Link) for the open document: the page labels are
 * the sheet numbers to look for; Find lists every reference with its target
 * for review, Create Links adds the checked ones as hyperlink markups, and
 * the summary reports what was created and skipped.
 */
export default function BatchLinkDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const doc = getActiveDocument();
  const [opts, setOpts] = createSignal({ ...BATCH_LINK_DEFAULTS });
  const [phase, setPhase] = createSignal('options'); // options | scanning | preview | done
  const [progress, setProgress] = createSignal('');
  const [plan, setPlan] = createSignal(null);
  const [checked, setChecked] = createSignal([]);
  const [created, setCreated] = createSignal(0);

  const set = (key, value) => setOpts(prev => ({ ...prev, [key]: value }));
  const close = () => closeDialog(NAME);
  const labelOf = (page) => {
    const label = plan()?.labels?.[page - 1];
    return label && label !== String(page) ? `${label} (${page})` : String(page);
  };
  const targetCount = createMemo(() => {
    const labels = plan()?.labels || [];
    return labels.filter((l, i) => l && !/^\d+$/.test(l) && l !== String(i + 1)).length;
  });
  const chosen = createMemo(() => (plan()?.links || []).filter((_, i) => checked()[i]));
  const skippedBy = (reason) => (plan()?.skipped || []).filter(s => s.reason === reason).length;

  const find = async () => {
    setPhase('scanning');
    const { scanDocumentForLinks } = await import('../../../pdf/batch-link-app.js');
    const result = await scanDocumentForLinks(opts(), (p, n) => setProgress(t('batchLink.scanning', { page: p, count: n })));
    if (!result) { setPhase('options'); return; }
    setPlan(result);
    setChecked(result.links.map(() => true));
    setPhase('preview');
  };

  const createLinks = async () => {
    const { createDocumentLinks } = await import('../../../pdf/batch-link-app.js');
    setCreated(await createDocumentLinks(chosen(), opts()));
    setPhase('done');
  };

  const openPageLabels = () => {
    close();
    openDialog('page-labels', {});
  };

  const footer = (
    <div class="sheet-links-footer">
      <div>
        <Show when={phase() === 'preview'}>
          <button class="sheet-links-btn" id="batch-link-back" onClick={() => setPhase('options')}>{t('batchLink.back')}</button>
        </Show>
      </div>
      <div>
        <Show when={phase() !== 'done'} fallback={
          <button class="sheet-links-btn primary" id="batch-link-close" onClick={close}>{t('batchLink.finish')}</button>
        }>
          <button class="sheet-links-btn" onClick={close}>{tCommon('cancel')}</button>
          <Show when={phase() === 'preview'} fallback={
            <button class="sheet-links-btn primary" id="batch-link-find" disabled={phase() === 'scanning' || !doc?.pdfDoc} onClick={find}>
              {t('batchLink.find')}
            </button>
          }>
            <button class="sheet-links-btn primary" id="batch-link-create" disabled={!chosen().length} onClick={createLinks}>
              {t('batchLink.create', { count: chosen().length })}
            </button>
          </Show>
        </Show>
      </div>
    </div>
  );

  return (
    <Dialog title={t('batchLink.title')} dialogClass="sheet-links-dialog batch-link-dialog" bodyClass="sheet-links-body" onClose={close} footer={footer}>
      <Show when={phase() === 'options' || phase() === 'scanning'}>
        <div class="sheet-links-muted">{t('batchLink.intro')}</div>
        <fieldset class="sheet-links-fieldset">
          <legend>{t('batchLink.searchOptions')}</legend>
          <div class="sheet-links-row">
            <label><input type="checkbox" id="batch-link-whole-word" checked={opts().wholeWord} onChange={(e) => set('wholeWord', e.currentTarget.checked)} />{t('batchLink.wholeWord')}</label>
            <label><input type="checkbox" id="batch-link-case" checked={opts().caseSensitive} onChange={(e) => set('caseSensitive', e.currentTarget.checked)} />{t('batchLink.matchCase')}</label>
          </div>
          <div class="sheet-links-row">
            <label><input type="checkbox" id="batch-link-callouts" checked={opts().callouts} onChange={(e) => set('callouts', e.currentTarget.checked)} />{t('batchLink.callouts')}</label>
            <label><input type="checkbox" id="batch-link-self" checked={opts().excludeSelf} onChange={(e) => set('excludeSelf', e.currentTarget.checked)} />{t('batchLink.excludeSelf')}</label>
          </div>
        </fieldset>
        <fieldset class="sheet-links-fieldset">
          <legend>{t('batchLink.appearance')}</legend>
          <div class="sheet-links-row">
            <label>{t('batchLink.highlight')}
              <select id="batch-link-highlight" value={opts().highlight} onChange={(e) => set('highlight', e.currentTarget.value)}>
                <option value="outline">{t('batchLink.outline')}</option>
                <option value="none">{t('batchLink.none')}</option>
              </select>
            </label>
            <label>{t('batchLink.color')}
              <input type="color" value={opts().color} disabled={opts().highlight !== 'outline'} onInput={(e) => set('color', e.currentTarget.value)} />
            </label>
            <label>{t('batchLink.lineWidth')}
              <input type="number" min="0.25" max="6" step="0.25" value={opts().lineWidth} disabled={opts().highlight !== 'outline'}
                onInput={(e) => set('lineWidth', Number(e.currentTarget.value) || 1)} />
            </label>
          </div>
        </fieldset>
        <Show when={phase() === 'scanning'}>
          <div class="sheet-links-muted">{progress() || t('batchLink.scanningStart')}</div>
        </Show>
      </Show>

      <Show when={phase() === 'preview' && plan()}>
        <Show when={targetCount() === 0}>
          <div class="sheet-links-warning" id="batch-link-no-labels">
            {t('batchLink.noLabels')}{' '}
            <button class="sheet-links-btn" onClick={openPageLabels}>{t('batchLink.openPageLabels')}</button>
          </div>
        </Show>
        <div class="sheet-links-muted" id="batch-link-summary">
          {t('batchLink.previewSummary', {
            links: plan().links.length, targets: targetCount(),
            self: skippedBy('self'), existing: skippedBy('existing'), noText: plan().pagesWithoutText.length,
          })}
        </div>
        <Show when={plan().ambiguous.length}>
          <div class="sheet-links-warning">{t('batchLink.ambiguous', { labels: plan().ambiguous.map(a => a.label).join(', ') })}</div>
        </Show>
        <div class="sheet-links-table-wrap">
          <table class="sheet-links-table" id="batch-link-preview">
            <thead>
              <tr>
                <th class="num">
                  <input type="checkbox" aria-label={t('batchLink.all')} checked={checked().every(Boolean)}
                    onChange={(e) => setChecked(checked().map(() => e.currentTarget.checked))} />
                </th>
                <th>{t('batchLink.sourcePage')}</th>
                <th>{t('batchLink.text')}</th>
                <th>{t('batchLink.target')}</th>
              </tr>
            </thead>
            <tbody>
              <Index each={plan().links}>
                {(link, i) => (
                  <tr>
                    <td class="num">
                      <input type="checkbox" checked={checked()[i]} onChange={(e) => setChecked(checked().map((c, k) => (k === i ? e.currentTarget.checked : c)))} />
                    </td>
                    <td>{labelOf(link().page)}</td>
                    <td>{link().text}</td>
                    <td>{labelOf(link().targetPage)}</td>
                  </tr>
                )}
              </Index>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={phase() === 'done'}>
        <div id="batch-link-result">
          <div>{t('batchLink.created', { count: created() })}</div>
          <div class="sheet-links-muted">{t('batchLink.skipped', {
            unchecked: (plan()?.links.length || 0) - created(), self: skippedBy('self'), existing: skippedBy('existing'),
          })}</div>
          <Show when={plan()?.pagesWithoutText.length}>
            <div class="sheet-links-muted">{t('batchLink.pagesWithoutText', { pages: plan().pagesWithoutText.join(', ') })}</div>
          </Show>
          <div class="sheet-links-muted">{t('batchLink.saveHint')}</div>
        </div>
      </Show>
    </Dialog>
  );
}
