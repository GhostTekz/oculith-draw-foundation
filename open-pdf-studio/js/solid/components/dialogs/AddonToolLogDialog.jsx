// The session log of add-on tool calls over the AI link
// (js/mcp/addon-tools.js): what was called, with which arguments, whether the
// user approved it, and how it ended.
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  auditLog, clearAuditLog, resetSessionApprovals, sessionApprovals, subscribe,
} from '../../../mcp/addon-tools.js';

const DECISION_KEY = {
  read: 'decisionRead', approve: 'decisionApprove', always: 'decisionAlways', session: 'decisionSession',
  deny: 'decisionDeny', timeout: 'decisionTimeout', invalid: 'decisionInvalid', unknown: 'decisionUnknown',
};

export default function AddonToolLogDialog() {
  const { t } = useTranslation('dialogs');
  const [rows, setRows] = createSignal(auditLog().reverse());
  const [always, setAlways] = createSignal(sessionApprovals());
  onMount(() => {
    const stop = subscribe(() => { setRows(auditLog().reverse()); setAlways(sessionApprovals()); });
    onCleanup(stop);
  });
  const close = () => closeDialog('addon-tool-log');
  const time = (iso) => { try { return new Date(iso).toLocaleTimeString(); } catch { return iso; } };

  return (
    <Dialog
      title={t('addonTools.title')}
      dialogClass="addon-tool-log-dialog"
      onClose={close}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="pref-btn pref-btn-secondary" disabled={!always().length} onClick={resetSessionApprovals}>
            {t('addonTools.resetAlways')}
          </button>
          <button class="pref-btn pref-btn-secondary" disabled={!rows().length} onClick={clearAuditLog}>
            {t('addonTools.clear')}
          </button>
          <button class="pref-btn pref-btn-primary" onClick={close}>{t('addonTools.close')}</button>
        </div>
      }
    >
      <div style="min-width:520px;max-width:760px">
        <div style="opacity:0.8;padding-bottom:6px">{t('addonTools.hint')}</div>
        <Show when={rows().length} fallback={<div style="opacity:0.7">{t('addonTools.empty')}</div>}>
          <div class="addon-tool-log-scroll">
            <table class="addon-tool-log">
              <thead>
                <tr>
                  <th>{t('addonTools.time')}</th><th>{t('addonTools.tool')}</th><th>{t('addonTools.arguments')}</th>
                  <th>{t('addonTools.decision')}</th><th>{t('addonTools.result')}</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(r) => (
                    <tr classList={{ 'addon-tool-log-write': !!r.writes, 'addon-tool-log-failed': !r.ok }}>
                      <td>{time(r.at)}</td>
                      <td title={r.tool}>{r.title || r.tool}</td>
                      <td class="addon-tool-log-args" title={r.args}>{r.args}</td>
                      <td>{t(`addonTools.${DECISION_KEY[r.decision] || 'decisionUnknown'}`)}</td>
                      <td title={r.error || ''}>
                        {r.ok ? t('addonTools.ok') : (r.error ? t('addonTools.failed', { error: r.error }) : '-')}
                        <Show when={r.ms}> ({r.ms} ms)</Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
