import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { sheetRegister } from '../../stores/sheetRegisterStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  isTauri, openFileDialog, openFolderDialog, listPdfFiles, readBinaryFile, writeBinaryFile, fileExists, invoke,
} from '../../../core/platform.js';
import { runBatch, writeBatchOutputs, batchFileList, setFilePaths } from '../../../batch/runner.js';
import { SUMMARY_FORMATS, SUMMARY_SORT_KEYS } from '../../../batch/summary-output.js';

const NAME = 'batch-summary';

// Batch ▸ Summary: files from the current Set, a file pick or a folder, run
// one at a time with progress and cancel; one CSV / XLSX / PDF summary.
export default function BatchSummaryDialog() {
  const { t } = useTranslation('common');
  const tb = (key, options) => t(`batchSummary.${key}`, options);
  const [files, setFiles] = createSignal(batchFileList(setFilePaths(sheetRegister())));
  const [selected, setSelected] = createSignal(-1);
  const [formats, setFormats] = createSignal([...SUMMARY_FORMATS]);
  const [sortBy, setSortBy] = createSignal('file');
  const [running, setRunning] = createSignal(false);
  const [progress, setProgress] = createSignal(null); // { index, total, name } | { phase }
  const [log, setLog] = createSignal({}); // path -> entry
  const [message, setMessage] = createSignal('');
  let controller = null;

  const addPaths = (paths) => {
    const merged = batchFileList([...files().map((f) => f.path), ...(paths || [])]);
    setFiles(merged);
    setMessage('');
  };
  const addSet = () => {
    const paths = setFilePaths(sheetRegister());
    if (!paths.length) { setMessage(tb('setEmpty')); return; }
    addPaths(paths);
  };
  const addFiles = async () => {
    const picked = await openFileDialog(['pdf'], { multiple: true });
    if (picked) addPaths(Array.isArray(picked) ? picked : [picked]);
  };
  const addFolder = async () => {
    const dir = await openFolderDialog(tb('addFolder'));
    if (!dir) return;
    try { addPaths(await listPdfFiles(dir)); } catch (error) { setMessage(tb('failed', { error: error?.message || error })); }
  };
  const removeSelected = () => {
    const index = selected();
    if (index < 0) return;
    setFiles(files().filter((_, i) => i !== index));
    setSelected(Math.min(index, files().length - 1));
  };
  const toggleFormat = (format, on) => {
    const next = new Set(formats());
    if (on) next.add(format); else next.delete(format);
    setFormats(SUMMARY_FORMATS.filter((f) => next.has(f)));
  };

  const readFile = async (path) => {
    if (isTauri()) {
      try { await invoke('allow_fs_scope', { path }); } catch { /* scope already granted */ }
    }
    const bytes = await readBinaryFile(path);
    if (!bytes && !isTauri()) throw new Error(tb('notInBrowser'));
    return bytes;
  };

  const run = async () => {
    if (running() || !files().length) return;
    if (!formats().length) { setMessage(tb('noFormat')); return; }
    setMessage('');
    setLog({});
    let dir = '';
    if (isTauri()) {
      dir = await openFolderDialog(tb('outputFolder'));
      if (!dir) return;
    }
    controller = new AbortController();
    const signal = controller.signal;
    setRunning(true);
    try {
      const [pdfjs, { batchSummaryJob }] = await Promise.all([
        import('pdfjs-dist'), import('../../../batch/summary-job.js'),
        // The loader configures the PDF.js worker.
        import('../../../pdf/loader.js'),
      ]);
      let fontBytes;
      if (formats().includes('pdf')) {
        const response = await fetch('/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf');
        if (!response.ok) throw new Error('Could not load the bundled summary font.');
        fontBytes = new Uint8Array(await response.arrayBuffer());
      }
      const job = batchSummaryJob({ pdfjs, sortBy: sortBy(), formats: formats(), fontBytes });
      const list = files();
      const result = await runBatch({
        files: list, readFile, job, signal,
        onProgress: (p) => {
          if (p.phase === 'file') setProgress({ index: p.index + 1, total: p.total, name: p.file.name });
          else if (p.phase === 'done') setLog({ ...log(), [p.file.path]: p.entry });
          else if (p.phase === 'finish') setProgress({ phase: 'building' });
        },
      });
      if (result.cancelled) { setMessage(tb('cancelled')); return; }
      const { summary, outputs } = result.output;
      if (!summary) { setMessage(tb('nothingRead')); return; }
      setProgress({ phase: 'writing' });
      await writeBatchOutputs(outputs, {
        dir, sources: list.map((f) => f.path), exists: (path) => fileExists(path).catch(() => false),
        write: async (path, bytes) => {
          if (isTauri()) {
            try { await invoke('allow_fs_scope', { path }); } catch { /* scope already granted */ }
          }
          await writeBinaryFile(path, bytes);
        },
      });
      const failed = result.log.filter((e) => !e.ok).length;
      setMessage([tb('done', { count: summary.rows.length, files: result.log.length - failed }),
        failed ? tb('doneFailures', { failed }) : ''].filter(Boolean).join(' '));
    } catch (error) {
      setMessage(tb('writeFailed', { error: error?.message || String(error) }));
    } finally {
      controller = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const cancelRun = () => controller?.abort();
  const close = () => { cancelRun(); closeDialog(NAME); };

  const statusOf = (file) => {
    const entry = log()[file.path];
    if (entry) return entry.ok ? { cls: 'ok', text: tb('markups', { count: entry.detail }) } : { cls: 'error', text: tb('failed', { error: entry.error }) };
    const p = progress();
    if (running() && p?.index && files()[p.index - 1]?.path === file.path) return { cls: 'busy', text: tb('reading') };
    return running() ? { cls: '', text: tb('waiting') } : { cls: '', text: '' };
  };
  const progressText = () => {
    const p = progress();
    if (!p) return '';
    if (p.phase) return tb(p.phase);
    return tb('progress', p);
  };
  const fraction = () => {
    const p = progress();
    if (!p) return 0;
    if (p.phase) return 1;
    return (p.index - 1) / Math.max(1, p.total);
  };

  const footer = (
    <>
      <div class="batch-summary-footer-left">{tb('sourcesNote')}</div>
      <div class="batch-summary-footer-right">
        <Show when={running()} fallback={
          <button class="pref-btn pref-btn-primary" disabled={!files().length} onClick={run}>{tb('run')}</button>
        }>
          <button class="pref-btn pref-btn-primary" onClick={cancelRun}>{tb('cancelRun')}</button>
        </Show>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{t('close')}</button>
      </div>
    </>
  );

  return (
    <Dialog title={tb('title')} dialogClass="batch-summary-dialog" bodyClass="batch-summary-body"
      footerClass="batch-summary-footer" onClose={close} footer={footer}>
      <div class="batch-summary-section-title">{tb('files')}</div>
      <div class="batch-summary-actions">
        <button class="pref-btn pref-btn-secondary" disabled={running()} onClick={addSet}>{tb('addSet')}</button>
        <button class="pref-btn pref-btn-secondary" disabled={running()} onClick={addFiles}>{tb('addFiles')}</button>
        <Show when={isTauri()}>
          <button class="pref-btn pref-btn-secondary" disabled={running()} onClick={addFolder}>{tb('addFolder')}</button>
        </Show>
        <span class="batch-summary-spacer" />
        <button class="pref-btn pref-btn-secondary" disabled={running() || selected() < 0} onClick={removeSelected}>{tb('remove')}</button>
        <button class="pref-btn pref-btn-secondary" disabled={running() || !files().length} onClick={() => { setFiles([]); setSelected(-1); setLog({}); }}>{tb('clear')}</button>
      </div>
      <div class="batch-summary-list" role="listbox" aria-label={tb('files')}>
        <Show when={files().length} fallback={<div class="batch-summary-empty">{tb('noFiles')}</div>}>
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
      <div class="batch-summary-options">
        <div class="batch-summary-option">
          <span class="batch-summary-label">{tb('output')}</span>
          <For each={SUMMARY_FORMATS}>
            {(format) => (
              <label class="batch-summary-check">
                <input type="checkbox" disabled={running()} checked={formats().includes(format)}
                  onChange={(e) => toggleFormat(format, e.currentTarget.checked)} />
                {format.toUpperCase()}
              </label>
            )}
          </For>
        </div>
        <label class="batch-summary-option">
          <span class="batch-summary-label">{tb('sortBy')}</span>
          <select class="batch-summary-select" disabled={running()} value={sortBy()} onChange={(e) => setSortBy(e.currentTarget.value)}>
            <For each={SUMMARY_SORT_KEYS}>{(key) => <option value={key}>{tb(`sort.${key}`)}</option>}</For>
          </select>
        </label>
      </div>
      <Show when={running()}>
        <div class="batch-summary-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(fraction() * 100)}>
          <div class="batch-summary-progress-bar" style={{ width: `${Math.round(fraction() * 100)}%` }} />
        </div>
        <div class="batch-summary-progress-text">{progressText()}</div>
      </Show>
      <Show when={message()}>
        <div class="batch-summary-message" role="status">{message()}</div>
      </Show>
    </Dialog>
  );
}
