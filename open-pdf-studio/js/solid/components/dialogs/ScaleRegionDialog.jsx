import { createSignal, For, onMount, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import ScaleEquationEditor from './ScaleEquationEditor.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { startScaleMeasureFlow } from '../../../tools/tools/scale-measure-tool.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { pasViewportToe, annuleerNieuweViewport, standaardViewportNaam } from '../../../annotations/named-viewports.js';
import { paginaOfDocumentSchaal } from '../../../annotations/schaal-op-punt.js';
import { loadUserScalePresets } from '../../../annotations/scale-presets.js';
import { precisionOptions, precisionFromKey } from '../../../annotations/measure-precision.js';
import { formRatioText } from '../../../annotations/set-scale-form.js';
import { initialViewportForm, viewportValuesFromForm } from '../../../annotations/viewport-scale-form.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// "Apply Scale to Viewport": name (required) and scale of a named viewport
// (scaleRegion), with the Set Scale editor: presets, the paper = real
// equation, precision, and Calibrate (a two-point pick inside the viewport
// fills the paper length; the real length is typed here). The form rules
// live in viewport-scale-form.js.

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function findAnnotation(id) {
  const doc = getActiveDocument();
  if (!doc) return null;
  return doc.annotations.find(a => a.id === id) || null;
}

export default function ScaleRegionDialog(props) {
  const { t } = useTranslation('properties');
  const { t: tScale } = useTranslation('dialogs');
  const data = props.data || {};
  const initialAnnotation = findAnnotation(data.annotationId);
  const initialSnapshot = data.snapshot || (initialAnnotation ? cloneAnnotation(initialAnnotation) : null);
  // Calibrate closes this dialog for the pick and reopens it with
  // data.initial (the label and form as left) and data.pickedPoints.
  const initial = data.initial || {};
  const pageNum = data.pageNum || initialAnnotation?.page || 1;
  const [userPresets, setUserPresets] = createSignal(loadUserScalePresets());
  const startForm = initialViewportForm(data, initialSnapshot,
    paginaOfDocumentSchaal(getActiveDocument(), pageNum), userPresets());
  const [form, setFormRaw] = createSignal(startForm);
  // A new viewport gets a free default name, so Apply works right away;
  // an empty name is refused (see handleApply).
  const defaultName = () => standaardViewportNaam(getActiveDocument(), pageNum,
    t('viewports.defaultName') || 'Viewport');
  const startLabel = data.initial ? initial.label : initialSnapshot?.label;
  const [label, setLabel] = createSignal(startLabel || (data.isNew ? defaultName() : ''));
  const [error, setError] = createSignal('');
  const [nameError, setNameError] = createSignal('');
  let realInput;

  const setForm = (next) => { setFormRaw(next); setError(''); };

  onMount(() => {
    if (startForm.focus === 'real') setTimeout(() => { realInput?.focus(); realInput?.select?.(); }, 0);
  });

  // Calibrate: hide this dialog, let the user click two points on the
  // drawing and reopen with their paper length; Apply stays the
  // confirmation step.
  function handleCalibrate() {
    const reopen = (extra = {}) => openDialog('scale-region', {
      annotationId: data.annotationId, pageNum: data.pageNum, isNew: data.isNew, snapshot: initialSnapshot,
      initial: { label: label(), form: { ...form(), fromReference: false } }, ...extra,
    });
    closeDialog('scale-region');
    startScaleMeasureFlow({
      onDone: (pixelDistance) => reopen({ pickedPoints: pixelDistance }),
      onCancel: () => reopen(),
    });
  }

  function handleApply() {
    const values = viewportValuesFromForm(form(), label());
    if (values.error) { setError(tScale(`setScale.${values.error}`)); return; }
    const result = pasViewportToe(data.annotationId, values, { isNew: data.isNew, snapshot: initialSnapshot });
    if (!result.ok) {
      if (result.fout === 'weg') { closeDialog('scale-region'); return; }
      if (result.fout === 'naam') setNameError(t('viewports.nameRequired'));
      else setError(tScale('setScale.invalidEquation'));
      return;
    }
    redraw();
    closeDialog('scale-region');
  }

  function handleCancel() {
    if (data.isNew) {
      annuleerNieuweViewport(data.annotationId);
      redraw();
    }
    closeDialog('scale-region');
  }

  return (
    <Dialog
      title={t('viewports.dialogTitle') || 'Apply Scale to Viewport'}
      dialogClass="scale-region-dialog set-scale-dialog"
      onClose={handleCancel}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={handleCancel}>{t('viewports.cancel') || 'Cancel'}</button>
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px"
            onClick={handleApply}>{t('viewports.apply') || 'Apply'}</button>
        </div>
      }
    >
      <div style="min-width:300px">
        <div class="ai-form-field">
          <label>{t('viewports.name') || 'Label'}</label>
          <input type="text" class="ribbon-input" required aria-required="true"
            value={label()} onInput={e => { setLabel(e.target.value); setNameError(''); }}
            placeholder={t('viewports.namePlaceholder') || 'e.g. Detail 3'}
            style="width:100%;box-sizing:border-box" />
          <Show when={nameError()}>
            <div class="scale-error">{nameError()}</div>
          </Show>
        </div>

        <fieldset class="set-scale-group">
          <legend>{tScale('setScale.scaleGroup')}</legend>
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
              <button class="set-scale-btn" onClick={handleCalibrate} title={tScale('setScale.calibrateHelp')}>
                {tScale('setScale.calibrate')}
              </button>
              <Show when={formRatioText(form())}>
                <span class="set-scale-ratio">{formRatioText(form())}</span>
              </Show>
            </div>
            <Show when={form().fromReference}>
              <div class="set-scale-hint">{tScale('setScale.pickedHint')}</div>
            </Show>
          </ScaleEquationEditor>
          <div class="set-scale-row">
            <label class="set-scale-label">{t('viewports.precision') || 'Precision'}</label>
            <select
              class="set-scale-select set-scale-precision"
              value={String(form().precision)}
              onChange={(e) => setForm({ ...form(), precision: precisionFromKey(e.target.value) })}
            >
              <For each={precisionOptions(form().realUnit)}>{o => <option value={o.value}>{o.label}</option>}</For>
            </select>
          </div>
        </fieldset>
        <Show when={error()}>
          <div class="set-scale-error">{error()}</div>
        </Show>
      </div>
    </Dialog>
  );
}
