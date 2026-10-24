import { createSignal, onMount, onCleanup, For } from 'solid-js';
import { state } from '../../../core/state.js';
import { applyTheme, savePreferences } from '../../../core/preferences.js';
import { currentTheme } from '../../stores/ribbonStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const THEME_OPTIONS = [
  { value: 'default', label: 'Oculith Dark', swatches: ['#08080a', '#111115', '#ff7a00', '#f5f5f4'] },
  { value: 'light', labelKey: 'theme.light', swatches: ['#ecebe8', '#fbfaf9', '#ff7a00', '#18171a'] },
  { value: 'warm-ember', labelKey: 'theme.warmEmber', swatches: ['#3E3636', '#4a4242', '#D97706', '#F5F0EB'] },
  { value: 'highContrast', labelKey: 'theme.highContrast', swatches: ['#000000', '#0a0a0a', '#ffff00', '#ffffff'] },
];

export default function ThemePicker() {
  const { t } = useTranslation('ribbon');
  const [open, setOpen] = createSignal(false);
  let pickerRef;

  onMount(() => {
    const handler = (e) => {
      if (pickerRef && !pickerRef.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handler);
    onCleanup(() => document.removeEventListener('click', handler));
  });

  const getLabel = () => {
    const theme = currentTheme();
    const option = THEME_OPTIONS.find(t => t.value === theme);
    return option ? (option.label || t(option.labelKey)) : t('theme.dark');
  };

  const getSwatches = () => {
    const theme = currentTheme();
    return THEME_OPTIONS.find(t => t.value === theme)?.swatches || THEME_OPTIONS[2].swatches;
  };

  function selectTheme(option) {
    state.preferences.theme = option.value;
    applyTheme(option.value);
    savePreferences();
    setOpen(false);
  }

  return (
    <div class="ribbon-input-group" style={{ 'justify-content': 'center' }}>
      <label class="ribbon-input-label">{t('theme.label')}</label>
      <div class="theme-picker" id="theme-picker" ref={pickerRef}>
        <button
          class="theme-picker-toggle"
          id="theme-picker-toggle"
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}
        >
          <span class="theme-picker-swatches">
            <For each={getSwatches()}>
              {(color) => <span class="theme-swatch" style={{ background: color }}></span>}
            </For>
          </span>
          <span class="theme-picker-label">{getLabel()}</span>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="10" height="10">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <div class={`theme-picker-dropdown${open() ? ' open' : ''}`} id="theme-picker-dropdown" onClick={(e) => e.stopPropagation()}>
          <For each={THEME_OPTIONS}>
            {(option) => (
              <div
                class={`theme-picker-option${option.value === currentTheme() ? ' selected' : ''}`}
                data-theme-value={option.value}
                onClick={() => selectTheme(option)}
              >
                <span class="theme-picker-option-swatches">
                  <For each={option.swatches}>
                    {(color) => <span class="theme-swatch" style={{ background: color }}></span>}
                  </For>
                </span>
                <span class="theme-picker-option-label">{option.label || t(option.labelKey)}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
