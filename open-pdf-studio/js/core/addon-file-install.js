// Install add-on files (`.ocaddon`, a zip of one or more verified packages)
// that the user opens with the app. The native side extracts and verifies the
// whole file before it installs anything; new add-ons load after a restart.
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauri } from './platform.js';

export const ADDON_FILE_EXTENSIONS = ['ocaddon', 'zip'];
export const ADDONS_CHANGED_EVENT = 'addons:changed';

const invoke = (name, args) => window.__TAURI__.core.invoke(name, args);

/** "example.tools 1.0.0 and the edition package example.edition 2.0.0" */
export function describeInstalled(items) {
  const parts = (Array.isArray(items) ? items : [items]).filter(Boolean).map((item) =>
    `${item.kind === 'edition' ? 'the edition package ' : ''}${item.id}${item.version ? ` ${item.version}` : ''}`);
  if (parts.length <= 1) return parts[0] || 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

export function errorText(error, fallback = 'The add-on operation failed.') {
  return typeof error === 'string' ? error : error?.message || fallback;
}

export async function installAddonFile(source) {
  const installed = await invoke('addon_file_install', { source });
  window.dispatchEvent(new CustomEvent(ADDONS_CHANGED_EVENT));
  return installed;
}

export async function restartEditor() {
  await relaunch();
}

function fileName(filePath) {
  return String(filePath).split(/[\\/]/).pop() || String(filePath);
}

async function ask(text, title, kind = 'warning') {
  const dialog = window.__TAURI__?.dialog;
  return dialog?.ask ? dialog.ask(text, { title, kind }) : window.confirm(text);
}

async function tell(text, title, kind = 'info') {
  const dialog = window.__TAURI__?.dialog;
  if (dialog?.message) await dialog.message(text, { title, kind });
  else window.alert(text);
}

/**
 * Ask before installing each add-on file opened with the app, one at a time.
 * Paths come from the launch arguments (buffered natively) and from later
 * `open-addon-files` events; a path already waiting is not asked twice.
 */
export function setupAddonFileOpen() {
  if (!isTauri() || !window.__TAURI__?.event) return;
  const waiting = new Set();
  let chain = Promise.resolve();

  const handle = async (filePath) => {
    try {
      const confirmed = await ask(
        `Install the add-on file "${fileName(filePath)}"? Add-ons run with the editor's access to local files. Install only add-ons from a source you trust.`,
        'Install add-on');
      if (!confirmed) return;
      let installed;
      try { installed = await installAddonFile(filePath); }
      catch (error) { await tell(errorText(error, 'The add-on file could not be installed.'), 'Add-on not installed', 'error'); return; }
      if (await ask(`Installed ${describeInstalled(installed)}. Restart the editor now to load it?`, 'Add-on installed', 'info')) {
        await restartEditor();
      }
    } finally { waiting.delete(filePath); }
  };

  const enqueue = (paths) => {
    for (const filePath of Array.isArray(paths) ? paths : []) {
      if (typeof filePath !== 'string' || !filePath || waiting.has(filePath)) continue;
      waiting.add(filePath);
      chain = chain.then(() => handle(filePath)).catch((error) => console.warn('Add-on file install failed:', error));
    }
  };

  window.__TAURI__.event.listen('open-addon-files', (event) => enqueue(event.payload));
  invoke('addon_opened_files_take').then(enqueue).catch((error) => console.warn('Could not read opened add-on files:', error));
}
