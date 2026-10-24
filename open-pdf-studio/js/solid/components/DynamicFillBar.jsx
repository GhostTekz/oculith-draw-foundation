import { Show, For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import {
  options, status, setOptions, toggleOutput, apply, clearFills, clearBoundaries, clearAll, MAX_GAP, MAX_MIN_WEIGHT,
  DEFAULT_FILL_COLOR, DEFAULT_BOUNDARY_COLOR,
} from '../../tools/dynamic-fill/session.js';
import { DYNAMIC_FILL_OUTPUTS } from '../../tools/dynamic-fill/fill-region.js';

// Options bar of the Dynamic Fill tool (J): Fill / Boundary mode, what Apply
// creates (one or more of Space, Area, Perimeter, Polylength, Volume, Polygon), the
// gap tolerance, Apply, and the Clear menu (Clear All / Clear Fill / Clear
// Boundaries). Floats above the status bar while the tool is active;
// mounted on first use by tools/tools/dynamic-fill-tool.js.

const bar = {
  position: 'fixed', left: '50%', bottom: '46px', transform: 'translateX(-50%)',
  display: 'flex', 'align-items': 'center', gap: 'var(--ox-sp-2, 6px)',
  padding: 'var(--ox-sp-1, 4px) var(--ox-sp-2, 8px)',
  background: 'var(--ox-surface-2, #f5f5f5)', color: 'var(--ox-text, #222)',
  border: '1px solid var(--ox-line-2, #888)', 'border-radius': 'var(--ox-r-md, 7px)',
  'box-shadow': 'var(--ox-shadow-2, 0 2px 6px rgba(0,0,0,.3))', 'z-index': 1500,
  'font-family': 'var(--ox-font, inherit)', 'font-size': 'var(--ox-fs-sm, 12px)', 'user-select': 'none',
  'max-width': 'calc(100vw - 32px)', 'flex-wrap': 'nowrap', 'white-space': 'nowrap',
};
const btn = (active, disabled) => ({
  padding: '3px 10px', 'font-size': 'inherit', 'font-family': 'inherit', cursor: disabled ? 'default' : 'pointer',
  border: `1px solid ${active ? 'var(--ox-accent, #2f7cf6)' : 'var(--ox-line-2, #999)'}`,
  background: active ? 'var(--ox-accent-soft, #dbe8ff)' : 'var(--ox-surface-1, #fff)',
  color: 'var(--ox-text, #222)', 'border-radius': 'var(--ox-r-xs, 3px)', opacity: disabled ? 0.45 : 1,
});
const field = {
  'font-size': 'inherit', 'font-family': 'inherit', color: 'var(--ox-text, #222)',
  background: 'var(--ox-surface-1, #fff)', border: '1px solid var(--ox-line-2, #999)',
  'border-radius': 'var(--ox-r-xs, 3px)', padding: '2px 4px',
};
const sep = { width: '1px', 'align-self': 'stretch', background: 'var(--ox-line, #ccc)' };
const keep = (e) => e.preventDefault(); // buttons keep keyboard focus on the canvas

export default function DynamicFillBar() {
  const { t } = useTranslation('common');
  const o = () => options();
  const s = () => status();
  const [clearOpen, setClearOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const popover = {
    position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, padding: '6px 8px',
    background: 'var(--ox-surface-2, #f5f5f5)', border: '1px solid var(--ox-line-2, #888)',
    'border-radius': 'var(--ox-r-sm, 5px)', 'box-shadow': 'var(--ox-shadow-2, 0 2px 6px rgba(0,0,0,.3))',
    display: 'flex', 'flex-direction': 'column', gap: '6px', 'min-width': '210px',
  };
  const row = { display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '8px' };
  const anything = () => s().fills || s().boundaries || s().drafting;
  const menuItem = (key, enabled, run) => (
    <button data-df={key} role="menuitem" disabled={!enabled}
      style={{ ...btn(false, !enabled), border: 'none', 'text-align': 'left', width: '100%', background: 'transparent' }}
      title={t(`dynamicFill.${key}Title`)} onMouseDown={keep}
      onClick={() => { if (enabled) run(); setClearOpen(false); }}>{t(`dynamicFill.${key}`)}</button>
  );
  const info = () => {
    if (s().busy) return t('dynamicFill.busy');
    if (s().message) return t(`dynamicFill.messages.${s().message}`);
    const parts = [];
    if (s().fills) parts.push(t('dynamicFill.fills', { count: s().fills }));
    if (s().boundaries) parts.push(t('dynamicFill.boundaries', { count: s().boundaries }));
    return parts.length ? parts.join(' · ') : t('dynamicFill.ready');
  };
  return (
    <Show when={state.currentTool === 'dynamicFill'}>
      <div class="dynamic-fill-bar" role="toolbar" aria-label={t('dynamicFill.title')} style={bar}>
        <button data-df="fill" style={btn(o().mode === 'fill')} title={t('dynamicFill.fillTitle')}
          aria-pressed={o().mode === 'fill'} onMouseDown={keep}
          onClick={() => setOptions({ mode: 'fill' })}>{t('dynamicFill.fill')}</button>
        <button data-df="boundary" style={btn(o().mode === 'boundary')} title={t('dynamicFill.boundaryTitle')}
          aria-pressed={o().mode === 'boundary'} onMouseDown={keep}
          onClick={() => setOptions({ mode: 'boundary' })}>{t('dynamicFill.boundary')}</button>
        <span style={sep} />
        <span style={{ display: 'flex', 'align-items': 'center', gap: '3px' }} role="group"
          aria-label={t('dynamicFill.output')}>
          {t('dynamicFill.output')}
          <For each={DYNAMIC_FILL_OUTPUTS}>{(id) => (
            <button data-df-output={id} style={{ ...btn(o().outputs.includes(id)), padding: '3px 7px' }}
              title={t('dynamicFill.outputTitle')} aria-pressed={o().outputs.includes(id)} onMouseDown={keep}
              onClick={() => toggleOutput(id)}>{t(`dynamicFill.outputs.${id}`)}</button>
          )}</For>
          <Show when={o().outputs.includes('space')}>
            <input data-df="spaceName" type="text" maxLength={80} style={{ ...field, width: '96px' }}
              placeholder={t('dynamicFill.spaceDefault')} title={t('dynamicFill.spaceNameTitle')}
              aria-label={t('dynamicFill.spaceName')} value={o().spaceName}
              onInput={(e) => setOptions({ spaceName: e.currentTarget.value })} />
          </Show>
        </span>
        <label style={{ display: 'flex', 'align-items': 'center', gap: '4px' }} title={t('dynamicFill.gapTitle')}>
          {t('dynamicFill.gap')}
          <input data-df="gap" type="number" min="0" max={MAX_GAP} step="1" style={{ ...field, width: '52px' }}
            value={o().gap} onChange={(e) => setOptions({ gap: e.currentTarget.value })} />
          {t('pt')}
        </label>
        <span style={sep} />
        <span data-df="status" style={{ color: 'var(--ox-text-2, #555)', 'white-space': 'nowrap', 'max-width': '220px', overflow: 'hidden', 'text-overflow': 'ellipsis' }}
          title={info()}>{info()}</span>
        <button data-df="apply" style={{ ...btn(false, !s().fills), 'font-weight': 600 }} title={t('dynamicFill.applyTitle')}
          disabled={!s().fills} onMouseDown={keep} onClick={() => apply()}>{t('dynamicFill.apply')}</button>
        <span style={{ position: 'relative' }}>
          <button data-df="clear" style={btn(clearOpen(), !anything())} title={t('dynamicFill.clearTitle')}
            aria-haspopup="menu" aria-expanded={clearOpen()} disabled={!anything()} onMouseDown={keep}
            onClick={() => { setSettingsOpen(false); setClearOpen(!clearOpen()); }}>{t('dynamicFill.clear')} ▾</button>
          <Show when={clearOpen() && anything()}>
            <div role="menu" aria-label={t('dynamicFill.clearMenuTitle')} style={{
              position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, 'min-width': '150px', padding: '3px',
              background: 'var(--ox-surface-2, #f5f5f5)', border: '1px solid var(--ox-line-2, #888)',
              'border-radius': 'var(--ox-r-sm, 5px)', 'box-shadow': 'var(--ox-shadow-2, 0 2px 6px rgba(0,0,0,.3))',
              display: 'flex', 'flex-direction': 'column',
            }}>
              {menuItem('clearAll', anything(), clearAll)}
              {menuItem('clearFill', s().fills > 0, clearFills)}
              {menuItem('clearBoundaries', s().boundaries > 0 || s().drafting, clearBoundaries)}
            </div>
          </Show>
        </span>
        <span style={{ position: 'relative' }}>
          <button data-df="settings" style={btn(settingsOpen())} title={t('dynamicFill.settingsTitle')}
            aria-label={t('dynamicFill.settingsTitle')} aria-haspopup="dialog" aria-expanded={settingsOpen()}
            onMouseDown={keep} onClick={() => { setClearOpen(false); setSettingsOpen(!settingsOpen()); }}>⚙</button>
          <Show when={settingsOpen()}>
            <div role="dialog" aria-label={t('dynamicFill.settingsTitle')} style={popover}>
              <label style={row}>{t('dynamicFill.fillColor')}
                <input data-df="fillColor" type="color" value={o().fillColor}
                  onInput={(e) => setOptions({ fillColor: e.currentTarget.value })} /></label>
              <label style={row}>{t('dynamicFill.boundaryColor')}
                <input data-df="boundaryColor" type="color" value={o().boundaryColor}
                  onInput={(e) => setOptions({ boundaryColor: e.currentTarget.value })} /></label>
              <label style={row} title={t('dynamicFill.minWeightTitle')}>{t('dynamicFill.minWeight')}
                <span style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
                  <input data-df="minWeight" type="number" min="0" max={MAX_MIN_WEIGHT} step="0.05"
                    style={{ ...field, width: '56px' }} value={o().minWeight}
                    onChange={(e) => setOptions({ minWeight: e.currentTarget.value })} />{t('pt')}
                </span></label>
              <label style={{ ...row, 'justify-content': 'flex-start' }} title={t('dynamicFill.hideMarkupsTitle')}>
                <input data-df="hideMarkups" type="checkbox" checked={o().hideMarkups}
                  onChange={(e) => setOptions({ hideMarkups: e.currentTarget.checked })} />
                {t('dynamicFill.hideMarkups')}</label>
              <button style={btn(false)} onMouseDown={keep}
                onClick={() => setOptions({ fillColor: DEFAULT_FILL_COLOR, boundaryColor: DEFAULT_BOUNDARY_COLOR, hideMarkups: false, minWeight: 0 })}>
                {t('dynamicFill.resetSettings')}</button>
            </div>
          </Show>
        </span>
        <button data-df="close" style={btn(false)} title={t('dynamicFill.closeTitle')} aria-label={t('dynamicFill.closeTitle')}
          onMouseDown={keep}
          onClick={() => import('../../tools/manager.js').then((m) => m.setTool('select'))}>✕</button>
      </div>
    </Show>
  );
}

let mounted = false;
/** Mount the bar once into the document body. */
export function mountDynamicFillBar() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const host = document.createElement('div');
  host.id = 'dynamic-fill-bar-host';
  document.body.appendChild(host);
  render(() => <DynamicFillBar />, host);
}
