import { For, Show, createSignal, createEffect } from 'solid-js';
import { listCountSymbols } from '../../../symbols/count-symbols.js';
import { drawCountSymbolMarker, COUNT_SYMBOL_SIZE } from '../../../annotations/count-marker.js';
import { saveSymbolCountPreset } from '../../../tools/tool-chest-presets.js';
import { COUNT_CATEGORY_NAME_LIMIT } from '../../../tools/tool-preset-count.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const PREVIEW = 26;

/** A count symbol drawn by the same function as the canvas and the saved PDF. */
export function CountSymbolPreview(props) {
  const box = () => props.size || PREVIEW;
  const paint = (canvas) => {
    const ratio = globalThis.devicePixelRatio || 1;
    canvas.width = box() * ratio;
    canvas.height = box() * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    drawCountSymbolMarker(ctx, { type: 'count', markerStyle: 'symbol', symbolId: props.symbolId,
      x: box() / 2, y: box() / 2, symbolSize: Math.max(8, box() - 4), color: props.color, showNumber: false });
  };
  let canvas;
  createEffect(() => { props.color; props.symbolId; if (canvas) paint(canvas); });
  return <canvas class="scp-preview" aria-hidden="true" style={{ width: `${box()}px`, height: `${box()}px` }}
    ref={(el) => { canvas = el; paint(el); }} />;
}

// Tool Chest: create a symbol count tool (the external editor count tool with a symbol):
// symbol, size, colour, category and whether numbers show.
export default function SymbolCountPresetForm(props) {
  const { t, language } = useTranslation('common');
  const symbols = listCountSymbols();
  const label = (s) => (String(language() || '').startsWith('nl') ? s.label : s.labelEn);
  const [symbolId, setSymbolId] = createSignal(symbols[0].id);
  const [size, setSize] = createSignal(COUNT_SYMBOL_SIZE.default);
  const [color, setColor] = createSignal('#e11d48');
  const [category, setCategory] = createSignal('');
  const [showNumber, setShowNumber] = createSignal(true);
  const [name, setName] = createSignal('');
  const [error, setError] = createSignal('');
  const current = () => symbols.find(s => s.id === symbolId()) || symbols[0];
  const categoryName = () => category().trim() || label(current());
  const save = () => {
    const preset = saveSymbolCountPreset({ symbolId: symbolId(), symbolSize: Number(size()), color: color(),
      countCategory: categoryName(), showNumber: showNumber() }, name().trim() || categoryName(), props.setId);
    if (!preset) { setError(t('symbolCountPresets.error')); return; }
    props.onDone?.(preset);
  };
  return (
    <form class="sp-my-tools-form tc-inline-form scp-form" aria-label={t('symbolCountPresets.title')}
      onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div class="scp-heading">{t('symbolCountPresets.title')}</div>
      <div class="scp-grid" role="radiogroup" aria-label={t('symbolCountPresets.symbol')}>
        <For each={symbols}>{(s) => (
          <button type="button" role="radio" class={`scp-symbol${symbolId() === s.id ? ' active' : ''}`}
            aria-checked={symbolId() === s.id} title={label(s)} aria-label={label(s)}
            onClick={() => setSymbolId(s.id)}>
            <CountSymbolPreview symbolId={s.id} color={color()} />
          </button>
        )}</For>
      </div>
      <label class="scp-field">{t('symbolCountPresets.category')}
        <input maxLength={COUNT_CATEGORY_NAME_LIMIT} value={category()} placeholder={label(current())}
          title={t('symbolCountPresets.categoryHint')}
          onInput={(e) => { setCategory(e.currentTarget.value); setError(''); }} />
      </label>
      <label class="scp-field scp-narrow">{t('symbolCountPresets.size')}
        <input type="number" min={COUNT_SYMBOL_SIZE.min} max={COUNT_SYMBOL_SIZE.max} step="1" value={size()}
          onInput={(e) => setSize(e.currentTarget.value)} />
      </label>
      <label class="scp-field scp-narrow">{t('symbolCountPresets.color')}
        <input type="color" value={color()} onInput={(e) => setColor(e.currentTarget.value)} />
      </label>
      <label class="sp-my-tools-text-choice">
        <input type="checkbox" checked={showNumber()} onChange={(e) => setShowNumber(e.currentTarget.checked)} />
        {t('symbolCountPresets.showNumber')}
      </label>
      <label class="scp-field">{t('symbolCountPresets.name')}
        <input maxLength="80" value={name()} placeholder={categoryName()}
          onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <p class="scp-hint">{t('symbolCountPresets.categoryHint')}</p>
      <button type="submit">{t('symbolCountPresets.save')}</button>
      <button type="button" onClick={() => props.onCancel?.()}>{t('symbolCountPresets.cancel')}</button>
      <Show when={error()}><p class="sp-tool-set-error" role="alert">{error()}</p></Show>
    </form>
  );
}
