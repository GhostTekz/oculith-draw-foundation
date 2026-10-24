import { Show, For } from 'solid-js';
import { render } from 'solid-js/web';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { settings, setSettings, drawing } from '../../tools/raceway/session.js';
import {
  CONDUIT_TYPES, CONDUIT_TYPE_IDS, conduitSizes, TRAY_STYLES, TRAY_WIDTHS, RAIL_HEIGHTS, BEND_ANGLES,
} from '../../annotations/raceway.js';

// Options bar of the raceway tool: conduit (type, trade size, true size) or
// cable tray (ladder / basket, width, rail height, rung spacing), the elbow
// radius, corner snapping and its angles, and the live run label. Floats
// above the status bar while the tool is active; mounted on first use by
// tools/tools/raceway-tool.js.

const bar = {
  position: 'fixed', left: '50%', bottom: '46px', transform: 'translateX(-50%)',
  display: 'flex', 'align-items': 'center', gap: 'var(--ox-sp-2, 6px)',
  padding: 'var(--ox-sp-1, 4px) var(--ox-sp-2, 8px)',
  background: 'var(--ox-surface-2, #f5f5f5)', color: 'var(--ox-text, #222)',
  border: '1px solid var(--ox-line-2, #888)', 'border-radius': 'var(--ox-r-md, 7px)',
  'box-shadow': 'var(--ox-shadow-2, 0 2px 6px rgba(0,0,0,.3))', 'z-index': 1500,
  'font-family': 'var(--ox-font, inherit)', 'font-size': 'var(--ox-fs-sm, 12px)', 'user-select': 'none',
  'max-width': 'calc(100vw - 32px)', 'white-space': 'nowrap',
};
const btn = (active) => ({
  padding: '3px 8px', 'font-size': 'inherit', 'font-family': 'inherit', cursor: 'pointer',
  border: `1px solid ${active ? 'var(--ox-accent, #2f7cf6)' : 'var(--ox-line-2, #999)'}`,
  background: active ? 'var(--ox-accent-soft, #dbe8ff)' : 'var(--ox-surface-1, #fff)',
  color: 'var(--ox-text, #222)', 'border-radius': 'var(--ox-r-xs, 3px)',
});
const field = {
  'font-size': 'inherit', 'font-family': 'inherit', color: 'var(--ox-text, #222)',
  background: 'var(--ox-surface-1, #fff)', border: '1px solid var(--ox-line-2, #999)',
  'border-radius': 'var(--ox-r-xs, 3px)', padding: '2px 4px',
};
const sep = { width: '1px', 'align-self': 'stretch', background: 'var(--ox-line, #ccc)' };
const label = { display: 'flex', 'align-items': 'center', gap: '4px' };
const keep = (e) => e.preventDefault();

export default function RacewayBar() {
  const { t } = useTranslation('common');
  const s = () => settings();
  const c = () => s().conduit;
  const tr = () => s().tray;
  // A branch run says which run it starts on: 'Branch from 24" Ladder tray, 4" rail · …'.
  const status = () => {
    const d = drawing();
    const base = d.text || (d.points ? t('raceway.drawing', { count: d.points }) : (d.branch ? '' : t('raceway.hint')));
    return d.branch ? [t('raceway.branchFrom', { name: d.branch }), base].filter(Boolean).join(' · ') : base;
  };
  const radiusField = (rw, kind) => (
    <label style={label} title={t('raceway.radiusTitle')}>{t('raceway.radius')}
      <input data-rw="radius" type="number" min="0" step="0.5" style={{ ...field, width: '52px' }}
        value={rw().radiusIn ?? ''} placeholder="std"
        onChange={(e) => setSettings({ [kind]: { radiusIn: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) } })} />
      {t('raceway.in')}</label>
  );
  return (
    <Show when={state.currentTool === 'raceway'}>
      <div class="raceway-bar" role="toolbar" aria-label={t('raceway.title')} style={bar}>
        <button data-rw="kind-conduit" style={btn(s().kind === 'conduit')} aria-pressed={s().kind === 'conduit'}
          onMouseDown={keep} onClick={() => setSettings({ kind: 'conduit' })}>{t('raceway.conduit')}</button>
        <button data-rw="kind-tray" style={btn(s().kind === 'tray')} aria-pressed={s().kind === 'tray'}
          onMouseDown={keep} onClick={() => setSettings({ kind: 'tray' })}>{t('raceway.tray')}</button>
        <span style={sep} />
        <Show when={s().kind === 'conduit'} fallback={
          <>
            <For each={TRAY_STYLES}>{(style) => (
              <button data-rw={`style-${style}`} style={btn(tr().trayStyle === style)} aria-pressed={tr().trayStyle === style}
                onMouseDown={keep} onClick={() => setSettings({ tray: { trayStyle: style } })}>{t(`raceway.${style}`)}</button>
            )}</For>
            <label style={label}>{t('raceway.width')}
              <select data-rw="width" style={field} value={String(tr().widthIn)}
                onChange={(e) => setSettings({ tray: { widthIn: Number(e.currentTarget.value) } })}>
                <For each={TRAY_WIDTHS[tr().trayStyle]}>{(w) => <option value={String(w)}>{w}"</option>}</For>
              </select></label>
            <label style={label}>{t('raceway.rail')}
              <select data-rw="rail" style={field} value={String(tr().railIn)}
                onChange={(e) => setSettings({ tray: { railIn: Number(e.currentTarget.value) } })}>
                <For each={RAIL_HEIGHTS[tr().trayStyle]}>{(h) => <option value={String(h)}>{h}"</option>}</For>
              </select></label>
            <Show when={tr().trayStyle === 'ladder'}>
              <label style={label}>{t('raceway.rung')}
                <select data-rw="rung" style={field} value={String(tr().rungIn)}
                  onChange={(e) => setSettings({ tray: { rungIn: Number(e.currentTarget.value) } })}>
                  <For each={[6, 9, 12, 18]}>{(r) => <option value={String(r)}>{r}"</option>}</For>
                </select></label>
            </Show>
            {radiusField(tr, 'tray')}
          </>
        }>
          <label style={label}>{t('raceway.type')}
            <select data-rw="type" style={field} value={c().conduitType}
              onChange={(e) => setSettings({ conduit: { conduitType: e.currentTarget.value } })}>
              <For each={CONDUIT_TYPE_IDS}>{(id) => <option value={id}>{CONDUIT_TYPES[id].label}</option>}</For>
            </select></label>
          <label style={label}>{t('raceway.size')}
            <select data-rw="size" style={field} value={c().tradeSize}
              onChange={(e) => setSettings({ conduit: { tradeSize: e.currentTarget.value } })}>
              <For each={conduitSizes(c().conduitType)}>{(size) => <option value={size}>{size}"</option>}</For>
            </select></label>
          <label style={label} title={t('raceway.trueSizeTitle')}>
            <input data-rw="trueSize" type="checkbox" checked={c().trueSize}
              onChange={(e) => setSettings({ conduit: { trueSize: e.currentTarget.checked } })} />
            {t('raceway.trueSize')}</label>
          {radiusField(c, 'conduit')}
        </Show>
        <span style={sep} />
        <label style={label} title={t('raceway.snapTitle')}>
          <input data-rw="snap" type="checkbox" checked={s().snapBends}
            onChange={(e) => setSettings({ snapBends: e.currentTarget.checked })} />
          {t('raceway.snap')}</label>
        <span style={{ display: 'flex', gap: '2px' }} role="group" aria-label={t('raceway.angles')}>
          <For each={BEND_ANGLES}>{(a) => (
            <button data-rw-angle={a} style={{ ...btn(s().angles.includes(a)), padding: '3px 5px' }}
              aria-pressed={s().angles.includes(a)} onMouseDown={keep}
              onClick={() => setSettings({ angles: s().angles.includes(a) ? s().angles.filter((x) => x !== a) : [...s().angles, a] })}>
              {a}°</button>
          )}</For>
        </span>
        <span style={sep} />
        <span style={{ display: 'flex', gap: '2px' }} role="group" aria-label={t('raceway.markTitle')} title={t('raceway.markTitle')}>
          <For each={[['pull', 'raceway.pull'], ['up', 'raceway.up'], ['down', 'raceway.down']]}>{([kind, key]) => {
            const lastMark = () => drawing().marks?.[drawing().points - 1];
            return (
              <button data-rw-mark={kind} style={{ ...btn(lastMark() === kind), padding: '3px 6px', opacity: drawing().points ? 1 : 0.45 }}
                aria-pressed={lastMark() === kind} disabled={!drawing().points} onMouseDown={keep}
                onClick={() => import('../../tools/tools/raceway-tool.js').then((m) => m.markLastPoint(kind))}>{t(key)}</button>
            );
          }}</For>
        </span>
        <label style={label} title={t('raceway.tagTitle')}>{t('raceway.tag')}
          <input data-rw="tag" type="text" maxLength={40} style={{ ...field, width: '64px' }} value={s().tag}
            onInput={(e) => setSettings({ tag: e.currentTarget.value })} /></label>
        <span style={sep} />
        {/* No scale at the cursor: tray is drawn schematically (not to size) and
            lengths stay in page points; Set Scale fixes both. */}
        <Show when={drawing().noScale}>
          <button data-rw="no-scale" title={t('raceway.noScaleTitle')}
            style={{ ...btn(false), color: 'var(--ox-danger, #c92a2a)', 'border-color': 'var(--ox-danger, #c92a2a)' }}
            onMouseDown={keep}
            onClick={() => import('../../annotations/measurement.js').then((m) => m.showSetScaleDialog(drawing().page || undefined))}>
            ⚠ {t('raceway.noScale')}</button>
        </Show>
        <span data-rw="status" title={status()} style={{ color: 'var(--ox-text-2, #555)', 'max-width': '340px', overflow: 'hidden', 'text-overflow': 'ellipsis' }}>
          {status()}</span>
        <button data-rw="close" style={btn(false)} title={t('raceway.closeTitle')} aria-label={t('raceway.closeTitle')}
          onMouseDown={keep} onClick={() => import('../../tools/manager.js').then((m) => m.setTool('select'))}>✕</button>
      </div>
    </Show>
  );
}

let mounted = false;
/** Mount the bar once into the document body. */
export function mountRacewayBar() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const host = document.createElement('div');
  host.id = 'raceway-bar-host';
  document.body.appendChild(host);
  render(() => <RacewayBar />, host);
}
