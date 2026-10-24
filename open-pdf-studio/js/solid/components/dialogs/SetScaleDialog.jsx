import { createSignal, For, onMount, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import ScaleEquationEditor from './ScaleEquationEditor.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { setTool } from '../../../tools/manager.js';
import { applyPageScale, rememberSetScaleDraft } from '../../../annotations/measurement.js';
import { paginaOfDocumentSchaal } from '../../../annotations/schaal-op-punt.js';
import { detectScaleFromPdf } from '../../../annotations/scale-bar.js';
import { loadUserScalePresets } from '../../../annotations/scale-presets.js';
import { precisionOptions, precisionFromKey } from '../../../annotations/measure-precision.js';
import {
  initialSetScaleForm, setScaleCommit, setScalePages, formRatioText, presetAfterEdit, equationForDetected,
} from '../../../annotations/set-scale-form.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Set Scale: pages (all / current / range), a preset or a custom equation,
// Calibrate (two-point pick, the dialog comes back with the picked paper
// length), the display precision. Apply sets the page scale through
// applyPageScale: one undo step, every measurement recalculated.
export default function SetScaleDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const data = props.data || {};

  const doc = getActiveDocument();
  const pageNum = Number(data.pageNum) || doc?.currentPage || 1;
  const pageCount = () => {
    const d = getActiveDocument();
    return Number(d?.pdfDoc?.numPages) || Number(d?.pageCount) || 0;
  };

  const [userPresets, setUserPresets] = createSignal(loadUserScalePresets());
  const initial = initialSetScaleForm(data, paginaOfDocumentSchaal(doc, pageNum), userPresets());
  const [form, setFormRaw] = createSignal(initial);
  const [error, setError] = createSignal('');
  const [detecting, setDetecting] = createSignal(false);
  const [detectResult, setDetectResult] = createSignal(
    Number(data.detectedRatio) > 0 && !paginaOfDocumentSchaal(doc, pageNum) ? 'found' : null);
  let realInput;

  const setForm = (next) => { setFormRaw(next); setError(''); };
  const patch = (p) => setForm({ ...form(), ...p });

  onMount(() => {
    if (initial.focus === 'real') {
      setTimeout(() => { realInput?.focus(); realInput?.select?.(); }, 0);
    }
  });

  const errorText = (key) => (key === 'range.outOfRange'
    ? t('setScale.range.outOfRange', { count: pageCount() })
    : t(`setScale.${key}`));

  const rangeError = () => {
    if (form().pagesMode !== 'custom' || !form().rangeText.trim()) return '';
    const r = setScalePages(form(), { pageNum, pageCount: pageCount() });
    return r.error ? errorText(r.error) : '';
  };

  const cancel = () => closeDialog('setScale');

  function refreshProperties() {
    const selected = getActiveDocument()?.selectedAnnotation;
    if (selected) import('../../../bridge.js').then(m => m.storeShowProperties(selected));
  }

  function handleApply() {
    const result = setScaleCommit(form(), { pageNum, pageCount: pageCount() });
    if (result.error) {
      setError(errorText(result.error));
      return;
    }
    applyPageScale(result.scaleData, result.pages);
    refreshProperties();
    closeDialog('setScale');
  }

  function handleClear() {
    const result = setScalePages(form(), { pageNum, pageCount: pageCount() });
    if (result.error) {
      setError(errorText(result.error));
      return;
    }
    applyPageScale(null, result.pages);
    refreshProperties();
    closeDialog('setScale');
  }

  function handleCalibrate() {
    setTool('calibrationPick');
    if (state.currentTool !== 'calibrationPick') return; // read-only document
    const f = form();
    rememberSetScaleDraft({ pagesMode: f.pagesMode, rangeText: f.rangeText, paperUnit: f.paperUnit,
      realUnit: f.realUnit, realText: f.realText, precision: f.precision });
    closeDialog('setScale');
  }

  async function handleDetect() {
    setDetecting(true);
    setDetectResult(null);
    try {
      const found = await detectScaleFromPdf(pageNum, getActiveDocument());
      const ratio = Number(found?.ratio);
      if (ratio > 0) {
        const eq = equationForDetected(ratio, found?.imperial === true);
        const next = { ...form(), paperText: String(eq.paperValue), paperUnit: eq.paperUnit,
          realText: String(Number(eq.realValue.toPrecision(6))), realUnit: eq.realUnit, fromReference: false };
        setForm({ ...next, presetId: presetAfterEdit(next, userPresets()) });
        setDetectResult('found');
      } else {
        setDetectResult('notfound');
      }
    } catch {
      setDetectResult('notfound');
    } finally {
      setDetecting(false);
    }
  }

  const footer = (
    <>
      <button class="pref-btn" onClick={handleClear}>{t('setScale.clear')}</button>
      <div class="set-scale-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={cancel}>{tCommon('cancel')}</button>
        <button class="pref-btn pref-btn-primary" onClick={handleApply}>{tCommon('apply')}</button>
      </div>
    </>
  );

  const pageRadio = (mode, label) => (
    <label class="set-scale-radio">
      <input type="radio" name="set-scale-pages" checked={form().pagesMode === mode}
        onChange={() => patch({ pagesMode: mode })} />
      {label}
    </label>
  );

  return (
    <Dialog
      title={t('setScale.title')}
      overlayClass="set-scale-overlay"
      dialogClass="set-scale-dialog"
      onClose={cancel}
      footer={footer}
    >
      <fieldset class="set-scale-group">
        <legend>{t('setScale.pages')}</legend>
        <div class="set-scale-pages">
          {pageRadio('all', t('setScale.allPages'))}
          {pageRadio('current', t('setScale.currentPage', { page: pageNum }))}
          {pageRadio('custom', t('setScale.customPages'))}
          <input
            type="text"
            class="set-scale-input set-scale-range"
            placeholder={t('setScale.rangePlaceholder')}
            aria-label={t('setScale.customPages')}
            disabled={form().pagesMode !== 'custom'}
            value={form().rangeText}
            onInput={(e) => patch({ rangeText: e.target.value })}
          />
        </div>
        <Show when={rangeError()}>
          <div class="set-scale-error">{rangeError()}</div>
        </Show>
      </fieldset>

      <fieldset class="set-scale-group">
        <legend>{t('setScale.scaleGroup')}</legend>
        <ScaleEquationEditor
          form={form}
          setForm={setForm}
          userPresets={userPresets}
          setUserPresets={setUserPresets}
          realInputRef={(el) => { realInput = el; }}
          onEnter={handleApply}
        >
          <div class="set-scale-row">
            <span class="set-scale-label" />
            <button class="set-scale-btn" onClick={handleCalibrate} title={t('setScale.calibrateHelp')}>
              {t('setScale.calibrate')}
            </button>
            <Show when={formRatioText(form())}>
              <span class="set-scale-ratio">{formRatioText(form())}</span>
            </Show>
          </div>
          <Show when={form().fromReference}>
            <div class="set-scale-hint">{t('setScale.pickedHint')}</div>
          </Show>
        </ScaleEquationEditor>
        <div class="set-scale-row">
          <label class="set-scale-label">{t('setScale.precision')}</label>
          <select
            class="set-scale-select set-scale-precision"
            value={String(form().precision)}
            onChange={(e) => patch({ precision: precisionFromKey(e.target.value) })}
          >
            <For each={precisionOptions(form().realUnit)}>{o => <option value={o.value}>{o.label}</option>}</For>
          </select>
        </div>
        <div class="set-scale-row">
          <span class="set-scale-label" />
          <button class="set-scale-btn" onClick={handleDetect} disabled={detecting()}>
            {detecting() ? t('setScale.detecting') : t('setScale.detect')}
          </button>
          <Show when={detectResult() === 'found'}>
            <span class="set-scale-detect-found">{t('setScale.detected')}</span>
          </Show>
          <Show when={detectResult() === 'notfound'}>
            <span class="set-scale-detect-notfound">{t('setScale.notDetected')}</span>
          </Show>
        </div>
      </fieldset>

      <Show when={error()}>
        <div class="set-scale-error">{error()}</div>
      </Show>
    </Dialog>
  );
}
