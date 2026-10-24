import { For, Show, createMemo, createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import StampPreview from './StampPreview.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { BUILT_IN_STAMPS, previewFieldContext } from '../../../annotations/stamps.js';
import { CONTRACTOR_STAMPS, instantiateStampTemplate } from '../../../annotations/stamp-templates.js';
import {
  deleteUserStamp, exportUserStampsJson, getUserStamps, importUserStampsJson,
} from '../../../annotations/user-stamps.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

/**
 * Stamp picker (the external editor Stamp menu): the contractor stamps and the user's own
 * stamps drawn as they will appear (fields filled in), the standard stamps,
 * an image stamp, and the editor and JSON import/export of user stamps.
 */
export default function StampPickerDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tc } = useTranslation('common');
  const [message, setMessage] = createSignal('');
  const fieldContext = previewFieldContext();
  const design = (template) => instantiateStampTemplate(template, fieldContext);
  const userStamps = createMemo(() => getUserStamps());

  const cancel = () => { closeDialog('stamp-picker'); };

  function handleStampClick(stamp) {
    if (props.data?.onSelect) props.data.onSelect(stamp);
    closeDialog('stamp-picker');
  }

  function handleCustomClick() {
    if (props.data?.onCustom) props.data.onCustom();
    closeDialog('stamp-picker');
  }

  const openEditor = (template = null) => openDialog('stamp-editor', { template });

  const exportStamps = async () => {
    setMessage('');
    if (!userStamps().length) { setMessage(tc('stampEditor.exportEmpty')); return; }
    try {
      const { saveFileDialog, writeBinaryFile } = await import('../../../core/platform.js');
      const path = await saveFileDialog('ocudraw-stamps.json', [{ name: 'OcuDraw stamps', extensions: ['json'] }]);
      if (!path) return;
      await writeBinaryFile(path, new TextEncoder().encode(exportUserStampsJson()));
      setMessage(tc('stampEditor.exported', { count: userStamps().length }));
    } catch (error) {
      setMessage(error?.message || tc('stampEditor.exportFailed'));
    }
  };

  const importStamps = async () => {
    setMessage('');
    try {
      const { openFileDialog, readBinaryFile } = await import('../../../core/platform.js');
      const picked = await openFileDialog(['json']);
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const text = new TextDecoder().decode(await readBinaryFile(path));
      const { added, skipped } = await importUserStampsJson(text);
      setMessage(tc('stampEditor.imported', { count: added, skipped }));
    } catch (error) {
      setMessage(error?.message || tc('stampEditor.importFailed'));
    }
  };

  const StampButton = (p) => (
    <button type="button" class="stamp-pick" title={p.template.name} data-stamp-id={p.template.id}
      onClick={() => handleStampClick(p.template)}>
      <StampPreview design={design(p.template)} maxWidth={140} maxHeight={44} />
    </button>
  );

  return (
    <Dialog
      title={t('stampPicker.title')}
      overlayClass="stamp-picker-overlay"
      dialogClass="stamp-picker-dialog"
      onClose={cancel}
      footer={
        <div class="stamp-editor-footer">
          <button type="button" class="stamp-btn" id="stamp-picker-new" onClick={() => openEditor()}>
            {tc('stampEditor.newStamp')}</button>
          <button type="button" class="stamp-btn" id="stamp-picker-import" onClick={importStamps}>
            {tc('stampEditor.import')}</button>
          <button type="button" class="stamp-btn" id="stamp-picker-export" onClick={exportStamps}>
            {tc('stampEditor.export')}</button>
          <span class="stamp-editor-spacer" />
          <button type="button" class="stamp-btn" onClick={cancel}>{tc('cancel')}</button>
        </div>
      }
    >
      <div class="stamp-picker">
        <div class="stamp-picker-heading">{tc('stampEditor.pickerContractor')}</div>
        <div class="stamp-picker-grid">
          <For each={CONTRACTOR_STAMPS}>{(template) => <StampButton template={template} />}</For>
        </div>

        <div class="stamp-picker-heading">{tc('stampEditor.pickerMine')}</div>
        <Show when={userStamps().length} fallback={<div class="stamp-muted">{tc('stampEditor.noMine')}</div>}>
          <div class="stamp-picker-grid">
            <For each={userStamps()}>
              {(template) => (
                <div class="stamp-pick-user">
                  <StampButton template={template} />
                  <div class="stamp-pick-actions">
                    <button type="button" class="stamp-icon-btn" title={tc('stampEditor.edit')}
                      aria-label={`${tc('stampEditor.edit')} ${template.name}`}
                      onClick={() => openEditor(template)}>&#x270E;</button>
                    <button type="button" class="stamp-icon-btn" title={tc('stampEditor.delete')}
                      aria-label={`${tc('stampEditor.delete')} ${template.name}`}
                      onClick={() => deleteUserStamp(template.id)}>&#x2715;</button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="stamp-picker-heading">{tc('stampEditor.pickerStandard')}</div>
        <div class="stamp-picker-grid stamp-picker-standard">
          <For each={BUILT_IN_STAMPS}>
            {(stamp) => (
              <button type="button" class="stamp-pick stamp-pick-text"
                style={{ color: stamp.color, 'border-color': stamp.color }}
                onClick={() => handleStampClick(stamp)}>
                {stamp.text}
              </button>
            )}
          </For>
          <button type="button" class="stamp-pick stamp-pick-custom" onClick={handleCustomClick}>
            {t('stampPicker.customFromImage')}
          </button>
        </div>
        <Show when={message()}><div class="stamp-muted" role="status">{message()}</div></Show>
      </div>
    </Dialog>
  );
}
