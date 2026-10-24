import { createSignal, createMemo, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { multiplyScale, multiplySelection, multiplyTargets } from '../../../tools/multiply.js';

const num = (v) => Number(String(v ?? '').trim().replace(',', '.'));
const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Multiply (the external editor): copies of the selected markups in a row. Count and the
 * offset between copies, in page points or, on a calibrated page, in the
 * calibrated unit. Right and down are positive, as on screen.
 */
export default function MultiplyDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const scale = multiplyScale();
  const selectionCount = multiplyTargets().length;
  const units = [{ value: 'pt', label: 'pt' }];
  if (scale.calibrated && scale.unit && scale.unit !== 'pt') units.unshift({ value: scale.unit, label: scale.unit });
  const [unit, setUnit] = createSignal(units[0].value);
  const perUnit = () => (unit() === 'pt' ? 1 : scale.pixelsPerUnit);
  const [count, setCount] = createSignal('1');
  // Default: side by side, one selection width apart.
  const [dx, setDx] = createSignal(String(round((scale.bounds?.width || 20) / perUnit())));
  const [dy, setDy] = createSignal('0');

  const changeUnit = (u) => {
    const before = perUnit();
    setUnit(u);
    const k = before / perUnit();
    if (Number.isFinite(num(dx()))) setDx(String(round(num(dx()) * k)));
    if (Number.isFinite(num(dy()))) setDy(String(round(num(dy()) * k)));
  };

  const valid = createMemo(() => {
    const n = num(count());
    return selectionCount > 0 && Number.isInteger(n) && n >= 1 && n <= 500
      && Number.isFinite(num(dx())) && Number.isFinite(num(dy())) && (num(dx()) !== 0 || num(dy()) !== 0);
  });

  const close = () => closeDialog('multiply');
  const ok = () => {
    if (!valid()) return;
    close();
    multiplySelection({ count: num(count()), dx: num(dx()) * perUnit(), dy: num(dy()) * perUnit() });
  };

  return (
    <Dialog
      title={t('multiply.title')}
      dialogClass="multiply-dialog"
      onClose={close}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={close}>{tCommon('cancel') || 'Cancel'}</button>
          <button class="ai-plan-btn" id="multiply-ok" style="width:auto;padding:5px 16px"
            disabled={!valid()} onClick={ok}>{tCommon('ok') || 'OK'}</button>
        </div>
      }
    >
      <form style="min-width:300px" onSubmit={(e) => { e.preventDefault(); ok(); }}>
        <div style="padding-bottom:6px;opacity:0.85">{t('multiply.selected', { count: selectionCount })}</div>
        <div class="ai-form-field">
          <label>{t('multiply.count')}</label>
          <input type="number" class="ribbon-input" id="multiply-count" min="1" max="500" step="1"
            value={count()} onInput={(e) => setCount(e.currentTarget.value)} style="width:90px" autofocus />
        </div>
        <div class="ai-form-field">
          <label>{t('multiply.offsetX')}</label>
          <div style="display:flex;gap:6px">
            <input type="number" class="ribbon-input" id="multiply-dx" step="any" value={dx()}
              onInput={(e) => setDx(e.currentTarget.value)} style="flex:1" />
            <PrefSelect value={unit} setValue={changeUnit} options={units} style={{ width: '70px' }} />
          </div>
        </div>
        <div class="ai-form-field">
          <label>{t('multiply.offsetY')}</label>
          <input type="number" class="ribbon-input" id="multiply-dy" step="any" value={dy()}
            onInput={(e) => setDy(e.currentTarget.value)} style="width:100%;box-sizing:border-box" />
        </div>
        <Show when={!scale.calibrated}>
          <div style="opacity:0.75;padding-top:2px">{t('multiply.uncalibrated')}</div>
        </Show>
      </form>
    </Dialog>
  );
}
