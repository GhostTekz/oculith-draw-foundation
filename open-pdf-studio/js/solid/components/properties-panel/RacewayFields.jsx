import { Show, For } from 'solid-js';
import { annotProps, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  CONDUIT_TYPES, CONDUIT_TYPE_IDS, conduitSizes, TRAY_STYLES, TRAY_WIDTHS, RAIL_HEIGHTS,
} from '../../../annotations/raceway.js';
import ConduitFillFields from './ConduitFillFields.jsx';

// Properties of a conduit / cable tray run (annotations/raceway.js): change
// the conduit type, size and true-size drawing, or the tray style, width,
// rail height and rung spacing, and the elbow radius, after drawing (as-built
// corrections). Shows the fittings and the bend total.

export default function RacewayFields() {
  const { t } = useTranslation('common');
  const rw = () => annotProps.raceway || {};
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  const set = (patch) => updateAnnotProp('raceway', patch);
  return (
    <Show when={annotProps.raceway && annotProps.multiCount === 0}>
      <div class="property-group">
        <label>{t('raceway.title')}</label>
        <select data-rw-prop="kind" value={rw().kind} disabled={locked()} onDblClick={cycleSelectNext}
          onChange={(e) => set({ kind: e.target.value })}>
          <option value="conduit">{t('raceway.conduit')}</option>
          <option value="tray">{t('raceway.tray')}</option>
        </select>
      </div>
      <Show when={rw().kind === 'conduit'} fallback={
        <>
          <div class="property-group">
            <label>{t('raceway.style')}</label>
            <select data-rw-prop="style" value={rw().trayStyle} disabled={locked()} onDblClick={cycleSelectNext}
              onChange={(e) => set({ trayStyle: e.target.value })}>
              <For each={TRAY_STYLES}>{(s) => <option value={s}>{t(`raceway.${s}`)}</option>}</For>
            </select>
          </div>
          <div class="property-group">
            <label>{t('raceway.width')}</label>
            <select data-rw-prop="width" value={String(rw().widthIn)} disabled={locked()} onDblClick={cycleSelectNext}
              onChange={(e) => set({ widthIn: Number(e.target.value) })}>
              <For each={[...new Set([...(TRAY_WIDTHS[rw().trayStyle] || []), rw().widthIn])].sort((a, b) => a - b)}>
                {(w) => <option value={String(w)}>{w}"</option>}</For>
            </select>
          </div>
          <div class="property-group">
            <label>{t('raceway.rail')}</label>
            <select data-rw-prop="rail" value={String(rw().railIn)} disabled={locked()} onDblClick={cycleSelectNext}
              onChange={(e) => set({ railIn: Number(e.target.value) })}>
              <For each={[...new Set([...(RAIL_HEIGHTS[rw().trayStyle] || []), rw().railIn])].sort((a, b) => a - b)}>
                {(h) => <option value={String(h)}>{h}"</option>}</For>
            </select>
          </div>
          <Show when={rw().trayStyle === 'ladder'}>
            <div class="property-group">
              <label>{t('raceway.rung')}</label>
              <input data-rw-prop="rung" type="number" min="1" step="1" value={rw().rungIn} disabled={locked()}
                onChange={(e) => set({ rungIn: Number(e.target.value) })} />
            </div>
          </Show>
        </>
      }>
        <div class="property-group">
          <label>{t('raceway.type')}</label>
          <select data-rw-prop="type" value={rw().conduitType} disabled={locked()} onDblClick={cycleSelectNext}
            onChange={(e) => set({ conduitType: e.target.value })}>
            <For each={CONDUIT_TYPE_IDS}>{(id) => <option value={id}>{CONDUIT_TYPES[id].label}</option>}</For>
          </select>
        </div>
        <div class="property-group">
          <label>{t('raceway.size')}</label>
          <select data-rw-prop="size" value={rw().tradeSize} disabled={locked()} onDblClick={cycleSelectNext}
            onChange={(e) => set({ tradeSize: e.target.value })}>
            <For each={conduitSizes(rw().conduitType)}>{(s) => <option value={s}>{s}"</option>}</For>
          </select>
        </div>
        <div class="property-group">
          <label title={t('raceway.trueSizeTitle')}>
            <input data-rw-prop="trueSize" type="checkbox" checked={rw().trueSize === true} disabled={locked()}
              onChange={(e) => set({ trueSize: e.target.checked })} /> {t('raceway.trueSize')}
          </label>
        </div>
      </Show>
      <div class="property-group">
        <label title={t('raceway.tagTitle')}>{t('raceway.tag')}</label>
        <input data-rw-prop="tag" type="text" maxLength={40} value={rw().tag || ''} disabled={locked()}
          onChange={(e) => set({ tag: e.target.value })} />
      </div>
      <Show when={rw().marks && Object.keys(rw().marks).length}>
        <div class="property-group">
          <label>{t('raceway.marks')}</label>
          <button data-rw-prop="clearMarks" disabled={locked()} onClick={() => set({ marks: {} })}>{t('raceway.clearMarks')}</button>
        </div>
      </Show>
      <div class="property-group">
        <label title={t('raceway.radiusTitle')}>{t('raceway.radius')}</label>
        <input data-rw-prop="radius" type="number" min="0" step="0.5" value={rw().radiusIn ?? ''} placeholder="std"
          disabled={locked()} onChange={(e) => set({ radiusIn: e.target.value === '' ? null : Number(e.target.value) })} />
      </div>
      <Show when={annotProps.measureFittingsText || annotProps.measureBendText}>
        <div class="property-group">
          <label>{t('raceway.angles')}</label>
          <span data-rw-prop="fittings">{annotProps.measureFittingsText}{annotProps.measureBendText ? ` · ${annotProps.measureBendText}` : ''}</span>
        </div>
      </Show>
      <ConduitFillFields />
    </Show>
  );
}
