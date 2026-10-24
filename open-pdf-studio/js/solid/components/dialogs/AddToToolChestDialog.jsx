import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { getToolChestSets, canEditToolSet, DEFAULT_TOOL_SET_ID, presetToolOf } from '../../../tools/tool-chest-presets.js';
import { toolChestAddTarget, suggestedToolName, addToToolChest, selectionToolChestTarget, addSelectionToToolChest } from '../../stores/toolChestAdd.js';
import { toolSetShareRevision } from '../../stores/toolSetLibrary.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';

/**
 * Add to Tool Chest… (the external editor): save the markup (or its whole group, as one
 * tool) into one or more tool sets, with its Label (name), Subject and
 * Comment for the Detail view. data: { annotationId } for one markup, or
 * { annotationIds } for a multi-selection saved as one tool.
 */
export default function AddToToolChestDialog(props) {
  const { t } = useTranslation('common');
  const tt = (key, params) => t(`toolSetSharing.${key}`, params);
  const close = () => closeDialog('add-to-tool-chest');
  const doc = getActiveDocument();
  const selectionIds = Array.isArray(props.data?.annotationIds) ? props.data.annotationIds : [];
  const selection = selectionIds.length >= 2
    ? selectionIds.map(id => doc?.annotations?.find(item => item.id === id) || null)
    : null;
  const selectionReady = !!selection && selection.every(Boolean);
  const annotation = selection
    ? (selectionReady ? selection[0] : null)
    : (doc?.annotations?.find(item => item.id === props.data?.annotationId) || doc?.selectedAnnotation || null);
  const target = selection
    ? (selectionReady ? selectionToolChestTarget(selection) : { kind: 'blocked', reason: 'unsupported' })
    : toolChestAddTarget(annotation);
  const tool = presetToolOf(annotation);
  const [name, setName] = createSignal(suggestedToolName(annotation, target));
  const [subject, setSubject] = createSignal(typeof annotation?.subject === 'string' ? annotation.subject.slice(0, 200) : '');
  const [comment, setComment] = createSignal('');
  const [chosen, setChosen] = createSignal(props.data?.setIds || [DEFAULT_TOOL_SET_ID]);
  const [includeText, setIncludeText] = createSignal(false);
  const [includeCallout, setIncludeCallout] = createSignal(false);
  const [error, setError] = createSignal('');
  const setLabel = (set) => (set.id === DEFAULT_TOOL_SET_ID ? tt('myTools') : set.name);
  const sets = () => { toolSetShareRevision(); return getToolChestSets(); };
  const toggle = (id, on) => setChosen(list => (on ? [...new Set([...list, id])] : list.filter(item => item !== id)));

  const save = () => {
    const ids = chosen().filter(id => canEditToolSet(id));
    if (!ids.length || !name().trim()) return;
    const options = { name: name(), subject: subject(), comment: comment(),
      includeTextAndSize: includeText(), includeCalloutGeometry: includeCallout() };
    const result = selection
      ? addSelectionToToolChest(selectionReady ? selection : [], ids, options)
      : addToToolChest(annotation, ids, options);
    if (result.error) { setError(tt(`blocked_${result.error}`) || result.error); return; }
    if (result.skipped.length && !result.saved.length) {
      setError(tt('skipped', { sets: sets().filter(set => result.skipped.includes(set.id)).map(setLabel).join(', ') }));
      return;
    }
    try { updateStatusMessage(tt('addedTo', { count: result.saved.length })); } catch { /* optional */ }
    close();
  };

  return (
    <Dialog title={tt('addToToolChest')} dialogClass="add-to-tool-chest-dialog" onClose={close}
      footer={<div class="mts-footer">
        <button type="button" class="mts-btn" onClick={close}>{tt('cancel')}</button>
        <button type="button" class="mts-btn mts-primary" id="attc-ok" disabled={target.kind === 'blocked' ||
          !name().trim() || !chosen().some(id => canEditToolSet(id))} onClick={save}>{tt('add')}</button>
      </div>}>
      <form class="mts-body attc-body" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Show when={target.kind !== 'blocked'} fallback={<p class="mts-message error" role="alert">{tt(`blocked_${target.reason}`)}</p>}>
          <Show when={target.kind === 'group'}><p class="mts-note">{tt('groupNote')}</p></Show>
          <label class="mts-field">{tt('label')}
            <input id="attc-name" maxLength="80" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <label class="mts-field">{tt('subject')}
            <input id="attc-subject" maxLength="200" value={subject()} onInput={(e) => setSubject(e.currentTarget.value)} />
          </label>
          <label class="mts-field">{tt('comment')}
            <input id="attc-comment" maxLength="200" value={comment()} onInput={(e) => setComment(e.currentTarget.value)} />
          </label>
          <Show when={tool === 'textbox' || tool === 'typewriter'}>
            <label class="mts-check"><input type="checkbox" checked={includeText()} onChange={(e) => setIncludeText(e.currentTarget.checked)} />{tt('includeText')}</label>
          </Show>
          <Show when={tool === 'callout'}>
            <label class="mts-check"><input type="checkbox" checked={includeCallout()} onChange={(e) => setIncludeCallout(e.currentTarget.checked)} />{tt('includeCallout')}</label>
          </Show>
          <fieldset class="attc-sets">
            <legend>{tt('sets')}</legend>
            <For each={sets()}>{(set) => (
              <label class="mts-check" title={canEditToolSet(set.id) ? '' : tt('readOnlySet', { name: setLabel(set) })}>
                <input type="checkbox" data-set-id={set.id} disabled={!canEditToolSet(set.id)}
                  checked={chosen().includes(set.id) && canEditToolSet(set.id)}
                  onChange={(e) => toggle(set.id, e.currentTarget.checked)} />
                {setLabel(set)}
              </label>
            )}</For>
          </fieldset>
          <Show when={error()}><p class="mts-message error" role="alert">{error()}</p></Show>
        </Show>
      </form>
    </Dialog>
  );
}
