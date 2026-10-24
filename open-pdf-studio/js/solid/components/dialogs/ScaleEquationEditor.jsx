import { For, Show } from 'solid-js';
import { SCALE_UNITS } from '../../../annotations/scale-entry.js';
import { SCALE_PRESET_GROUPS, addUserScalePreset, deleteUserScalePreset, parseScaleEquation } from '../../../annotations/scale-presets.js';
import { changeRealUnit, choosePreset, presetAfterEdit } from '../../../annotations/set-scale-form.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// The scale preset dropdown and the equation
//   [paper length] [paper unit] = [real length] [real unit]
// shared by Set Scale and any other dialog that sets a scale. The caller
// owns the form (see set-scale-form.js) and the user preset list:
//   form / setForm            accessor and setter of the SetScaleForm
//   userPresets / setUserPresets
//   realInputRef(el)          the real-length input, e.g. to focus it
//   onEnter()                 Enter in a length field
//   children                  extra controls after the equation (Calibrate)
const GROUP_LABEL_KEYS = {
  architectural: 'setScale.groupArchitectural',
  engineering: 'setScale.groupEngineering',
  metric: 'setScale.groupMetric',
};

export default function ScaleEquationEditor(props) {
  const { t } = useTranslation('dialogs');
  const form = () => props.form();
  const isUserPreset = () => props.userPresets().some(p => p.id === form().presetId);
  const canAddPreset = () => form().presetId === 'custom'
    && !!parseScaleEquation(form().paperText, form().paperUnit, form().realText, form().realUnit);

  function edit(patch) {
    const next = { ...form(), ...patch, fromReference: 'paperText' in patch || 'paperUnit' in patch ? false : form().fromReference };
    props.setForm({ ...next, presetId: presetAfterEdit(next, props.userPresets()) });
  }

  function addPreset() {
    const eq = parseScaleEquation(form().paperText, form().paperUnit, form().realText, form().realUnit);
    if (!eq) return;
    const { presets, preset } = addUserScalePreset(eq);
    props.setUserPresets(presets);
    if (preset) props.setForm({ ...form(), presetId: preset.id });
  }

  function deletePreset() {
    if (!isUserPreset()) return;
    props.setUserPresets(deleteUserScalePreset(form().presetId));
    props.setForm({ ...form(), presetId: 'custom' });
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      props.onEnter?.();
    }
  }

  const unitSelect = (value, onChange) => (
    <select class="set-scale-select set-scale-unit" value={value()} onChange={(e) => onChange(e.target.value)}>
      <For each={SCALE_UNITS}>{u => <option value={u}>{u}</option>}</For>
    </select>
  );

  return (
    <>
      <div class="set-scale-row">
        <label class="set-scale-label">{t('setScale.preset')}</label>
        <select
          class="set-scale-select set-scale-preset"
          value={form().presetId}
          onChange={(e) => props.setForm(choosePreset(form(), e.target.value, props.userPresets()))}
        >
          <option value="custom">{t('setScale.custom')}</option>
          <Show when={props.userPresets().length > 0}>
            <optgroup label={t('setScale.groupUser')}>
              <For each={props.userPresets()}>{p => <option value={p.id}>{p.label}</option>}</For>
            </optgroup>
          </Show>
          <For each={SCALE_PRESET_GROUPS}>{g => (
            <optgroup label={t(GROUP_LABEL_KEYS[g.group])}>
              <For each={g.presets}>{p => <option value={p.id}>{p.label}</option>}</For>
            </optgroup>
          )}</For>
        </select>
      </div>
      <div class="set-scale-row set-scale-preset-actions">
        <span class="set-scale-label" />
        <button class="set-scale-btn" disabled={!canAddPreset()} onClick={addPreset}>
          {t('setScale.addPreset')}
        </button>
        <button class="set-scale-btn" disabled={!isUserPreset()} onClick={deletePreset}>
          {t('setScale.deletePreset')}
        </button>
      </div>
      <div class="set-scale-row">
        <label class="set-scale-label">{t('setScale.scale')}</label>
        <input
          type="text"
          class="set-scale-input"
          aria-label={t('setScale.paperLength')}
          title={t('setScale.paperLength')}
          value={form().paperText}
          onInput={(e) => edit({ paperText: e.target.value })}
          onKeyDown={onKeyDown}
        />
        {unitSelect(() => form().paperUnit, (u) => edit({ paperUnit: u }))}
        <span class="set-scale-equals">=</span>
        <input
          ref={(el) => props.realInputRef?.(el)}
          type="text"
          class="set-scale-input"
          aria-label={t('setScale.realLength')}
          title={t('setScale.realLength')}
          value={form().realText}
          onInput={(e) => edit({ realText: e.target.value })}
          onKeyDown={onKeyDown}
        />
        {unitSelect(() => form().realUnit, (u) => {
          const next = changeRealUnit(form(), u);
          props.setForm({ ...next, presetId: presetAfterEdit(next, props.userPresets()) });
        })}
      </div>
      {props.children}
    </>
  );
}
