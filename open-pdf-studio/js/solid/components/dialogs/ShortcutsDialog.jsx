import { For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { SHORTCUTS, shortcutKeys, displayKeys } from '../../../tools/shortcut-table.js';

// The dialog lists the same table the keyboard handler dispatches
// (tools/shortcut-table.js), so what it shows is what the keys do.
const COLUMNS = [
  ['tools', 'measure', 'markup'],
  ['file', 'edit', 'view', 'cad'],
];

const entriesOf = (category) => SHORTCUTS.filter(entry => entry.category === category);

export default function ShortcutsDialog() {
  const { t } = useTranslation('dialogs');
  const close = () => closeDialog('shortcuts');

  return (
    <Dialog
      title={t('shortcuts.title')}
      dialogClass="shortcuts-dialog"
      onClose={close}
    >
      <div class="shortcuts-grid" style={{ 'max-height': '70vh', overflow: 'auto' }}>
        <For each={COLUMNS}>
          {(categories) => (
            <div class="shortcuts-column">
              <For each={categories}>
                {(category) => (
                  <div class="shortcuts-category" data-category={category}>
                    <h3>{t(`shortcuts.categories.${category}`)}</h3>
                    <For each={entriesOf(category)}>
                      {(entry) => (
                        <div class="shortcuts-row" data-shortcut={entry.id}>
                          <span class="shortcuts-action">{t(entry.label || `shortcuts.actions.${entry.id}`)}</span>
                          <span class="shortcuts-keys">
                            <For each={entry.display ? [entry.display] : shortcutKeys(entry)}>
                              {(binding, i) => (
                                <>
                                  {i() > 0 ? <span>/</span> : null}
                                  <For each={displayKeys(binding)}>{(key) => <kbd>{key}</kbd>}</For>
                                </>
                              )}
                            </For>
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  );
}
