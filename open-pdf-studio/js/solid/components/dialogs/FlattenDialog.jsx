import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { parsePageRange } from '../../../pdf/exporter.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Document ▸ Flatten… (the external editor "Flatten Markups"): which pages, which markups
// (all, the selection, or by type) and whether Unflatten may restore them.
// data: { totalPages, currentPage, types: [{ name, count }], selectedIds: string[] }
export default function FlattenDialog(props) {
  const { t } = useTranslation('common');

  const totalPages = props.data?.totalPages || 1;
  const currentPage = props.data?.currentPage || 1;
  const types = props.data?.types || [];
  const selectedIds = props.data?.selectedIds || [];

  const [pageMode, setPageMode] = createSignal('all');
  const [pageRange, setPageRange] = createSignal(`1-${totalPages}`);
  const [markupMode, setMarkupMode] = createSignal(selectedIds.length && props.data?.selection ? 'selected' : 'all');
  const [checkedTypes, setCheckedTypes] = createSignal(new Set(types.map(x => x.name)));
  const [allowUnflatten, setAllowUnflatten] = createSignal(true);

  const close = () => closeDialog('flatten');

  const toggleType = (name, on) => {
    const next = new Set(checkedTypes());
    if (on) next.add(name); else next.delete(name);
    setCheckedTypes(next);
  };

  const apply = async () => {
    let pages = null;
    if (pageMode() === 'current') pages = [currentPage];
    if (pageMode() === 'range') {
      pages = parsePageRange(pageRange(), totalPages);
      if (!pages.length) { showMessage(t('invalidPageRange')); return; }
    }
    let typeSet = null;
    if (markupMode() === 'types') {
      typeSet = checkedTypes();
      if (!typeSet.size) { showMessage(t('flattenMarkups.noTypes')); return; }
    }
    const ids = markupMode() === 'selected' ? new Set(selectedIds) : null;
    close();
    try {
      const { flattenDocument } = await import('../../../pdf/flatten-document.js');
      const result = await flattenDocument({ pages, types: typeSet, ids, allowUnflatten: allowUnflatten() });
      if (result.reason) {
        showMessage(t(`flattenMarkups.${result.reason}`));
      } else if (result.skipped) {
        showMessage(`${t('flattenMarkups.done', { count: result.flattened })} ${t('flattenMarkups.skipped', { count: result.skipped })}`);
      }
    } catch (e) {
      console.warn('[flatten] failed:', e);
      showMessage(t('flattenMarkups.failed'));
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" data-flatten-apply onClick={apply}>{t('flattenMarkups.apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{t('cancel')}</button>
      </div>
    </>
  );

  const radio = (name, value, signal, set, label, extra = {}) => (
    <label class="extract-pages-checkbox-label">
      <input type="radio" name={name} value={value} checked={signal() === value}
        disabled={extra.disabled} onChange={() => set(value)} /> {label}
    </label>
  );

  return (
    <Dialog
      title={t('flattenMarkups.title')}
      overlayClass="extract-pages-overlay"
      dialogClass="extract-pages-dialog flatten-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={close}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="extract-pages-row" style={{ 'align-items': 'flex-start' }}>
          <span class="extract-pages-label">{t('flattenMarkups.pages')}</span>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', flex: 1 }}>
            {radio('flatten-pages', 'all', pageMode, setPageMode, t('flattenMarkups.allPages'))}
            {radio('flatten-pages', 'current', pageMode, setPageMode, t('flattenMarkups.currentPage', { page: currentPage }))}
            <div class="extract-pages-row">
              {radio('flatten-pages', 'range', pageMode, setPageMode, t('flattenMarkups.pageRange'))}
              <input type="text" class="extract-pages-input-wide" value={pageRange()}
                placeholder={t('flattenMarkups.rangePlaceholder')} disabled={pageMode() !== 'range'}
                onInput={(e) => setPageRange(e.target.value)} />
            </div>
          </div>
        </div>
        <div class="extract-pages-row" style={{ 'align-items': 'flex-start' }}>
          <span class="extract-pages-label">{t('flattenMarkups.markups')}</span>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', flex: 1 }}>
            {radio('flatten-markups', 'all', markupMode, setMarkupMode, t('flattenMarkups.allMarkups'))}
            {radio('flatten-markups', 'selected', markupMode, setMarkupMode,
              t('flattenMarkups.selectedMarkups', { count: selectedIds.length }), { disabled: !selectedIds.length })}
            {radio('flatten-markups', 'types', markupMode, setMarkupMode, t('flattenMarkups.byType'))}
            <Show when={markupMode() === 'types'}>
              <div class="flatten-type-list" style={{ 'max-height': '160px', overflow: 'auto', padding: '4px 6px',
                border: '1px solid var(--theme-border)', 'border-radius': 'var(--ox-r-xs, 3px)',
                display: 'flex', 'flex-direction': 'column', gap: '3px' }}>
                <For each={types}>
                  {(type) => (
                    <label class="extract-pages-checkbox-label">
                      <input type="checkbox" checked={checkedTypes().has(type.name)}
                        onChange={(e) => toggleType(type.name, e.target.checked)} /> {`${type.name} (${type.count})`}
                    </label>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
        <div class="extract-pages-row extract-pages-checkbox-row">
          <label class="extract-pages-checkbox-label" title={t('flattenMarkups.allowUnflattenHint')}>
            <input type="checkbox" data-flatten-allow checked={allowUnflatten()}
              onChange={(e) => setAllowUnflatten(e.target.checked)} /> {t('flattenMarkups.allowUnflatten')}
          </label>
        </div>
        <div class="extract-pages-row extract-pages-info" style={{ 'padding-left': '0' }}>
          {allowUnflatten() ? t('flattenMarkups.allowUnflattenHint') : t('flattenMarkups.noUnflattenHint')}
        </div>
      </div>
    </Dialog>
  );
}
