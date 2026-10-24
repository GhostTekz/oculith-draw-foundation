import { Show, For } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import { allLineStyles } from '../../stores/lineStylesStore.js';
import { openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import LineStylePreview from './LineStylePreview.jsx';

/** The label of a style: the translated built-in name, else its own name. */
export function lineStyleLabel(t, style) {
  if (!style) return '';
  if (style.builtin) {
    const key = `lineStyles.builtin.${style.id}`;
    const v = t(key);
    return v && v !== key ? v : style.name;
  }
  return style.name;
}

// Properties ▸ Appearance: the custom line style of a line, polyline, arc,
// spline or perimeter/polylength measurement. "None" keeps the border style.
// Not offered for tool defaults: a style reaches new markups through a Tool
// Chest preset instead.
export default function LineStylePicker() {
  const { t } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  const styles = () => allLineStyles();
  const current = () => styles().find(s => s.id === annotProps.lineStyleId) || null;
  return (
    <Show when={sectionVis.lineStyleGroup && annotProps.id !== '__tool-defaults__'}>
      <div class="property-group ls-picker">
        <label for="prop-line-style">{t('lineStyles.lineStyle')}</label>
        <div class="ls-picker-row">
          <select id="prop-line-style" value={annotProps.lineStyleId || ''} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('lineStyleId', e.target.value)}>
            <Show when={annotProps.lineStyleId === 'mixed'}>
              <option value="mixed" disabled hidden>{t('mixed')}</option>
            </Show>
            <Show when={annotProps.lineStyleId && annotProps.lineStyleId !== 'mixed' && !current()}>
              <option value={annotProps.lineStyleId}>{t('lineStyles.fromDocument')}</option>
            </Show>
            <option value="">{t('lineStyles.noneOption')}</option>
            <optgroup label={t('lineStyles.builtinGroup')}>
              <For each={styles().filter(s => s.builtin)}>{(s) => <option value={s.id}>{lineStyleLabel(t, s)}</option>}</For>
            </optgroup>
            <Show when={styles().some(s => !s.builtin)}>
              <optgroup label={t('lineStyles.userGroup')}>
                <For each={styles().filter(s => !s.builtin)}>{(s) => <option value={s.id}>{s.name}</option>}</For>
              </optgroup>
            </Show>
          </select>
          <button type="button" class="prop-action-btn ls-manage-btn" title={t('lineStyles.manage')}
            aria-label={t('lineStyles.manage')}
            onClick={() => openDialog('line-styles', { selectId: annotProps.lineStyleId || '' })}>{'⋯'}</button>
        </div>
        <Show when={current()}>
          <LineStylePreview style={current} width={200} height={22} class="ls-picker-preview" />
        </Show>
      </div>
    </Show>
  );
}
