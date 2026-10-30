import { createSignal, createMemo, For, Index, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { sheetRegister } from '../../stores/sheetRegisterStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  isTauri, openFileDialog, openFolderDialog, listPdfFiles, readBinaryFile, writeBinaryFile, fileExists, invoke,
} from '../../../core/platform.js';
import { runBatch, batchFileList, setFilePaths } from '../../../batch/runner.js';
import { BATCH_LINK_DEFAULTS } from '../../../pdf/batch-link.js';
import { ask } from '../../commands/util.js';

const NAME = 'set-batch-link';

async function grant(path) {
  if (!isTauri()) return;
  try { await invoke('allow_fs_scope', { path }); } catch { /* scope already granted */ }
}

/**
 * Batch > Link > Set Batch Link: Batch Link over the PDFs of the current Set
 * or picked files (js/batch/set-link.js). Find reads every file and lists
 * each reference with its target sheet in any file; Create Links writes
 * linked copies into an output folder with the set's folder layout; Remove
 * writes copies without the Batch Link links. The sources are only read.
 */
export default function SetBatchLinkDialog(props) {
  const { t } = useTranslation('common');
  const { t: td } = useTranslation('dialogs');
  const ts = (key, options) => t(`setBatchLink.${key}`, options);
  const indexSource = props.data?.indexSource || null;
  const [files, setFiles] = createSignal(batchFileList(setFilePaths(sheetRegister())));
  const [selected, setSelected] = createSignal(-1);
  const [opts, setOpts] = createSignal({ ...BATCH_LINK_DEFAULTS });
  const [registeredTargets, setRegisteredTargets] = createSignal(!!indexSource);
  const [bookmarks, setBookmarks] = createSignal(false);
  const [phase, setPhase] = createSignal('options'); // options | scanning | preview | writing | done
  const [progress, setProgress] = createSignal('');
  const [log, setLog] = createSignal({}); // path -> entry
  const [plan, setPlan] = createSignal(null); // { files, scans, links, skipped, ambiguous, pagesWithoutText }
  const [checked, setChecked] = createSignal([]);
  const [message, setMessage] = createSignal('');
  const [result, setResult] = createSignal('');
  let controller = null;

  const set = (key, value) => setOpts((prev) => ({ ...prev, [key]: value }));
  const busy = () => phase() === 'scanning' || phase() === 'writing';
  const addPaths = (paths) => { setFiles(batchFileList([...files().map((f) => f.path), ...(paths || [])])); setMessage(''); };
  const addSet = () => {
    const paths = setFilePaths(sheetRegister());
    if (!paths.length) { setMessage(ts('setEmpty')); return; }
    addPaths(paths);
  };
  const addFiles = async () => {
    const picked = await openFileDialog(['pdf'], { multiple: true });
    if (picked) addPaths(Array.isArray(picked) ? picked : [picked]);
  };
  const addFolder = async () => {
    const dir = await openFolderDialog(ts('addFolder'));
    if (!dir) return;
    try { addPaths(await listPdfFiles(dir)); } catch (error) { setMessage(ts('failed', { error: error?.message || error })); }
  };
  const removeSelected = () => {
    const index = selected();
    if (index < 0) return;
    setFiles(files().filter((_, i) => i !== index));
    setSelected(Math.min(index, files().length - 1));
  };

  const readFile = async (path) => {
    await grant(path);
    const bytes = await readBinaryFile(path);
    if (!bytes && !isTauri()) throw new Error(ts('notInBrowser'));
    return bytes;
  };
  const onFile = (verb) => (p) => {
    if (p.phase === 'file') setProgress(ts('progress', { verb, index: p.index + 1, total: p.total, name: p.file.name }));
    else if (p.phase === 'done') setLog({ ...log(), [p.file.path]: p.entry });
  };

  const fileName = (index) => plan()?.files[index]?.name || '';
  const sheetOf = (file, page) => {
    const label = plan()?.scans[file]?.labels?.[page - 1];
    return label && label !== String(page) ? label : ts('page', { page });
  };
  const chosen = createMemo(() => (plan()?.links || []).filter((_, i) => checked()[i]));
  const skippedBy = (reason) => (plan()?.skipped || []).filter((s) => s.reason === reason).length;
  const remoteCount = createMemo(() => chosen().filter((l) => l.file !== l.target.file).length);
  const pathKey = (path) => String(path || '').replace(/\\/g, '/').toLocaleLowerCase();
  const reviewTarget = (row) => {
    if (row.targetSheetId) return `${row.label} · ${row.targetSheetId} · ${row.targetPath} · ${ts('page', { page: row.targetPage })}`;
    if (row.candidates?.length) return row.candidates.map(candidate =>
      `${row.label} · ${candidate.sheetId} · ${candidate.path} · ${ts('page', { page: candidate.page })}`).join('; ');
    if (row.places?.length) return row.places.map(place => `${fileName(place.file)} · ${ts('page', { page: place.page })}`).join('; ');
    return row.label;
  };

  const find = async () => {
    if (busy() || !files().length) return;
    setMessage(''); setLog({}); setPhase('scanning'); setProgress('');
    controller = new AbortController();
    try {
      const [pdfjs, setLink, { textMeasurer }] = await Promise.all([
        import('pdfjs-dist'), import('../../../batch/set-link.js'), import('../../../pdf/batch-link-app.js'),
        import('../../../pdf/loader.js'), // configures the PDF.js worker
      ]);
      const measurers = new Map();
      const measureFor = (family) => {
        if (!measurers.has(family)) measurers.set(family, textMeasurer(family));
        return measurers.get(family);
      };
      const list = files();
      const register = sheetRegister();
      const useRegister = !!indexSource || registeredTargets();
      const registerSnapshot = useRegister ? setLink.registeredSetLinkSnapshot(register) : null;
      const run = await runBatch({
        files: list, readFile, signal: controller.signal, onProgress: onFile(ts('reading')),
        job: setLink.setLinkScanJob({ pdfjs, measureFor, fingerprint: useRegister, indexSource }),
      });
      if (run.cancelled) { setMessage(ts('cancelled')); setPhase('options'); return; }
      if (useRegister && setLink.registeredSetLinkSnapshot(sheetRegister()) !== registerSnapshot) {
        throw new Error(ts('registerChanged'));
      }
      const key = (p) => p.replace(/\\/g, '/').toLocaleLowerCase();
      const scans = list.map((f) => run.output.byPath.get(key(f.path)) || null);
      const planned = indexSource
        ? setLink.planIndexSheetLinks(scans, list, register, indexSource, opts())
        : useRegister ? setLink.planRegisteredSetLinks(scans, list, register, opts())
          : setLink.planSetLinks(scans, opts());
      setPlan({ files: list, scans, register, registered: useRegister,
        indexMode: !!indexSource, registerSnapshot, ...planned });
      setChecked(planned.links.map(() => true));
      setPhase('preview');
    } catch (error) {
      setMessage(ts('failed', { error: error?.message || String(error) }));
      setPhase('options');
    } finally { controller = null; setProgress(''); }
  };

  /** Write job over `list` (create or remove), then write the outputs. */
  const write = async (mode, list, links, reviewedPlan = null) => {
    let dir = '';
    if (isTauri()) {
      dir = await openFolderDialog(ts('outputFolder'));
      if (!dir) return;
    }
    const back = phase();
    setMessage(''); setLog({}); setPhase('writing');
    controller = new AbortController();
    try {
      const setLink = await import('../../../batch/set-link.js');
      let verifiedBytes = null;
      if (reviewedPlan?.registered) {
        const unchanged = () => setLink.registeredSetLinkSnapshot(sheetRegister()) === reviewedPlan.registerSnapshot;
        if (!unchanged()) throw new Error(ts('registerChanged'));
        verifiedBytes = await setLink.verifySetLinkPreviewSources(list, reviewedPlan.scans, readFile);
        if (!unchanged()) throw new Error(ts('registerChanged'));
      }
      const { rel } = setLink.setOutputLayout(list.map((f) => f.path), { flat: !isTauri() });
      const run = await runBatch({
        files: list, readFile: verifiedBytes ? path => verifiedBytes.get(pathKey(path)) : readFile,
        signal: controller.signal, onProgress: onFile(ts('writingFile')),
        job: setLink.setLinkWriteJob({ files: list, plan: { links }, rel, mode,
          bookmarks: indexSource ? false : bookmarks(), options: opts() }),
      });
      if (run.cancelled) { setMessage(ts('cancelled')); setPhase(back); return; }
      if (reviewedPlan?.registered && run.log.some(entry => !entry.ok)) throw new Error(ts('writeIncomplete'));
      if (reviewedPlan?.registered && setLink.registeredSetLinkSnapshot(sheetRegister()) !== reviewedPlan.registerSnapshot) {
        throw new Error(ts('registerChanged'));
      }
      setProgress(ts('saving'));
      const written = await setLink.writeSetOutputs(run.output, {
        dir, sources: list.map((f) => f.path),
        exists: async (path) => { await grant(path); return fileExists(path).catch(() => false); },
        mkdir: async (path) => {
          await grant(path);
          await window.__TAURI__?.fs?.mkdir?.(path, { recursive: true });
        },
        write: async (path, bytes) => { await grant(path); await writeBinaryFile(path, bytes); },
      });
      const ok = run.log.filter((e) => e.ok);
      const sum = (k) => ok.reduce((n, e) => n + (e.detail?.[k] || 0), 0);
      const lines = [
        mode === 'create' ? ts('created', { count: sum('added'), files: written.length }) : ts('removed', { count: sum('removed'), files: written.length }),
        !indexSource && bookmarks() ? ts('bookmarksWritten', { count: sum('bookmarks') }) : '',
        run.log.length > ok.length ? ts('someFailed', { count: run.log.length - ok.length }) : '',
        dir ? ts('writtenTo', { dir }) : ts('downloaded'),
      ];
      setResult(lines.filter(Boolean).join('\n'));
      setPhase('done');
    } catch (error) {
      setMessage(ts('writeFailed', { error: error?.message || String(error) }));
      setPhase(back);
    } finally { controller = null; setProgress(''); }
  };

  const createLinks = () => write('create', plan().files, chosen(), plan());
  const removeLinks = async () => {
    if (busy() || !files().length) return;
    if (!(await ask(ts('confirmRemove', { count: files().length }), ts('title')))) return;
    await write('remove', files(), []);
  };

  const cancelRun = () => controller?.abort();
  const close = () => { cancelRun(); closeDialog(NAME); };

  const statusOf = (file) => {
    const entry = log()[file.path];
    if (!entry) return { cls: '', text: busy() ? ts('waiting') : '' };
    if (!entry.ok) return { cls: 'error', text: ts('failed', { error: entry.error }) };
    if (typeof entry.detail === 'number') return { cls: 'ok', text: ts('labels', { count: entry.detail }) };
    return { cls: 'ok', text: ts('fileDone', { added: entry.detail?.added || 0, removed: entry.detail?.removed || 0 }) };
  };

  const footer = (
    <div class="sheet-links-footer">
      <div>
        <Show when={phase() === 'preview'}>
          <button class="sheet-links-btn" id="set-link-back" onClick={() => setPhase('options')}>{td('batchLink.back')}</button>
        </Show>
        <Show when={phase() === 'options'}>
          <button class="sheet-links-btn" id="set-link-remove" disabled={!files().length} onClick={removeLinks}>{ts('remove')}</button>
        </Show>
      </div>
      <div>
        <Show when={busy()}>
          <button class="sheet-links-btn" onClick={cancelRun}>{ts('cancelRun')}</button>
        </Show>
        <Show when={phase() === 'done'} fallback={<button class="sheet-links-btn" onClick={close}>{t('cancel')}</button>}>
          <button class="sheet-links-btn primary" id="set-link-close" onClick={close}>{t('close')}</button>
        </Show>
        <Show when={phase() === 'options' || phase() === 'scanning'}>
          <button class="sheet-links-btn primary" id="set-link-find" disabled={busy() || !files().length} onClick={find}>{td('batchLink.find')}</button>
        </Show>
        <Show when={phase() === 'preview'}>
          <button class="sheet-links-btn primary" id="set-link-create"
            disabled={(!chosen().length && (indexSource || !bookmarks())) || (plan().registered && plan().scans.some(scan => !scan))} onClick={createLinks}>
            {td('batchLink.create', { count: chosen().length })}
          </button>
        </Show>
      </div>
    </div>
  );

  return (
    <Dialog title={ts('title')} dialogClass="sheet-links-dialog set-batch-link-dialog" bodyClass="sheet-links-body" onClose={close} footer={footer}>
      <Show when={phase() === 'options' || phase() === 'scanning' || phase() === 'writing'}>
        <div class="sheet-links-muted">{ts('intro')}</div>
        <Show when={indexSource}><div class="sheet-links-muted">Index page: {indexSource.label} · Page {indexSource.page}. Find reviews exact sheet-number rows on this page only. Create Links writes separate copies after checking every source again.</div></Show>
        <div class="batch-summary-actions">
          <Show when={!indexSource}><button class="sheet-links-btn" disabled={busy()} onClick={addSet}>{ts('addSet')}</button>
          <button class="sheet-links-btn" disabled={busy()} onClick={addFiles}>{ts('addFiles')}</button>
          <Show when={isTauri()}>
            <button class="sheet-links-btn" disabled={busy()} onClick={addFolder}>{ts('addFolder')}</button>
          </Show></Show>
          <span class="batch-summary-spacer" />
          <Show when={!indexSource}><button class="sheet-links-btn" disabled={busy() || selected() < 0} onClick={removeSelected}>{ts('removeFile')}</button>
          <button class="sheet-links-btn" disabled={busy() || !files().length} onClick={() => { setFiles([]); setSelected(-1); setLog({}); }}>{ts('clear')}</button></Show>
        </div>
        <div class="batch-summary-list set-batch-link-files" role="listbox" aria-label={ts('files')}>
          <Show when={files().length} fallback={<div class="batch-summary-empty">{ts('noFiles')}</div>}>
            <For each={files()}>
              {(file, index) => (
                <div class={`batch-summary-file ${selected() === index() ? 'selected' : ''}`} role="option"
                  aria-selected={selected() === index()} title={file.path} onClick={() => setSelected(index())}>
                  <span class="batch-summary-file-name">{file.name}</span>
                  <span class={`batch-summary-file-status ${statusOf(file).cls}`}>{statusOf(file).text}</span>
                </div>
              )}
            </For>
          </Show>
        </div>
        <fieldset class="sheet-links-fieldset">
          <legend>{td('batchLink.searchOptions')}</legend>
          <Show when={!indexSource}><label class="sheet-links-row">
            <input type="checkbox" id="set-link-registered-targets" checked={registeredTargets()}
              disabled={!sheetRegister().sheets.length} onChange={e => setRegisteredTargets(e.currentTarget.checked)} />
            {ts('registeredTargets')}
          </label></Show>
          <div class="sheet-links-row">
            <Show when={!indexSource}>
            <label><input type="checkbox" checked={opts().wholeWord} onChange={(e) => set('wholeWord', e.currentTarget.checked)} />{td('batchLink.wholeWord')}</label>
            <label><input type="checkbox" checked={opts().caseSensitive} onChange={(e) => set('caseSensitive', e.currentTarget.checked)} />{td('batchLink.matchCase')}</label>
            <label><input type="checkbox" checked={opts().callouts} onChange={(e) => set('callouts', e.currentTarget.checked)} />{td('batchLink.callouts')}</label>
            </Show>
            <label><input type="checkbox" checked={opts().excludeSelf} onChange={(e) => set('excludeSelf', e.currentTarget.checked)} />{td('batchLink.excludeSelf')}</label>
          </div>
        </fieldset>
        <fieldset class="sheet-links-fieldset">
          <legend>{td('batchLink.appearance')}</legend>
          <div class="sheet-links-row">
            <label>{td('batchLink.highlight')}
              <select value={opts().highlight} onChange={(e) => set('highlight', e.currentTarget.value)}>
                <option value="outline">{td('batchLink.outline')}</option>
                <option value="none">{td('batchLink.none')}</option>
              </select>
            </label>
            <label>{td('batchLink.color')}
              <input type="color" value={opts().color} disabled={opts().highlight !== 'outline'} onInput={(e) => set('color', e.currentTarget.value)} />
            </label>
            <label>{td('batchLink.lineWidth')}
              <input type="number" min="0.25" max="6" step="0.25" value={opts().lineWidth} disabled={opts().highlight !== 'outline'}
                onInput={(e) => set('lineWidth', Number(e.currentTarget.value) || 1)} />
            </label>
          </div>
          <Show when={!indexSource}><label class="sheet-links-row">
            <input type="checkbox" id="set-link-bookmarks" checked={bookmarks()} onChange={(e) => setBookmarks(e.currentTarget.checked)} />{ts('bookmarks')}
          </label></Show>
        </fieldset>
        <div class="sheet-links-muted">{ts('outputNote')}</div>
      </Show>

      <Show when={phase() === 'preview' && plan()}>
        <div class="sheet-links-muted" id="set-link-summary">
          {plan().registered
            ? ts('registeredSummary', { ready: plan().links.length, review: plan().review.length,
                blocked: plan().review.length - plan().links.length, noText: plan().pagesWithoutText.length })
            : ts('previewSummary', {
                links: plan().links.length, remote: remoteCount(), files: plan().files.length,
                self: skippedBy('self'), existing: skippedBy('existing'), noText: plan().pagesWithoutText.length,
              })}
        </div>
        <Show when={plan().registered}>
          <div class="sheet-links-muted">{plan().indexMode
            ? 'Only distinct sheet-number rows on the selected index page can become links. Unmatched, repeated, changed, or unverified targets stay blocked.'
            : ts('registeredNote')}</div>
          <Show when={plan().scans.some(scan => !scan)}>
            <div class="sheet-links-warning">{ts('unreadableFiles')}</div>
          </Show>
          <div class="sheet-links-table-wrap">
            <table class="sheet-links-table" id="set-link-registered-review">
              <thead><tr><th class="num">
                <input type="checkbox" aria-label={td('batchLink.all')} disabled={!checked().length}
                  checked={checked().length > 0 && checked().every(Boolean)}
                  onChange={e => setChecked(checked().map(() => e.currentTarget.checked))} />
              </th><th>{ts('file')}</th><th>{ts('sourceIdentity')}</th><th>{td('batchLink.text')}</th>
                <th>{ts('targetIdentity')}</th><th>{ts('reviewStatus')}</th></tr></thead>
              <tbody>
                <For each={plan().review}>{row => <tr>
                  <td class="num"><Show when={row.status === 'ready'}>
                    <input type="checkbox" aria-label={`${row.label} ${row.text}`} checked={checked()[row.linkIndex]}
                      onChange={e => setChecked(checked().map((value, index) => index === row.linkIndex ? e.currentTarget.checked : value))} />
                  </Show></td>
                  <td>{fileName(row.file)} · {ts('page', { page: row.page })}</td>
                  <td>{row.sourceSheetId || ts('unregisteredSource')}</td>
                  <td>{row.text}</td>
                  <td>{reviewTarget(row)}</td>
                  <td>{ts(`review.${row.status}`)}</td>
                </tr>}</For>
              </tbody>
            </table>
          </div>
        </Show>
        <Show when={plan().ambiguous?.length}>
          <div class="sheet-links-warning">{ts('ambiguous', { labels: plan().ambiguous.map((a) => a.label).join(', ') })}</div>
        </Show>
        <Show when={!plan().registered}><div class="sheet-links-table-wrap">
          <table class="sheet-links-table" id="set-link-preview">
            <thead>
              <tr>
                <th class="num">
                  <input type="checkbox" aria-label={td('batchLink.all')} checked={checked().every(Boolean)}
                    onChange={(e) => setChecked(checked().map(() => e.currentTarget.checked))} />
                </th>
                <th>{ts('file')}</th>
                <th>{ts('sheet')}</th>
                <th>{td('batchLink.text')}</th>
                <th>{td('batchLink.target')}</th>
              </tr>
            </thead>
            <tbody>
              <Index each={plan().links}>
                {(link, i) => (
                  <tr>
                    <td class="num">
                      <input type="checkbox" checked={checked()[i]} onChange={(e) => setChecked(checked().map((c, k) => (k === i ? e.currentTarget.checked : c)))} />
                    </td>
                    <td>{fileName(link().file)}</td>
                    <td>{sheetOf(link().file, link().page)}</td>
                    <td>{link().text}</td>
                    <td>{link().target.file === link().file
                      ? sheetOf(link().file, link().target.page)
                      : `${fileName(link().target.file)} · ${sheetOf(link().target.file, link().target.page)}`}</td>
                  </tr>
                )}
              </Index>
            </tbody>
          </table>
        </div></Show>
      </Show>

      <Show when={busy() && progress()}>
        <div class="sheet-links-muted" role="status">{progress()}</div>
      </Show>
      <Show when={phase() === 'done'}>
        <div id="set-link-result" class="set-batch-link-result">{result()}</div>
      </Show>
      <Show when={message()}>
        <div class="sheet-links-warning" role="status">{message()}</div>
      </Show>
    </Dialog>
  );
}
