import { Show, For, createSignal } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  CONDUCTOR_SIZES, INSULATIONS, INSULATION_IDS, MAX_CONDUCTOR_ROWS, conduitFill, smallestConduitFor, fillPercentText,
} from '../../../annotations/conduit-fill.js';

// Conduit fill of a conduit run (annotations/conduit-fill.js, NEC Chapter 9):
// the conductor rows (count, size, insulation), the fill against the Table 1
// limit, and "Size conduit", which sets the run's trade size to the smallest
// size of its type the conductors fit in. Rows live in raceway.conductors.

const sizeLabel = (s) => (s.includes('/') || Number(s) < 100 ? `${s} AWG` : `${s} kcmil`);
const narrow = { flex: '0 0 40px', 'min-width': '0' };
const shrink = { flex: '1 1 0', 'min-width': '0' };
const iconBtn = {
  flex: '0 0 20px', height: '20px', padding: '0', 'font-size': 'var(--ox-fs-sm)', 'line-height': '1',
  'border-radius': 'var(--ox-r-xs)', border: '1px solid var(--theme-border)', background: 'var(--theme-surface)',
  color: 'var(--theme-text-secondary)',
};
const btn = {
  padding: '2px 8px', 'font-size': 'var(--ox-fs-xs)', 'border-radius': 'var(--ox-r-xs)',
  border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text)',
};

export default function ConduitFillFields() {
  const { t } = useTranslation('common');
  const [noFit, setNoFit] = createSignal(false);
  const rw = () => annotProps.raceway || {};
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  // Plain copies: the rows come in through the panel store (proxies).
  const rows = () => (rw().conductors || []).map((c) => ({ count: c.count, size: c.size, insulation: c.insulation }));
  const write = (list) => { setNoFit(false); updateAnnotProp('raceway', { conductors: list }); };
  const change = (i, patch) => write(rows().map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    const last = rows()[rows().length - 1];
    write([...rows(), { count: 1, size: last?.size || '12', insulation: last?.insulation || 'THHN' }]);
  };
  const fill = () => conduitFill(rw(), rows());
  const sizeConduit = () => {
    const size = smallestConduitFor(rw().conduitType, rows());
    setNoFit(!size);
    if (size && size !== rw().tradeSize) updateAnnotProp('raceway', { tradeSize: size });
  };
  return (
    <Show when={rw().kind === 'conduit'}>
      <div class="property-group">
        <label title={t('racewayFill.conductorsTitle')}>{t('racewayFill.conductors')}</label>
        <button data-rw-prop="addConductor" style={btn} title={t('racewayFill.addTitle')}
          disabled={locked() || rows().length >= MAX_CONDUCTOR_ROWS} onClick={add}>{t('racewayFill.add')}</button>
      </div>
      <For each={rows()}>{(r, i) => (
        <div class="property-group" data-rw-conductor={i()}>
          <label />
          <input type="number" min="1" step="1" style={narrow} value={r.count} disabled={locked()}
            title={t('racewayFill.count')} data-rw-prop="conductorCount"
            onChange={(e) => change(i(), { count: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
          <select style={shrink} value={r.size} disabled={locked()} title={t('racewayFill.size')} data-rw-prop="conductorSize"
            onChange={(e) => change(i(), { size: e.target.value })}>
            <For each={CONDUCTOR_SIZES}>{(s) => <option value={s}>{sizeLabel(s)}</option>}</For>
          </select>
          <select style={shrink} value={r.insulation} disabled={locked()}
            title={`${t('racewayFill.insulation')}: ${INSULATIONS[r.insulation]?.label || r.insulation}`}
            data-rw-prop="conductorInsulation" onChange={(e) => change(i(), { insulation: e.target.value })}>
            <For each={INSULATION_IDS}>{(id) => <option value={id} title={INSULATIONS[id].label}>{id}</option>}</For>
          </select>
          <button style={iconBtn} disabled={locked()} title={t('racewayFill.remove')} data-rw-prop="removeConductor"
            onClick={() => write(rows().filter((_, j) => j !== i()))}>×</button>
        </div>
      )}</For>
      <Show when={fill()}>
        {(f) => (
          <div class="property-group">
            <label title={t('racewayFill.fillTitle')}>{t('racewayFill.fill')}</label>
            <span data-rw-prop="fill" title={f().over ? t('racewayFill.over') : undefined} style={{
              flex: '1', 'font-size': 'var(--ox-fs-xs)', 'font-variant-numeric': 'tabular-nums',
              color: f().over ? 'var(--ox-danger)' : 'var(--theme-text)', 'font-weight': f().over ? '600' : '400',
            }}>
              {f().fillPercent == null ? t('racewayFill.noArea')
                : f().over ? `⚠ ${fillPercentText(f())}% > ${f().limitPercent}%`
                  : `${fillPercentText(f())}% (≤${f().limitPercent}%)`}
            </span>
            <button data-rw-prop="sizeConduit" style={btn} title={t('racewayFill.sizeConduitTitle')} disabled={locked()}
              onClick={sizeConduit}>{t('racewayFill.sizeConduit')}</button>
          </div>
        )}
      </Show>
      <Show when={noFit()}>
        <div class="property-group">
          <label />
          <span data-rw-prop="noFit" style={{ 'font-size': 'var(--ox-fs-xs)', color: 'var(--ox-danger)' }}>
            {t('racewayFill.noFit')}</span>
        </div>
      </Show>
    </Show>
  );
}
