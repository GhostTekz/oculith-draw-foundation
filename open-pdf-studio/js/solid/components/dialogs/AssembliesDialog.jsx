import { createSignal, For, Index, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { assembliesModel, assembliesCsv, assemblyHost, bidLines } from '../../../annotations/assemblies.js';
import { recordAssemblies, recordBulkModify } from '../../../core/undo-manager.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';

function newId() {
  return `asm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Assemblies… : typed parts lists, attached to a count or a length.
 * Recipes live on the document. One undo step saves the list; attaching
 * is its own undo step.
 */
export default function AssembliesDialog() {
  const { t } = useTranslation('common');
  const close = () => closeDialog('assemblies');
  const doc = getActiveDocument();
  const starting = assembliesModel(doc?.assemblies);
  const [recipes, setRecipes] = createSignal(starting.recipes);
  const [currentId, setCurrentId] = createSignal(starting.recipes[0]?.id || '');
  const [error, setError] = createSignal('');
  const [tick, setTick] = createSignal(0);
  const current = () => recipes().find((recipe) => recipe.id === currentId()) || null;
  const rows = () => {
    tick();
    return bidLines({ assemblies: { v: 1, recipes: recipes() }, annotations: doc?.annotations || [] });
  };

  const replace = (id, recipe) => setRecipes(recipes().map((item) => (item.id === id ? recipe : item)));

  const persist = () => {
    if (!doc) return false;
    const model = assembliesModel({ v: 1, recipes: recipes() });
    if (model.recipes.length !== recipes().length
        || model.recipes.some((recipe, index) => recipe.lines.length !== recipes()[index].lines.length)) {
      setError(t('assemblies.needRecipe'));
      return false;
    }
    const before = doc.assemblies;
    doc.assemblies = model;
    recordAssemblies(before, doc.assemblies);
    setRecipes(model.recipes);
    setError('');
    setTick((n) => n + 1);
    return true;
  };

  const addRecipe = () => {
    const recipe = {
      id: newId(), name: t('assemblies.newName'),
      lines: [{ name: '', qty: 1, unit: 'each', unitPrice: 0 }],
    };
    setRecipes([...recipes(), recipe]);
    setCurrentId(recipe.id);
    setError('');
  };

  const addLine = () => {
    const recipe = current();
    if (!recipe) return;
    replace(recipe.id, { ...recipe, lines: [...recipe.lines, { name: '', qty: 1, unit: 'each', unitPrice: 0 }] });
  };

  const attach = (assemblyId) => {
    if (!persist()) return;
    const hosts = (doc?.selectedAnnotations || []).filter(assemblyHost);
    if (!hosts.length) { setError(t('assemblies.needHost')); return; }
    const before = hosts.map((ann) => cloneAnnotation(ann));
    const now = new Date().toISOString();
    for (const ann of hosts) {
      if (assemblyId) ann.assemblyId = assemblyId;
      else delete ann.assemblyId;
      ann.modifiedAt = now;
    }
    recordBulkModify(hosts, before);
    setTick((n) => n + 1);
    try {
      updateStatusMessage(assemblyId
        ? t('assemblies.attached', { count: hosts.length })
        : t('assemblies.detached', { count: hosts.length }));
    } catch { /* optional */ }
  };

  const download = async () => {
    if (!doc || !persist()) return;
    try {
      const bytes = new TextEncoder().encode(`\uFEFF${assembliesCsv(doc)}`);
      const base = String(doc.filePath || doc.fileName || 'drawing').split(/[/\\]/u).pop().replace(/\.pdf$/iu, '') || 'drawing';
      const platform = await import('../../../core/platform.js');
      const path = await platform.saveFileDialog(`${base}-assemblies.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
      if (!path) return;
      await platform.writeBinaryFile(path, bytes);
    } catch (err) {
      setError(String(err?.message || err));
    }
  };

  return (
    <Dialog title={t('assemblies.title')} dialogClass="assemblies-dialog" onClose={close}
      footer={<div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
        <button type="button" class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
          onClick={close}>{t('cancel')}</button>
        <button type="button" class="ai-plan-btn" id="assemblies-save" style="width:auto;padding:5px 16px"
          onClick={() => { if (persist()) { try { updateStatusMessage(t('assemblies.saved')); } catch { /* optional */ } } }}>{t('assemblies.save')}</button>
      </div>}>
      <div style="min-width:520px;max-width:640px">
        <p style="margin:0 0 8px">{t('assemblies.hint')}</p>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
          <select id="assemblies-pick" value={currentId()} onChange={(e) => setCurrentId(e.currentTarget.value)} style="flex:1">
            <For each={recipes()}>{(recipe) => <option value={recipe.id}>{recipe.name}</option>}</For>
          </select>
          <button type="button" class="ai-plan-btn" style="width:auto;padding:4px 10px" onClick={addRecipe}>{t('assemblies.new')}</button>
          <button type="button" class="ai-plan-btn" style="width:auto;padding:4px 10px" disabled={!current()}
            onClick={() => {
              const id = currentId();
              const next = recipes().filter((recipe) => recipe.id !== id);
              setRecipes(next);
              setCurrentId(next[0]?.id || '');
            }}>{t('assemblies.delete')}</button>
        </div>
        <Show when={current()} fallback={<p>{t('assemblies.none')}</p>}>
            <label class="ai-form-field">{t('assemblies.name')}
              <input id="assemblies-name" class="ribbon-input" spellcheck={false} maxLength="80" value={current().name}
                onInput={(e) => replace(current().id, { ...current(), name: e.currentTarget.value })} />
            </label>
            <table style="width:100%;border-collapse:collapse;margin:8px 0">
              <thead>
                <tr>
                  <th style="text-align:left">{t('assemblies.part')}</th>
                  <th style="text-align:left">{t('assemblies.qty')}</th>
                  <th style="text-align:left">{t('assemblies.unit')}</th>
                  <th style="text-align:left">{t('assemblies.unitPrice')}</th>
                </tr>
              </thead>
              <tbody>
                <Index each={current().lines}>{(line, index) => (
                  <tr>
                    <td><input spellcheck={false} maxLength="80" value={line().name} style="width:100%"
                      onInput={(e) => {
                        const recipe = current();
                        const lines = recipe.lines.map((item, i) => (i === index ? { ...item, name: e.currentTarget.value } : item));
                        replace(recipe.id, { ...recipe, lines });
                      }} /></td>
                    <td><input type="number" min="0" step="any" value={line().qty} style="width:72px"
                      onInput={(e) => {
                        const recipe = current();
                        const lines = recipe.lines.map((item, i) => (i === index ? { ...item, qty: e.currentTarget.value } : item));
                        replace(recipe.id, { ...recipe, lines });
                      }} /></td>
                    <td><select value={line().unit} onChange={(e) => {
                      const recipe = current();
                      const lines = recipe.lines.map((item, i) => (i === index ? { ...item, unit: e.currentTarget.value } : item));
                      replace(recipe.id, { ...recipe, lines });
                    }}>
                      <option value="each">{t('assemblies.each')}</option>
                      <option value="length">{t('assemblies.length')}</option>
                    </select></td>
                    <td><input type="number" min="0" step="any" value={line().unitPrice} style="width:80px"
                      onInput={(e) => {
                        const recipe = current();
                        const lines = recipe.lines.map((item, i) => (i === index ? { ...item, unitPrice: e.currentTarget.value } : item));
                        replace(recipe.id, { ...recipe, lines });
                      }} /></td>
                  </tr>
                )}</Index>
              </tbody>
            </table>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="ai-plan-btn" style="width:auto;padding:4px 10px" onClick={addLine}>{t('assemblies.addLine')}</button>
              <button type="button" class="ai-plan-btn" id="assemblies-attach" style="width:auto;padding:4px 10px"
                onClick={() => attach(current().id)}>{t('assemblies.attach')}</button>
              <button type="button" class="ai-plan-btn" style="width:auto;padding:4px 10px" onClick={() => attach('')}>{t('assemblies.detach')}</button>
              <button type="button" class="ai-plan-btn" style="width:auto;padding:4px 10px" onClick={() => void download()}>{t('assemblies.csv')}</button>
            </div>
        </Show>
        <Show when={error()}><p class="mts-message error" role="alert">{error()}</p></Show>
        <Show when={rows().length}>
          <table style="width:100%;border-collapse:collapse;margin-top:12px">
            <thead>
              <tr>
                <th style="text-align:left">{t('assemblies.name')}</th>
                <th style="text-align:left">{t('assemblies.part')}</th>
                <th style="text-align:left">{t('assemblies.qty')}</th>
                <th style="text-align:left">{t('assemblies.unit')}</th>
                <th style="text-align:left">{t('assemblies.extended')}</th>
                <th style="text-align:left">{t('assemblies.scaleNotSet')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows().slice(0, 200)}>{(row) => (
                <tr>
                  <td>{row.assembly}</td>
                  <td>{row.part}</td>
                  <td>{row.quantity}</td>
                  <td>{row.unit}</td>
                  <td>{row.extended}</td>
                  <td>{row.scaleNotSet ? t('assemblies.scaleNotSet') : ''}</td>
                </tr>
              )}</For>
            </tbody>
          </table>
        </Show>
      </div>
    </Dialog>
  );
}
