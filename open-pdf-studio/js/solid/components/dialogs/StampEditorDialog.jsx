import { createMemo, createSignal, For, Index, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import StampPreview from './StampPreview.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  STAMP_BORDERS, STAMP_DATE_FORMATS, STAMP_FIELDS, STAMP_LIMITS, cleanStampImage, cleanStampTemplate,
  instantiateStampTemplate, newUserStampId,
} from '../../../annotations/stamp-templates.js';
import { allStampTemplates, saveUserStamp } from '../../../annotations/user-stamps.js';
import { previewFieldContext, saveStampTemplateToToolChest } from '../../../annotations/stamps.js';

const MAX_IMAGE_BYTES = Math.floor(STAMP_LIMITS.image * 3 / 4) - 64;

function blankTemplate(t) {
  return {
    version: 1, id: newUserStampId(), name: t('stampEditor.defaultName'), color: '#b91c1c', border: 'rounded',
    dateFormat: 'locale', status: '',
    lines: [{ text: t('stampEditor.defaultTitle'), size: 18, bold: true }, { text: '{user}  {date}', size: 8, bold: false }],
  };
}

/** A user stamp to edit, or a copy (new id) of any other template. */
function startFrom(template, t) {
  const clean = cleanStampTemplate(template);
  if (!clean) return blankTemplate(t);
  if (clean.id.startsWith('user:')) return clean;
  return { ...clean, id: newUserStampId(), name: `${clean.name} ${t('stampEditor.copySuffix')}`.slice(0, STAMP_LIMITS.name),
    lines: clean.lines.map(line => ({ ...line })) };
}

function bytesToDataUrl(bytes) {
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) return null;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/${png ? 'png' : 'jpeg'};base64,${btoa(binary)}`;
}

/**
 * Stamp editor (the external editor): text lines with size and bold, border, colour, an
 * optional image and dynamic fields, with a live preview. Saves a user stamp
 * (preferences), optionally also as a Tool Chest tool.
 */
export default function StampEditorDialog(props) {
  const { t } = useTranslation('common');
  const [draft, setDraft] = createSignal(startFrom(props.data?.template, t));
  const [focusedLine, setFocusedLine] = createSignal(0);
  const [toToolChest, setToToolChest] = createSignal(false);
  const [error, setError] = createSignal('');
  const close = () => closeDialog('stamp-editor');

  const update = (patch) => setDraft(current => ({ ...current, ...patch }));
  const updateLine = (index, patch) => setDraft(current => ({
    ...current, lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
  }));
  const valid = createMemo(() => cleanStampTemplate(draft()));
  const previewDesign = createMemo(() => (valid() ? instantiateStampTemplate(valid(), previewFieldContext()) : null));

  const addLine = () => {
    if (draft().lines.length >= STAMP_LIMITS.lines) return;
    update({ lines: [...draft().lines, { text: '', size: 8, bold: false }] });
    setFocusedLine(draft().lines.length - 1);
  };
  const removeLine = (index) => {
    if (draft().lines.length <= 1) return;
    update({ lines: draft().lines.filter((_, i) => i !== index) });
    setFocusedLine(0);
  };
  const insertField = (field) => {
    if (!field) return;
    const index = Math.min(focusedLine(), draft().lines.length - 1);
    const text = draft().lines[index].text;
    updateLine(index, { text: `${text}${text && !text.endsWith(' ') ? ' ' : ''}{${field}}`.slice(0, STAMP_LIMITS.text) });
  };
  const startFromTemplate = (id) => {
    const template = allStampTemplates().find(item => item.id === id);
    if (template) setDraft({ ...startFrom({ ...template, id: template.id.startsWith('user:') ? 'ct:copy' : template.id }, t) });
  };

  const chooseImage = async () => {
    setError('');
    try {
      const { openFileDialog, readBinaryFile } = await import('../../../core/platform.js');
      const picked = await openFileDialog(['png', 'jpg', 'jpeg']);
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const bytes = new Uint8Array(await readBinaryFile(path));
      if (bytes.length > MAX_IMAGE_BYTES) { setError(t('stampEditor.imageTooLarge')); return; }
      const dataUrl = bytesToDataUrl(bytes);
      if (!dataUrl) { setError(t('stampEditor.imageInvalid')); return; }
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
      const image = cleanStampImage({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      if (!image) { setError(t('stampEditor.imageInvalid')); return; }
      update({ image });
    } catch {
      setError(t('stampEditor.imageInvalid'));
    }
  };
  const removeImage = () => setDraft(current => {
    const next = { ...current };
    delete next.image;
    return next;
  });

  const save = async () => {
    const template = valid();
    if (!template) { setError(t('stampEditor.invalid')); return; }
    const saved = await saveUserStamp(template);
    if (!saved) { setError(t('stampEditor.saveFailed')); return; }
    if (toToolChest()) saveStampTemplateToToolChest(saved);
    try {
      const { updateStatusMessage } = await import('../../../ui/chrome/status-bar.js');
      updateStatusMessage(t('stampEditor.saved', { name: saved.name }));
    } catch { /* status bar is optional */ }
    props.data?.onSaved?.(saved);
    close();
  };

  return (
    <Dialog
      title={t('stampEditor.title')}
      overlayClass="stamp-editor-overlay"
      dialogClass="stamp-editor-dialog"
      onClose={close}
      footer={
        <div class="stamp-editor-footer">
          <label class="stamp-editor-check">
            <input type="checkbox" id="stamp-editor-toolchest" checked={toToolChest()}
              onChange={(e) => setToToolChest(e.currentTarget.checked)} />
            {t('stampEditor.addToToolChest')}
          </label>
          <span class="stamp-editor-spacer" />
          <button type="button" class="stamp-btn" onClick={close}>{t('cancel')}</button>
          <button type="button" class="stamp-btn stamp-btn-primary" id="stamp-editor-save"
            disabled={!valid()} onClick={save}>{t('save')}</button>
        </div>
      }
    >
      <div class="stamp-editor">
        <div class="stamp-editor-row">
          <label for="stamp-editor-name">{t('stampEditor.name')}</label>
          <input id="stamp-editor-name" class="stamp-input" maxLength={STAMP_LIMITS.name} value={draft().name}
            onInput={(e) => update({ name: e.currentTarget.value })} />
          <select class="stamp-input stamp-editor-start" aria-label={t('stampEditor.startFrom')}
            value="" onChange={(e) => { startFromTemplate(e.currentTarget.value); e.currentTarget.value = ''; }}>
            <option value="">{t('stampEditor.startFrom')}</option>
            <For each={allStampTemplates()}>{(template) => <option value={template.id}>{template.name}</option>}</For>
          </select>
        </div>

        <fieldset class="stamp-editor-group">
          <legend>{t('stampEditor.lines')}</legend>
          <Index each={draft().lines}>
            {(line, index) => (
              <div class="stamp-editor-line">
                <input class="stamp-input stamp-line-text" maxLength={STAMP_LIMITS.text} value={line().text}
                  aria-label={t('stampEditor.lineText', { n: index + 1 })}
                  onFocus={() => setFocusedLine(index)}
                  onInput={(e) => updateLine(index, { text: e.currentTarget.value })} />
                <input class="stamp-input stamp-line-size" type="number" min={STAMP_LIMITS.minSize}
                  max={STAMP_LIMITS.maxSize} step="1" value={line().size} title={t('stampEditor.size')}
                  aria-label={t('stampEditor.size')}
                  onInput={(e) => { const v = Number(e.currentTarget.value); if (v >= STAMP_LIMITS.minSize && v <= STAMP_LIMITS.maxSize) updateLine(index, { size: v }); }} />
                <label class="stamp-editor-check" title={t('stampEditor.bold')}>
                  <input type="checkbox" checked={line().bold}
                    onChange={(e) => updateLine(index, { bold: e.currentTarget.checked })} />
                  <b>B</b>
                </label>
                <button type="button" class="stamp-icon-btn" title={t('stampEditor.removeLine')}
                  aria-label={t('stampEditor.removeLine')} disabled={draft().lines.length <= 1}
                  onClick={() => removeLine(index)}>&#x2715;</button>
              </div>
            )}
          </Index>
          <div class="stamp-editor-row">
            <button type="button" class="stamp-btn" disabled={draft().lines.length >= STAMP_LIMITS.lines}
              onClick={addLine}>{t('stampEditor.addLine')}</button>
            <select class="stamp-input" id="stamp-editor-field" value="" aria-label={t('stampEditor.insertField')}
              onChange={(e) => { insertField(e.currentTarget.value); e.currentTarget.value = ''; }}>
              <option value="">{t('stampEditor.insertField')}</option>
              <For each={STAMP_FIELDS}>{(field) => <option value={field}>{`{${field}} ${t(`stampEditor.fields.${field}`)}`}</option>}</For>
            </select>
          </div>
        </fieldset>

        <div class="stamp-editor-grid">
          <label for="stamp-editor-border">{t('stampEditor.border')}</label>
          <select id="stamp-editor-border" class="stamp-input" value={draft().border}
            onChange={(e) => update({ border: e.currentTarget.value })}>
            <For each={STAMP_BORDERS}>{(border) => <option value={border}>{t(`stampEditor.borders.${border}`)}</option>}</For>
          </select>
          <label for="stamp-editor-color">{t('stampEditor.color')}</label>
          <input id="stamp-editor-color" type="color" class="stamp-color" value={draft().color}
            onInput={(e) => update({ color: e.currentTarget.value })} />
          <label for="stamp-editor-date">{t('stampEditor.dateFormat')}</label>
          <select id="stamp-editor-date" class="stamp-input" value={draft().dateFormat}
            onChange={(e) => update({ dateFormat: e.currentTarget.value })}>
            <For each={STAMP_DATE_FORMATS}>{(format) => <option value={format}>{t(`stampEditor.dateFormats.${format}`)}</option>}</For>
          </select>
          <label for="stamp-editor-status">{t('stampEditor.status')}</label>
          <input id="stamp-editor-status" class="stamp-input" maxLength={STAMP_LIMITS.status} value={draft().status}
            onInput={(e) => update({ status: e.currentTarget.value })} />
          <label>{t('stampEditor.image')}</label>
          <div class="stamp-editor-row">
            <button type="button" class="stamp-btn" onClick={chooseImage}>{t('stampEditor.chooseImage')}</button>
            <Show when={draft().image}>
              <button type="button" class="stamp-btn" onClick={removeImage}>{t('stampEditor.removeImage')}</button>
            </Show>
          </div>
        </div>

        <div class="stamp-editor-preview-label">{t('stampEditor.preview')}</div>
        <div class="stamp-editor-preview">
          <Show when={previewDesign()} fallback={<span class="stamp-muted">{t('stampEditor.invalid')}</span>}>
            <StampPreview design={previewDesign()} maxWidth={380} maxHeight={110} maxScale={3} />
          </Show>
        </div>
        <Show when={error()}><div class="stamp-error" role="alert">{error()}</div></Show>
      </div>
    </Dialog>
  );
}
