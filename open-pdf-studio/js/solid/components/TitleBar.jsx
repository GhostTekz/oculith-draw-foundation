// Window chrome pieces of the merged menu/title row (menubar/MenuBar.jsx):
// the edition logo and the Tauri window controls. The window is frameless,
// so the menu row is also the title bar: MenuBar marks its empty space as
// the drag region (data-tauri-drag-region). The file name is shown in the
// OS window title only (ui/chrome/tabs.js updateWindowTitle). In the
// browser build there are no window controls.

import { createSignal, onMount, onCleanup, Show } from 'solid-js';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { getDialogs } from '../stores/dialogStore.js';
import { isTauri } from '../../core/platform.js';
import { edition } from '../../editions/active.js';

export async function handleClose() {
  const { closeActiveTab } = await import('../../ui/chrome/tabs.js');
  const { closeWindow } = await import('../../core/platform.js');
  while (state.documents.length > 0) {
    const closed = await closeActiveTab();
    if (!closed) return;
  }
  closeWindow();
}

export const hasDialogs = () => getDialogs().length > 0;

export function AppLogo() {
  return <img src={edition.logoPath} class="app-icon" alt={edition.productName} />;
}

export function WindowControls() {
  const { t } = useTranslation('common');
  const [isMaximized, setIsMaximized] = createSignal(false);
  let unlisten = null;

  onMount(async () => {
    if (!isTauri()) return;
    try {
      const win = window.__TAURI__?.window;
      if (!win) return;
      const currentWindow = win.getCurrentWindow();
      setIsMaximized(await currentWindow.isMaximized());
      unlisten = await currentWindow.onResized(async () => {
        setIsMaximized(await currentWindow.isMaximized());
      });
    } catch (e) { /* ignore */ }
  });

  onCleanup(() => { if (unlisten) unlisten(); });

  return (
    <Show when={isTauri()}>
      <div class="window-controls">
        <button class="window-btn" title={t('minimize')} disabled={hasDialogs()}
          onClick={() => import('../../core/platform.js').then(m => m.minimizeWindow())}>
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="window-btn" title={isMaximized() ? t('restore') : t('maximize')} disabled={hasDialogs()}
          onClick={() => import('../../core/platform.js').then(m => m.maximizeWindow())}>
          {isMaximized() ? (
            <svg width="10" height="10" viewBox="2 2 12 12" fill="currentColor">
              <path d="M5.08496 4C5.29088 3.4174 5.8465 3 6.49961 3H9.99961C11.6565 3 12.9996 4.34315 12.9996 6V9.5C12.9996 10.1531 12.5822 10.7087 11.9996 10.9146V6C11.9996 4.89543 11.1042 4 9.99961 4H5.08496ZM4.5 5H9.5C10.3284 5 11 5.67157 11 6.5V11.5C11 12.3284 10.3284 13 9.5 13H4.5C3.67157 13 3 12.3284 3 11.5V6.5C3 5.67157 3.67157 5 4.5 5ZM4.5 6C4.22386 6 4 6.22386 4 6.5V11.5C4 11.7761 4.22386 12 4.5 12H9.5C9.77614 12 10 11.7761 10 11.5V6.5C10 6.22386 9.77614 6 9.5 6H4.5Z"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
          )}
        </button>
        <button class="window-btn window-btn-close" title={t('close')} disabled={hasDialogs()}
          onClick={handleClose}>
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
    </Show>
  );
}
