import { createSignal, For, Show, onMount } from 'solid-js';
import { isTauri } from '../../../core/platform.js';

// Independent local packages are selected at startup. This panel changes the
// on-disk set only; it never loads arbitrary package code into a running app.
export default function AddonPackagesSection() {
  const [packages, setPackages] = createSignal([]);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [restart, setRestart] = createSignal(false);

  const invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
  async function refresh() {
    if (!isTauri()) return;
    setPackages(await invoke('addon_packages_list'));
  }
  onMount(() => { refresh().catch(() => setMessage('Could not read the local add-on list.')); });

  async function change(action, success) {
    if (busy()) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
      await refresh();
      setRestart(true);
      setMessage(success);
    } catch (error) {
      setMessage(typeof error === 'string' ? error : error?.message || 'The add-on operation failed.');
    } finally { setBusy(false); }
  }

  async function install() {
    if (!isTauri() || busy()) return;
    try {
      const source = await window.__TAURI__.dialog?.open({ directory: true, multiple: false });
      if (typeof source !== 'string' || !source) return;
      await change(() => invoke('addon_package_install', { source }), 'Add-on installed. Restart to load it.');
    } catch (error) { setMessage(error?.message || 'Could not select a package folder.'); }
  }

  async function toggle(row) {
    await change(() => invoke('addon_package_set_enabled', { id: row.id, enabled: !row.enabled }),
      `Add-on ${row.enabled ? 'disabled' : 'enabled'}. Restart to apply the change.`);
  }

  async function remove(row) {
    if (busy()) return;
    const confirmed = window.__TAURI__.dialog?.ask
      ? await window.__TAURI__.dialog.ask(`Remove ${row.id} from this app? Saved documents remain available.`,
        { title: 'Remove add-on', kind: 'warning' })
      : confirm(`Remove ${row.id} from this app?`);
    if (!confirmed) return;
    await change(() => invoke('addon_package_remove', { id: row.id }),
      'Add-on removed. Restart to apply the change.');
  }

  return <section class="addon-package-section" aria-label="Local add-ons">
    <h3 class="ext-section-title">Local add-ons</h3>
    <p class="ext-install-hint">Choose a package folder from your computer. The app checks its version, files and target before installing it. Packages run with the editor’s access to local files; install only packages you trust.</p>
    <Show when={isTauri()} fallback={<p class="ext-install-hint">Local add-ons require the desktop app.</p>}>
      <button type="button" class="ext-install-btn" onClick={install} disabled={busy()} data-addon-package-install>Install package folder…</button>
      <Show when={message()}><p role="status" class="addon-package-message">{message()}</p></Show>
      <Show when={restart()}><p class="addon-package-restart">Restart the editor to apply add-on changes.</p></Show>
      <Show when={!packages().length}><p class="ext-empty">No local add-on packages installed.</p></Show>
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
