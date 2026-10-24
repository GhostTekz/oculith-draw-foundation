import { Show, For } from 'solid-js';
import { annotProps, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { CAPTION_KEYS, DEPTH_UNITS, SLOPE_MODES } from '../../../annotations/measure-extras.js';

// plan-review measurement extras (measure-extras.js): depth (wall area on a
// Length/Polylength, volume on a Volume), slope, per-segment values,
// centroid marker and which values the caption shows.
const CAPTION_FALLBACK = {
  length: 'Length', radius: 'Radius', wallArea: 'Wall area', depth: 'Depth',
  slope: 'Slope', area: 'Area', volume: 'Volume',
};
const SLOPE_FALLBACK = { degree: 'Degrees', grade: 'Grade (%)', pitch: 'Pitch (x:12)' };

export default function MeasureExtrasFields() {
  const { t } = useTranslation('properties');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  const type = () => annotProps.type;
  const captionKeys = () => CAPTION_KEYS[type()] || [];
  const caption = () => (Array.isArray(annotProps.measureCaption) ? annotProps.measureCaption : []);
  const toggleCaption = (key, on) => {
    const next = on ? [...caption().filter(k => k !== key), key] : caption().filter(k => k !== key);
    updateAnnotProp('measureCaption', next);
  };

  return (
    <Show when={captionKeys().length > 0 && annotProps.multiCount === 0}>
      <div class="property-group">
        <label>{t('measurement.depth', { defaultValue: 'Depth' })}</label>
        <input type="number" step="any" min="0"
          value={annotProps.measureDepth ?? ''}
          placeholder={t('measurement.depthNone', { defaultValue: 'None' })}
          disabled={isLocked()}
          onChange={(e) => updateAnnotProp('measureDepth', e.target.value)}
        />
        <select value={annotProps.measureDepthUnit || ''} disabled={isLocked()}
          aria-label={t('measurement.depthUnit', { defaultValue: 'Depth unit' })}
          onDblClick={cycleSelectNext}
          onChange={(e) => updateAnnotProp('measureDepthUnit', e.target.value)}>
          <option value="">{t('measurement.depthUnitScale', { defaultValue: 'Scale unit' })}</option>
          <For each={DEPTH_UNITS}>{(u) => <option value={u}>{u}</option>}</For>
        </select>
      </div>
      <div class="property-group">
        <label>{t('measurement.slope', { defaultValue: 'Slope' })}</label>
        <select value={annotProps.measureSlopeMode || ''} disabled={isLocked()}
          onDblClick={cycleSelectNext}
          onChange={(e) => updateAnnotProp('measureSlopeMode', e.target.value)}>
          <option value="">{t('measurement.slopeNone', { defaultValue: 'None' })}</option>
          <For each={SLOPE_MODES}>{(m) => (
            <option value={m}>{t(`measurement.slopeMode.${m}`, { defaultValue: SLOPE_FALLBACK[m] })}</option>
          )}</For>
        </select>
        <Show when={annotProps.measureSlopeMode}>
          <input type="number" step="any" min="0"
            value={annotProps.measureSlope ?? ''}
            aria-label={t('measurement.slopeValue', { defaultValue: 'Slope value' })}
            disabled={isLocked()}
            onChange={(e) => updateAnnotProp('measureSlope', e.target.value)}
          />
        </Show>
      </div>
      <Show when={type() === 'measurePerimeter' && annotProps.measureKindType !== 'measureArc'}>
        <div class="property-group">
          <label>{t('measurement.showSegments', { defaultValue: 'Show segment values' })}</label>
          <input type="checkbox" checked={!!annotProps.measureShowSegments} disabled={isLocked()}
            onChange={(e) => updateAnnotProp('measureShowSegments', e.target.checked)} />
        </div>
      </Show>
      <Show when={type() === 'measureArea'}>
        <div class="property-group">
          <label>{t('measurement.showCentroid', { defaultValue: 'Show centroid' })}</label>
          <input type="checkbox" checked={!!annotProps.measureShowCentroid} disabled={isLocked()}
            onChange={(e) => updateAnnotProp('measureShowCentroid', e.target.checked)} />
        </div>
      </Show>
      <div class="property-group" role="group"
        aria-label={t('measurement.caption', { defaultValue: 'Caption' })}>
        <label>{t('measurement.caption', { defaultValue: 'Caption' })}</label>
        <For each={captionKeys()}>{(key) => (
          <label class="property-inline-check">
            <input type="checkbox" checked={caption().includes(key)} disabled={isLocked()}
              onChange={(e) => toggleCaption(key, e.target.checked)} />
            {t(`measurement.captionKey.${key}`, { defaultValue: CAPTION_FALLBACK[key] })}
          </label>
        )}</For>
      </div>
      <Show when={annotProps.measureExtraValues}>
        <div class="property-group">
          <label>{t('measurement.extraValues', { defaultValue: 'Wall area / volume' })}</label>
          <input type="text" readonly value={annotProps.measureExtraValues} />
        </div>
      </Show>
    </Show>
  );
}
