import { createSignal, createMemo, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, getDialogs } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  allLineStyles, saveUserLineStyle, deleteUserLineStyle, duplicateLineStyle, newBlankLineStyle,
  exportLineStyleSet, importLineStyleSet, importedHatchPatterns, importPatFile, deleteImportedHatchPattern,
} from '../../stores/lineStylesStore.js';
import { cleanLineStyle, SYMBOL_SHAPES, MAX_LINE_STYLE_SET_BYTES, MAX_STYLE_LINES, MAX_STYLE_MARKS } from '../../../annotations/line-styles.js';
import { MAX_PAT_FILE_BYTES } from '../../../annotations/pat-import.js';
import { getHatchSwatchDataUrl } from '../../../annotations/rendering/hatch-patterns.js';
import { isTauri, openFileDialog, saveFileDialog, readBinaryFile, writeBinaryFile } from '../../../core/platform.js';
import LineStylePreview from './LineStylePreview.jsx';
import { lineStyleLabel } from './LineStylePicker.jsx';

const DIALOG = 'line-styles';

// "18 -4 4 -4" ⇄ [18, -4, 4, -4]
const dashText = (dash) => (dash || []).join(' ');
const parseDash = (text) => String(text || '').split(/[\s,;]+/u).filter(Boolean).map(Number).filter(Number.isFinite);
const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));

async function pickFileBytes(extensions, maxBytes) {
  const picked = await openFileDialog(extensions, { maxBytes });
  if (!picked) return null;
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (isTauri() && window.__TAURI__?.fs?.stat) {
    const meta = await window.__TAURI__.fs.stat(path);
    if (meta.size > maxBytes) throw new Error(`The file exceeds ${maxBytes} bytes.`);
  }
  const bytes = await readBinaryFile(path);
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

// Line Style manager (the external editor Line Style editor parity): the built-in set
// (read-only, duplicate to change), the user's styles (create, edit,
// duplicate, delete), style-set JSON import/export, and the imported .PAT
// hatch patterns. Movable; an outside click does not close it (Dialog.jsx).
export default function LineStyleManagerDialog() {
  const { t } = useTranslation('common');
  const data = () => getDialogs().find(d => d.name === DIALOG)?.data || {};
  const [tab, setTab] = createSignal('styles');
  const [selectedId, setSelectedId] = createSignal(data().selectId || 'gas');
  const [draft, setDraft] = createSignal(null);
  const [message, setMessage] = createSignal('');
  const [error, setError] = createSignal('');
  const [patUnit, setPatUnit] = createSignal('mm');

  const styles = () => allLineStyles();
  const selected = createMemo(() => styles().find(s => s.id === selectedId()) || null);
  // The editor works on a draft of a user style; built-ins are read-only.
  const editing = () => draft() || selected();
  const readOnly = () => !draft() && !!selected()?.builtin;
  const dirty = () => !!draft() && JSON.stringify(cleanLineStyle(draft())) !== JSON.stringify(cleanLineStyle(selected()));

  const say = (msg) => { setError(''); setMessage(msg); };
  const fail = (err) => { setMessage(''); setError(err?.message || String(err)); };

  const select = (id) => { setDraft(null); setSelectedId(id); say(''); };
  const edit = (patch) => {
    const base = draft() || (selected()?.builtin ? null : selected());
    if (!base) return;
    setDraft({ ...structuredClone(base), ...patch });
  };
  const editLine = (i, patch) => {
    const lines = editing().lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    edit({ lines });
  };
  const editMark = (i, patch) => {
    const marks = editing().marks.map((m, j) => (j === i ? { ...m, ...patch } : m));
    edit({ marks });
  };

  const create = () => {
    const style = saveUserLineStyle(newBlankLineStyle(t('lineStyles.newName')));
    if (style) { select(style.id); say(t('lineStyles.created')); }
  };
  const duplicate = () => {
    const copy = duplicateLineStyle(selectedId(), t('lineStyles.copySuffix'));
    if (copy) { select(copy.id); say(t('lineStyles.duplicated')); }
  };
  const remove = () => {
    const s = selected();
    if (!s || s.builtin) return;
    if (deleteUserLineStyle(s.id)) { select('gas'); say(t('lineStyles.deleted')); }
  };
  const save = () => {
    const clean = cleanLineStyle(draft());
    if (!clean) { fail(new Error(t('lineStyles.invalid'))); return; }
    if (saveUserLineStyle(clean)) { setDraft(null); say(t('lineStyles.saved')); }
  };
  const exportSet = async () => {
    try {
      const bytes = exportLineStyleSet('OcuDraw line styles', null);
      const path = await saveFileDialog('line-styles.ocudraw-lines.json', [{ name: 'OcuDraw line styles', extensions: ['json'] }]);
      if (!path) return;
      await writeBinaryFile(path, bytes);
      say(t('lineStyles.exported'));
    } catch (e) { fail(e); }
  };
  const importSet = async () => {
    try {
      const bytes = await pickFileBytes(['json'], MAX_LINE_STYLE_SET_BYTES);
      if (!bytes) return;
      const { added, skipped } = importLineStyleSet(bytes);
      say(t('lineStyles.imported', { count: added.length, skipped }));
      if (added[0]) select(added[0].id);
    } catch (e) { fail(e); }
  };
  const importPat = async () => {
    try {
      const bytes = await pickFileBytes(['pat', 'PAT'], MAX_PAT_FILE_BYTES);
      if (!bytes) return;
      const { added, warnings } = importPatFile(bytes, patUnit());
      if (!added.length) throw new Error(warnings[0] || t('lineStyles.patNone'));
      say(t('lineStyles.patImported', { count: added.length, names: added.map(p => p.name).join(', ') })
        + (warnings.length ? ` ${t('lineStyles.patWarnings', { count: warnings.length })}` : ''));
    } catch (e) { fail(e); }
  };

  const close = () => closeDialog(DIALOG);
  const footer = (
    <>
      <div class="ls-footer-msg" role="status">
        <Show when={error()}><span class="ls-error">{error()}</span></Show>
        <Show when={!error() && message()}><span>{message()}</span></Show>
      </div>
      <button class="pref-btn pref-btn-secondary" onClick={close}>{t('close')}</button>
    </>
  );

  return (
    <Dialog title={t('lineStyles.title')} dialogClass="ls-dialog" bodyClass="ls-body" footerClass="ls-footer"
      onClose={close} footer={footer}>
      <div class="ls-tabs" role="tablist">
        <button role="tab" class="ls-tab" classList={{ active: tab() === 'styles' }} aria-selected={tab() === 'styles'}
          onClick={() => setTab('styles')}>{t('lineStyles.tabStyles')}</button>
        <button role="tab" class="ls-tab" classList={{ active: tab() === 'hatch' }} aria-selected={tab() === 'hatch'}
          onClick={() => setTab('hatch')}>{t('lineStyles.tabHatch')}</button>
      </div>

      <Show when={tab() === 'styles'}>
        <div class="ls-layout">
          <div class="ls-list" role="listbox" aria-label={t('lineStyles.tabStyles')}>
            <For each={styles()}>{(s) => (
              <div class="ls-list-row" role="option" aria-selected={s.id === selectedId()}
                classList={{ active: s.id === selectedId() }} onClick={() => select(s.id)}>
                <span class="ls-list-name">{lineStyleLabel(t, s)}<Show when={s.builtin}>
                  <span class="ls-badge">{t('lineStyles.builtinBadge')}</span></Show></span>
                <LineStylePreview style={s} width={150} height={20} />
              </div>
            )}</For>
          </div>
          <div class="ls-editor">
            <div class="ls-actions">
              <button class="pref-btn" onClick={create}>{t('lineStyles.new')}</button>
              <button class="pref-btn" disabled={!selected()} onClick={duplicate}>{t('duplicate')}</button>
              <button class="pref-btn" disabled={!selected() || selected().builtin} onClick={remove}>{t('delete')}</button>
              <span class="ls-spacer" />
              <button class="pref-btn" onClick={importSet}>{t('lineStyles.importSet')}</button>
              <button class="pref-btn" onClick={exportSet}>{t('lineStyles.exportSet')}</button>
            </div>
            <Show when={editing()}>
              <div class="ls-preview-box">
                <LineStylePreview style={editing} width={360} height={70} />
              </div>
              <Show when={readOnly()}>
                <p class="ls-hint">{t('lineStyles.readOnlyHint')}</p>
              </Show>
              <fieldset class="ls-fields" disabled={readOnly()}>
                <div class="ls-row">
                  <label for="ls-name">{t('lineStyles.name')}</label>
                  <input id="ls-name" type="text" maxLength={64} value={readOnly() ? lineStyleLabel(t, editing()) : editing().name}
                    onInput={(e) => edit({ name: e.target.value })} />
                  <label class="ls-check">
                    <input type="checkbox" checked={editing().scaleWithWidth}
                      onChange={(e) => edit({ scaleWithWidth: e.target.checked })} />
                    {t('lineStyles.scaleWithWidth')}
                  </label>
                </div>

                <div class="ls-section-head">
                  <span>{t('lineStyles.lines')}</span>
                  <button class="pref-btn ls-small" disabled={editing().lines.length >= MAX_STYLE_LINES}
                    onClick={() => edit({ lines: [...editing().lines, { offset: 0, dash: [], width: 1 }] })}>{t('lineStyles.addLine')}</button>
                </div>
                <table class="ls-table">
                  <thead><tr>
                    <th>{t('lineStyles.offset')}</th><th>{t('lineStyles.dashPattern')}</th>
                    <th>{t('lineStyles.widthFactor')}</th><th />
                  </tr></thead>
                  <tbody>
                    <For each={editing().lines}>{(line, i) => (
                      <tr>
                        <td><input type="number" step="0.5" min="-50" max="50" value={line.offset}
                          onChange={(e) => editLine(i(), { offset: Number(e.target.value) })} /></td>
                        <td><input type="text" class="ls-dash" value={dashText(line.dash)} placeholder={t('lineStyles.solid')}
                          title={t('lineStyles.dashHint')}
                          onChange={(e) => editLine(i(), { dash: parseDash(e.target.value) })} /></td>
                        <td><input type="number" step="0.25" min="0.1" max="10" value={line.width}
                          onChange={(e) => editLine(i(), { width: Number(e.target.value) })} /></td>
                        <td><button class="pref-btn ls-small" aria-label={t('delete')} title={t('delete')}
                          onClick={() => edit({ lines: editing().lines.filter((_, j) => j !== i()) })}>{'×'}</button></td>
                      </tr>
                    )}</For>
                  </tbody>
                </table>

                <div class="ls-section-head">
                  <span>{t('lineStyles.marks')}</span>
                  <button class="pref-btn ls-small" disabled={editing().marks.length >= MAX_STYLE_MARKS}
                    onClick={() => edit({ marks: [...editing().marks, { kind: 'text', text: 'X', size: 7, interval: 72, start: null, gap: 2, offset: 0 }] })}>
                    {t('lineStyles.addText')}</button>
                  <button class="pref-btn ls-small" disabled={editing().marks.length >= MAX_STYLE_MARKS}
                    onClick={() => edit({ marks: [...editing().marks, { kind: 'symbol', shape: 'x', size: 5, interval: 24, start: null, gap: null, offset: 0, filled: false }] })}>
                    {t('lineStyles.addSymbol')}</button>
                </div>
                <table class="ls-table">
                  <thead><tr>
                    <th>{t('lineStyles.mark')}</th><th>{t('lineStyles.size')}</th><th>{t('lineStyles.interval')}</th>
                    <th>{t('lineStyles.start')}</th><th>{t('lineStyles.gap')}</th><th>{t('lineStyles.offset')}</th><th />
                  </tr></thead>
                  <tbody>
                    <For each={editing().marks}>{(mark, i) => (
                      <tr>
                        <td>
                          <Show when={mark.kind === 'text'} fallback={
                            <span class="ls-symbol-cell">
                              <select value={mark.shape} onChange={(e) => editMark(i(), { shape: e.target.value })}>
                                <For each={SYMBOL_SHAPES}>{(shape) => <option value={shape}>{t(`lineStyles.shapes.${shape}`)}</option>}</For>
                              </select>
                              <label class="ls-check" title={t('lineStyles.filled')}>
                                <input type="checkbox" checked={mark.filled} onChange={(e) => editMark(i(), { filled: e.target.checked })} />
                                {t('lineStyles.filled')}
                              </label>
                            </span>}>
                            <input type="text" class="ls-mark-text" maxLength={12} value={mark.text}
                              title={t('lineStyles.textHint')}
                              onChange={(e) => editMark(i(), { text: e.target.value })} />
                          </Show>
                        </td>
                        <td><input type="number" step="0.5" min="1" max="72" value={mark.size}
                          onChange={(e) => editMark(i(), { size: Number(e.target.value) })} /></td>
                        <td><input type="number" step="1" min="4" max="5000" value={mark.interval}
                          onChange={(e) => editMark(i(), { interval: Number(e.target.value) })} /></td>
                        <td><input type="number" step="1" min="0" placeholder={t('lineStyles.auto')} value={mark.start ?? ''}
                          onChange={(e) => editMark(i(), { start: numOrNull(e.target.value) })} /></td>
                        <td><input type="number" step="0.5" min="0" placeholder={t('lineStyles.noBreak')} value={mark.gap ?? ''}
                          title={t('lineStyles.gapHint')}
                          onChange={(e) => editMark(i(), { gap: numOrNull(e.target.value) })} /></td>
                        <td><input type="number" step="0.5" min="-50" max="50" value={mark.offset}
                          onChange={(e) => editMark(i(), { offset: Number(e.target.value) })} /></td>
                        <td><button class="pref-btn ls-small" aria-label={t('delete')} title={t('delete')}
                          onClick={() => edit({ marks: editing().marks.filter((_, j) => j !== i()) })}>{'×'}</button></td>
                      </tr>
                    )}</For>
                  </tbody>
                </table>
                <p class="ls-hint">{t('lineStyles.unitsHint')}</p>
              </fieldset>
              <Show when={!readOnly()}>
                <div class="ls-actions ls-save-row">
                  <button class="pref-btn pref-btn-secondary" disabled={!dirty()} onClick={() => setDraft(null)}>{t('lineStyles.revert')}</button>
                  <button class="pref-btn pref-btn-primary" disabled={!dirty()} onClick={save}>{t('save')}</button>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={tab() === 'hatch'}>
        <div class="ls-hatch">
          <div class="ls-actions">
            <label for="ls-pat-unit">{t('lineStyles.patUnit')}</label>
            <select id="ls-pat-unit" value={patUnit()} onChange={(e) => setPatUnit(e.target.value)}>
              <option value="mm">{t('lineStyles.patUnitMm')}</option>
              <option value="inch">{t('lineStyles.patUnitInch')}</option>
              <option value="pt">{t('lineStyles.patUnitPt')}</option>
            </select>
            <button class="pref-btn" onClick={importPat}>{t('lineStyles.importPat')}</button>
          </div>
          <p class="ls-hint">{t('lineStyles.patHint')}</p>
          <div class="ls-hatch-list">
            <Show when={importedHatchPatterns().length} fallback={<div class="ls-empty">{t('lineStyles.patEmpty')}</div>}>
              <For each={importedHatchPatterns()}>{(p) => (
                <div class="ls-hatch-row">
                  <img src={getHatchSwatchDataUrl(p.id, '#000000', 32, '#ffffff')} alt="" width="32" height="32" />
                  <span class="ls-list-name">{p.name}<span class="ls-hatch-desc">{p.description}</span></span>
                  <button class="pref-btn ls-small" onClick={() => deleteImportedHatchPattern(p.id)}>{t('delete')}</button>
                </div>
              )}</For>
            </Show>
          </div>
        </div>
      </Show>
    </Dialog>
  );
}
