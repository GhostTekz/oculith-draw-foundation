// Start-up. An optional add-on is loaded through js/plugin/host.js before
// the editor starts; without one, the editor runs as Foundation.
import { EARLY, HOST_API_VERSION, installHost, loadHostModules } from './plugin/host.js';
import { finish, setEdition, setStatus, side, startLaunchScreen } from './launch-screen.js';
import { edition as foundation } from './editions/community.js';

// The edition's word under the monolith: the last word of its product name.
const editionWord = (edition) => edition.launchWord || String(edition.productName || '').split(' ').pop();
const secondaryWindow = new URLSearchParams(location.search).get('view') === 'printqueue';

async function findPlugin(options) {
  const tauri = window.__TAURI__?.core;
  if (!tauri?.invoke) return null;
  try { return await tauri.invoke('edition_plugin', options); } catch { return null; }
}

// A release build serves the plug-in beside the editor's files: the web view
// fetches and parses it (and caches it like the editor's chunks) while the
// editor's own modules load; it runs only once the interface is ready. A
// development build hands over the program text, imported from a Blob.
function preloadPlugin(found) {
  if (!found.url) return;
  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.href = found.url;
  document.head.append(link);
}

async function importPlugin(found) {
  if (found.url) return import(/* @vite-ignore */ new URL(found.url, location.href).href);
  const url = URL.createObjectURL(new Blob([found.js], { type: 'text/javascript' }));
  try { return await import(/* @vite-ignore */ url); } finally { URL.revokeObjectURL(url); }
}

async function installPlugin(found) {
  installHost();
  preloadPlugin(found);
  if (found.css) {
    const style = document.createElement('style');
    style.dataset.editionPlugin = '';
    style.textContent = found.css;
    document.head.append(style);
  }
  await loadHostModules(EARLY, { parallel: true });
  let plugin;
  try {
    plugin = await importPlugin(found);
  } catch (error) {
    // The served file could not be loaded: take the program text instead.
    const inline = found.url ? await findPlugin({ inline: true }) : null;
    if (!inline?.js) throw error;
    console.warn('[edition] the plug-in could not load from its URL; loading its text.', error);
    plugin = await importPlugin(inline);
  }
  if (plugin.hostApiVersion !== HOST_API_VERSION) {
    throw new Error(`The edition plug-in needs plug-in interface ${plugin.hostApiVersion}; this editor provides ${HOST_API_VERSION}.`);
  }
  const edition = plugin.createEdition();
  globalThis.__ocudrawEdition = edition;
  setEdition(editionWord(edition));
  setStatus(`Loading ${editionWord(edition)}`);
  await loadHostModules(plugin.requires || []);
  await plugin.start?.();
  return plugin;
}

(async () => {
  if (secondaryWindow) document.getElementById('launch-screen')?.remove();
  else startLaunchScreen();
  const ready = new Promise((resolve) => {
    window.addEventListener('ocudraw:ready', resolve, { once: true });
    setTimeout(resolve, 30000); // never kept behind the screen
  });
  setStatus('Loading');
  const found = await findPlugin();
  let plugin = null;
  if (found?.url || found?.js) {
    try {
      plugin = await installPlugin(found);
    } catch (error) {
      console.error('[edition] the plug-in could not load; starting without it.', error);
      delete globalThis.__ocudrawEdition;
      plugin = null;
    }
  }
  if (!plugin) setEdition(editionWord(foundation));
  setStatus('Starting');
  await import('./main.js');
  if (secondaryWindow) return;
  await ready;
  if (plugin?.launch) {
    try { await plugin.launch({ side, setStatus }); } catch (error) { console.error('[edition] launch step failed', error); }
  }
  await finish();
})();
