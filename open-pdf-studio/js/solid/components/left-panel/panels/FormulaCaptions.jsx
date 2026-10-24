// Markups List: Formula columns with expressions and Custom Captions
// (annotations/formula-captions.js). A toolbar button opens a movable dialog;
// a bar under the list shows the column totals of the listed markups.
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import Dialog from '../../Dialog.jsx';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../../core/state.js';
import { commitAnnotationMutation } from '../../../../annotations/mutations.js';
import { ensureMarkupColumnsReady } from '../../../../pdf/markup-columns.js';
import { getTypeDisplayName } from '../../../../utils/helpers.js';
import { measureKindType } from '../../../../annotations/measure-extras.js';
import {
  expressionColumns, expressionColumn, expressionColumnError, expressionColumnTotals, captionTemplates,
  captionTemplate, captionTemplateFor, captionText, EXPRESSION_COLUMNS_MAX, RESULT_LENGTH_UNITS, RESULT_UNIT_MAX, DECIMALS_MAX,
  CAPTION_TEMPLATE_MAX, EXPRESSION_TEXT_MAX, EXPRESSION_COLUMN_KEYS,
} from '../../../../annotations/formula-captions.js';

const CAPTION_BASE_TYPES = ['measureArea', 'measureVolume', 'measureDistance', 'measurePerimeter',
  'measurePolylength', 'count'];

const refreshViews = () => {
  import('../../../../ui/panels/annotations-list.js').then(m => m.updateAnnotationsList());
  import('../../../../annotations/rendering.js').then(m => (getActiveDocument()?.viewMode === 'continuous'
    ? m.redrawContinuous() : m.redrawAnnotations()));
};

// The caption texts of a document, to notice a value change that alters a
// caption on the drawing (a Number edit only refreshes the list).
function captionSignature(doc) {
  if (!doc?.annotations?.length) return '';
  const parts = [];
  for (const ann of doc.annotations) {
    const template = captionTemplateFor(ann, doc);
    if (template) parts.push(`${ann.id}\u0000${captionText(template, ann, doc)}`);
  }
  return parts.join('\u0001');
}

/** Totals of the Formula columns over the markups the list shows. */
export function FormulaTotalsBar(props) {
  const { t } = useTranslation('common');
  // Redraw the canvas when a list update changed a caption. The redraw
  // rebuilds the list once more; the signature is then unchanged.
  let lastDoc = null;
  let lastSignature = '';
  createEffect(() => {
    props.items();
    const doc = getActiveDocument();
    const signature = captionSignature(doc);
    if (doc === lastDoc && signature !== lastSignature) {
      import('../../../../annotations/rendering.js').then(m => (doc.viewMode === 'continuous'
        ? m.redrawContinuous(true) : m.redrawAnnotations(true)));
    }
    lastDoc = doc;
    lastSignature = signature;
  });
  const totals = createMemo(() => {
    const rows = props.items();
    const doc = getActiveDocument();
    if (!doc || !expressionColumns(doc.formulaCaptions?.columns).length) return [];
    const ids = new Set(rows.filter(item => !item.isHeader && !item.isReply && !item.isReplyInput).map(item => item.id));
    return expressionColumnTotals(doc.annotations.filter(ann => ids.has(ann.id)), doc);
  });
  return (
    <Show when={totals().length}>
      <div class="annotations-formula-totals" role="status">
        <For each={totals()}>{total => (
          <span class="annotations-formula-total">
            {t('formulaCaptions.totalsBar', { name: total.name, total: total.text || '—' })}
            <Show when={total.uncalibrated}>
              <span class="annotations-formula-warning" title={t('formulaCaptions.scaleNotSet')}>
                {' '}⚠ {t('formulaCaptions.totalsUncalibrated', { count: total.uncalibrated })}</span>
            </Show>
          </span>
        )}</For>
      </div>
    </Show>
  );
}

/** Toolbar button + dialog. `onColumnsApplied(keys)` shows new columns in the list. */
export function FormulaCaptionsButton(props) {
  const { t } = useTranslation('common');
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button type="button" class="annotations-toolbar-btn annotations-formulas-btn"
        title={t('formulaCaptions.buttonTitle')} aria-haspopup="dialog" aria-expanded={open()}
        onClick={() => setOpen(true)}>{t('formulaCaptions.button')}</button>
      <Show when={open()}>
        <Portal>
          <FormulaCaptionsDialog onClose={() => setOpen(false)} onColumnsApplied={props.onColumnsApplied} />
        </Portal>
      </Show>
    </>
  );
}

function FormulaCaptionsDialog(props) {
  const { t } = useTranslation('common');
  const doc = getActiveDocument();
  const model = doc?.formulaCaptions || {};
  const selected = doc?.selectedAnnotation || null;
  const [columns, setColumns] = createSignal(expressionColumns(model.columns)
    .map(column => ({ ...column, decimals: String(column.decimals) })));
  const [captions, setCaptions] = createSignal(Object.entries(captionTemplates(model.captions))
    .map(([type, template]) => ({ type, template })));
  const [ownCaption, setOwnCaption] = createSignal(captionTemplate(selected?.captionTemplate));
  const [errors, setErrors] = createSignal([]);
  const [message, setMessage] = createSignal(doc ? '' : t('formulaCaptions.noDocument'));
  const [totals, setTotals] = createSignal([]);

  const markupTypes = () => {
    const present = (doc?.annotations || []).filter(ann => ann.type !== 'scaleRegion').map(ann => measureKindType(ann));
    return [...new Set([...CAPTION_BASE_TYPES, ...present, ...captions().map(row => row.type)])];
  };
  const updateTotals = async () => {
    if (!doc) return;
    const list = await import('../../../../ui/panels/annotations-list.js');
    setTotals(expressionColumnTotals(list.currentListMarkups(), doc));
  };
  void updateTotals();

  const setColumn = (index, field, value) =>
    setColumns(list => list.map((column, i) => (i === index ? { ...column, [field]: value } : column)));
  const setCaption = (index, field, value) =>
    setCaptions(list => list.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  const apply = async () => {
    if (!doc) return;
    try { await ensureMarkupColumnsReady(doc); } catch { /* Definitions already in memory still apply. */ }
    if (getActiveDocument() !== doc) { props.onClose(); return; }
    const drafts = columns().map(column => ({ ...column, name: column.name.trim(),
      decimals: Number.parseInt(column.decimals, 10) }));
    const found = drafts.map((draft, index) => expressionColumnError(draft, doc, drafts, index));
    setErrors(found);
    if (found.some(Boolean)) { setMessage(''); return; }
    const next = { v: 1, columns: drafts.map(expressionColumn),
      captions: captionTemplates(Object.fromEntries(captions().filter(row => row.type)
        .map(row => [row.type, row.template]))) };
    if (JSON.stringify(doc.formulaCaptions || null) !== JSON.stringify(next)) {
      doc.formulaCaptions = next;
      doc.modified = true;
      doc.savedUndoStackLength = -1;
    }
    const own = captionTemplate(ownCaption());
    if (selected && doc.annotations.includes(selected) && !selected.locked && !selected.readOnly
        && own !== captionTemplate(selected.captionTemplate)) {
      commitAnnotationMutation(selected, current => {
        if (own) current.captionTemplate = own; else delete current.captionTemplate;
      });
    }
    props.onColumnsApplied?.(EXPRESSION_COLUMN_KEYS.slice(0, next.columns.length));
    refreshViews();
    setMessage(t('formulaCaptions.applied'));
    setTimeout(() => void updateTotals(), 0);
  };

  // Beyond the external editor: the listed markups with their Formula columns as XLSX.
  const exportXlsx = async () => {
    if (!doc) return;
    try {
      const [list, { takeoffXlsx }, platform] = await Promise.all([
        import('../../../../ui/panels/annotations-list.js'),
        import('../../../../annotations/formula-xlsx.js'),
        import('../../../../core/platform.js')]);
      const base = String(doc.filePath || doc.fileName || 'drawing').split(/[\\/]/u).pop().replace(/\.pdf$/iu, '') || 'drawing';
      const path = await platform.saveFileDialog(`${base}-markups.xlsx`, [{ name: 'Excel', extensions: ['xlsx'] }]);
      if (!path) return;
      await platform.writeBinaryFile(path, takeoffXlsx(list.currentListMarkups(), doc, base));
      setMessage(t('formulaCaptions.exported'));
    } catch (error) {
      setMessage(String(error?.message || error));
    }
  };

  const footer = (
    <div class="message-dialog-footer">
      <Show when={message()}><span class="formula-captions-message" role="status">{message()}</span></Show>
      <button class="pref-btn pref-btn-secondary" disabled={!doc} onClick={() => void exportXlsx()}>{t('formulaCaptions.exportXlsx')}</button>
      <button class="pref-btn pref-btn-primary" disabled={!doc} onClick={() => void apply()}>{t('formulaCaptions.apply')}</button>
      <button class="pref-btn pref-btn-secondary" onClick={() => props.onClose()}>{t('formulaCaptions.close')}</button>
    </div>
  );

  return (
    <Dialog title={t('formulaCaptions.title')} dialogClass="formula-captions-dialog" onClose={props.onClose} footer={footer}>
      <div class="formula-captions-body">
        <h3>{t('formulaCaptions.columnsHeading')}</h3>
        <p class="formula-captions-hint">{t('formulaCaptions.columnsHint', { max: EXPRESSION_COLUMNS_MAX })}</p>
        <div class="formula-captions-grid formula-captions-columns">
          <span>{t('formulaCaptions.name')}</span><span>{t('formulaCaptions.expression')}</span>
          <span>{t('formulaCaptions.lengthUnit')}</span><span>{t('formulaCaptions.unit')}</span>
          <span>{t('formulaCaptions.decimals')}</span><span></span>
          <For each={columns()}>{(column, index) => (
            <>
              <input type="text" maxLength={48} aria-label={t('formulaCaptions.name')} value={column.name}
                onInput={event => setColumn(index(), 'name', event.currentTarget.value)} />
              <input type="text" maxLength={EXPRESSION_TEXT_MAX} aria-label={t('formulaCaptions.expression')}
                class="formula-captions-expression" value={column.expression} spellcheck={false}
                onInput={event => setColumn(index(), 'expression', event.currentTarget.value)} />
              <select aria-label={t('formulaCaptions.lengthUnit')} value={column.lengthUnit}
                onChange={event => setColumn(index(), 'lengthUnit', event.currentTarget.value)}>
                <For each={RESULT_LENGTH_UNITS}>{unit => (
                  <option value={unit}>{unit || t('formulaCaptions.ownUnit')}</option>)}</For>
              </select>
              <input type="text" maxLength={RESULT_UNIT_MAX} aria-label={t('formulaCaptions.unit')} value={column.unit}
                onInput={event => setColumn(index(), 'unit', event.currentTarget.value)} />
              <input type="number" min="0" max={DECIMALS_MAX} step="1" aria-label={t('formulaCaptions.decimals')}
                value={column.decimals} onInput={event => setColumn(index(), 'decimals', event.currentTarget.value)} />
              <button type="button" class="pref-btn pref-btn-secondary"
                onClick={() => { setColumns(list => list.filter((_, i) => i !== index())); setErrors([]); }}>
                {t('formulaCaptions.remove')}</button>
              <Show when={errors()[index()]}>
                <span class="formula-captions-error" role="alert">{errors()[index()]}</span>
              </Show>
            </>
          )}</For>
        </div>
        <button type="button" class="pref-btn pref-btn-secondary" disabled={columns().length >= EXPRESSION_COLUMNS_MAX}
          onClick={() => setColumns(list => [...list, { name: '', expression: '', unit: '', decimals: '2', lengthUnit: '' }])}>
          {t('formulaCaptions.addColumn')}</button>

        <Show when={totals().length}>
          <h3>{t('formulaCaptions.totalsHeading')}</h3>
          <table class="formula-captions-totals">
            <tbody>
              <For each={totals()}>{total => (
                <tr>
                  <th scope="row">{total.name}</th>
                  <td class="formula-captions-total">{total.text || '—'}</td>
                  <td>{t('formulaCaptions.counted', { count: total.counted })}</td>
                  <td class="formula-captions-warning">{total.uncalibrated
                    ? `⚠ ${t('formulaCaptions.uncalibrated', { count: total.uncalibrated })}` : ''}</td>
                </tr>
              )}</For>
            </tbody>
          </table>
        </Show>

        <h3>{t('formulaCaptions.captionsHeading')}</h3>
        <p class="formula-captions-hint">{t('formulaCaptions.captionsHint')}</p>
        <div class="formula-captions-grid formula-captions-captions">
          <span>{t('formulaCaptions.markupType')}</span><span>{t('formulaCaptions.template')}</span><span></span>
          <For each={captions()}>{(row, index) => (
            <>
              <select aria-label={t('formulaCaptions.markupType')} value={row.type}
                onChange={event => setCaption(index(), 'type', event.currentTarget.value)}>
                <For each={markupTypes()}>{type => <option value={type}>{getTypeDisplayName(type)}</option>}</For>
              </select>
              <input type="text" maxLength={CAPTION_TEMPLATE_MAX} aria-label={t('formulaCaptions.template')}
                value={row.template} spellcheck={false}
                onInput={event => setCaption(index(), 'template', event.currentTarget.value)} />
              <button type="button" class="pref-btn pref-btn-secondary"
                onClick={() => setCaptions(list => list.filter((_, i) => i !== index()))}>{t('formulaCaptions.remove')}</button>
            </>
          )}</For>
        </div>
        <button type="button" class="pref-btn pref-btn-secondary"
          onClick={() => setCaptions(list => [...list, { type: markupTypes().find(type =>
            !list.some(row => row.type === type)) || 'measureArea', template: '{Subject} {Area}' }])}>
          {t('formulaCaptions.addCaption')}</button>
        <Show when={selected}>
          <label class="formula-captions-own">
            <span>{t('formulaCaptions.selectedCaption')}</span>
            <input type="text" maxLength={CAPTION_TEMPLATE_MAX} value={ownCaption()} spellcheck={false}
              disabled={!!selected?.locked || !!selected?.readOnly}
              onInput={event => setOwnCaption(event.currentTarget.value)} />
          </label>
        </Show>
      </div>
    </Dialog>
  );
}
