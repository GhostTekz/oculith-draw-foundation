/**
 * Auto-Update Module
 * Uses Tauri Plugin Updater to check for and install updates.
 */

import { isTauri } from '../../core/platform.js';
import { check } from '@tauri-apps/plugin-updater';
import { openDialog } from '../../bridge.js';
import { edition } from '../../editions/active.js';

let checking = false;

/**
 * Check for updates using the Tauri updater plugin.
 * @param {boolean} silent - If true, don't show "no update" or error messages
 */
export async function checkForUpdates(silent = true) {
  // This local fork has no signing key or release endpoint yet. Never consult
  // the upstream application's updater for a differently identified product.
  if (import.meta.env.VITE_OCULITH_UPDATER_ENABLED !== 'true') {
    if (!silent && window.__TAURI__?.dialog?.message) {
      window.__TAURI__.dialog.message(
        `Updates are not configured for this ${edition.productName} build.`,
        { title: 'Software Update', kind: 'info' }
      );
    }
    return;
  }
  if (!isTauri() || checking) return;
  checking = true;

  try {
    const update = await check();

    if (update) {
      const skipVersion = localStorage.getItem('oculithdraw-skip-version');
      if (silent && skipVersion === update.version) {
        return;
      }
      openDialog('update', { update });
    } else {
      if (!silent) showNoUpdateMessage();
    }
  } catch (e) {
    console.warn('Update check failed:', e);
    if (!silent) showUpdateError(e);
  } finally {
    checking = false;
  }
}

function showNoUpdateMessage() {
  if (window.__TAURI__?.dialog?.message) {
    window.__TAURI__.dialog.message(
      `You are running the latest version of ${edition.productName}.`,
      { title: 'Software Update', kind: 'info' }
    );
  }
}

function showUpdateError(error) {
  if (window.__TAURI__?.dialog?.message) {
    window.__TAURI__.dialog.message(
      'Could not check for updates. Please try again later.\n\n' + (error.message || error),
      { title: 'Update Error', kind: 'error' }
    );
  }
}
