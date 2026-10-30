import { createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { isTauri } from '../../../core/platform.js';
import {
  ADDON_FILE_EXTENSIONS, ADDONS_CHANGED_EVENT, describeInstalled, errorText, installAddonFile, restartEditor,
} from '../../../core/addon-file-install.js';

// Local packages and the optional full edition package are selected at
// startup. This panel changes the on-disk set only; it never loads arbitrary
// package code into a running app.
export default function AddonPackagesSection() {
  const [packages, setPackages] = createSignal([]);
  const [edition, setEdition] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [restart, setRestart] = createSignal(false);

  const invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
  async function refresh() {
    if (!isTauri()) return;
    const [rows, active] = await Promise.all([invoke('addon_packages_list'), invoke('addon_edition_info')]);
    setPackages(rows);
    setEdition(active || null);
  }
  const changedElsewhere = () => {
    setRestart(true);
    refresh().catch(() => setMessage('Could not read the local add-on list.'));
  };
  onMount(() => {
    refresh().catch(() => setMessage('Could not read the local add-on list.'));
    window.addEventListener(ADDONS_CHANGED_EVENT, changedElsewhere);
  });
  onCleanup(() => window.removeEventListener(ADDONS_CHANGED_EVENT, changedElsewhere));

  async function change(action, success) {
    if (busy()) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await action();
      await refresh();
      setRestart(true);
      setMessage(typeof success === 'function' ? success(result) : success);
    } catch (error) {
      setMessage(errorText(error));
    } finally { setBusy(false); }
  }

  async function installFolder() {
    if (!isTauri() || busy()) return;
    try {
      const source = await window.__TAURI__.dialog?.open({ directory: true, multiple: false });
      if (typeof source !== 'string' || !source) return;
      await change(() => invoke('addon_install_folder', { source }),
        (installed) => `Installed ${describeInstalled(installed)}. Restart to load it.`);
    } catch (error) { setMessage(error?.message || 'Could not select a package folder.'); }
  }

  async function installFile() {
    if (!isTauri() || busy()) return;
    try {
      const source = await window.__TAURI__.dialog?.open({
        directory: false, multiple: false,
        filters: [{ name: 'Add-on file', extensions: ADDON_FILE_EXTENSIONS }],
      });
      if (typeof source !== 'string' || !source) return;
      await change(() => installAddonFile(source),
        (installed) => `Installed ${describeInstalled(installed)}. Restart to load it.`);
    } catch (error) { setMessage(error?.message || 'Could not select an add-on file.'); }
  }

  async function confirmRemoval(text) {
    return window.__TAURI__.dialog?.ask
      ? window.__TAURI__.dialog.ask(text, { title: 'Remove add-on', kind: 'warning' })
      : confirm(text);
  }

  async function toggle(row) {
    await change(() => invoke('addon_package_set_enabled', { id: row.id, enabled: !row.enabled }),
      `Add-on ${row.enabled ? 'disabled' : 'enabled'}. Restart to apply the change.`);
  }

  async function remove(row) {
    if (busy()) return;
    if (!await confirmRemoval(`Remove ${row.id} from this app? Saved documents remain available.`)) return;
    await change(() => invoke('addon_package_remove', { id: row.id }),
      'Add-on removed. Restart to apply the change.');
  }

  async function removeEdition() {
    if (busy()) return;
    const name = edition()?.id || 'the edition package';
    if (!await confirmRemoval(`Remove ${name} from this app? The editor starts with its built-in features after a restart. Saved documents remain available.`)) return;
    await change(() => invoke('addon_edition_remove'), 'Edition package removed. Restart to apply the change.');
  }

  async function restartNow() {
    try { await restartEditor(); }
    catch (error) { setMessage(errorText(error, 'Could not restart the editor. Close and open it again.')); }
  }

  return <section class="addon-package-section" aria-label="Local add-ons">
    <h3 class="ext-section-title">Local add-ons</h3>
    <p class="ext-install-hint">Choose an add-on file (.ocaddon) or a package folder from your computer. The app checks the version, files and target of every package before installing it. Add-ons run with the editor’s access to local files; install only add-ons you trust.</p>
    <Show when={isTauri()} fallback={<p class="ext-install-hint">Local add-ons require the desktop app.</p>}>
      <div class="addon-package-install">
        <button type="button" class="ext-install-btn" onClick={installFile} disabled={busy()} data-addon-file-install>Install add-on file…</button>
        <button type="button" class="ext-install-btn" onClick={installFolder} disabled={busy()} data-addon-package-install>Install package folder…</button>
      </div>
      <Show when={message()}><p role="status" class="addon-package-message">{message()}</p></Show>
      <Show when={restart()}>
        <div class="addon-package-restart">
          <span>Restart the editor to apply add-on changes.</span>
          <button type="button" onClick={restartNow} data-addon-restart>Restart now</button>
        </div>
      </Show>
      <Show when={edition()}>{(active) => <div class="addon-package-list" data-addon-edition>
        <div class="addon-package-row">
          <div class="addon-package-info">
            <strong>{active().id || 'Edition package'}</strong>
            <span>{active().version ? `v${active().version} · ` : ''}{active().valid
              ? active().included ? 'Included with this installation' : 'Edition package'
              : 'Edition package · invalid or incompatible'}</span>
          </div>
          <Show when={!active().included}>
            <div class="addon-package-actions">
              <button type="button" disabled={busy()} onClick={removeEdition}>Remove</button>
            </div>
          </Show>
        </div>
      </div>}</Show>
      <Show when={!packages().length && !edition()}><p class="ext-empty">No local add-ons installed.</p></Show>
      <div class="addon-package-list">
        <For each={packages()}>{(row) => <div class="addon-package-row">
          <div class="addon-package-info">
            <strong>{row.id}</strong>
            <span>{row.version ? `v${row.version} · ` : ''}{row.valid ? row.enabled ? 'Enabled' : 'Disabled' : 'Invalid or incompatible'}</span>
          </div>
          <div class="addon-package-actions">
            <button type="button" disabled={busy() || (!row.valid && !row.enabled)} onClick={() => toggle(row)}>
              {row.enabled ? 'Disable' : 'Enable'}
            </button>
            <button type="button" disabled={busy()} onClick={() => remove(row)}>Remove</button>
          </div>
        </div>}</For>
      </div>
    </Show>
  </section>;
}
