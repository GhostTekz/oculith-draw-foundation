import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import { activeWorkspaceProfile, applyWorkspaceProfile, WORKSPACE_PROFILES } from '../../stores/workspaceProfiles.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function WorkspaceProfilePicker() {
  const { t } = useTranslation('common');
  const [open, setOpen] = createSignal(false);
  let picker;
  let toggle;
  let menu;

  // Profiles are whole panel layouts (workspaceLayout.js); until the menu bar's
  // Oculith ▸ Profiles lands, this picker is the switcher.
  const label = (profile) => t(`panelHost.profile.${profile}`);

  const focusItem = (last = false) => {
    const items = menu?.querySelectorAll('[role="menuitemradio"]');
    items?.[last ? items.length - 1 : 0]?.focus();
  };
  const openMenu = (last = false) => {
    setOpen(true);
    queueMicrotask(() => focusItem(last));
  };
  const onToggleKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    if (open()) focusItem(event.key === 'ArrowUp');
    else openMenu(event.key === 'ArrowUp');
  };
  const onMenuKeyDown = (event) => {
    const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
    const current = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (current + items.length - 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      toggle?.focus();
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  };

  onMount(() => {
    const dismiss = (event) => {
      if (!picker?.contains(event.target)) setOpen(false);
      if (event.key === 'Escape' && open()) {
        setOpen(false);
        picker?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    onCleanup(() => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    });
  });

  return (
    <div class="workspace-profile-picker" ref={picker} onFocusOut={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button type="button" class="workspace-profile-toggle" ref={toggle} aria-haspopup="menu"
        aria-expanded={open()} aria-controls="workspace-profile-menu"
        title={t('panelHost.profile.title')} onKeyDown={onToggleKeyDown}
        onClick={() => { if (open()) setOpen(false); else openMenu(); }}>
        <span>{label(activeWorkspaceProfile())}</span><span aria-hidden="true">▾</span>
      </button>
      <Show when={open()}>
        <div class="workspace-profile-menu" id="workspace-profile-menu" role="menu" ref={menu}
          onKeyDown={onMenuKeyDown}>
          <For each={WORKSPACE_PROFILES}>{(profile) =>
            <button type="button" role="menuitemradio" tabIndex="-1"
              aria-checked={activeWorkspaceProfile() === profile}
              onClick={() => { applyWorkspaceProfile(profile); setOpen(false); toggle?.focus(); }}>
              <span>{label(profile)}</span>
              <Show when={activeWorkspaceProfile() === profile}><span aria-hidden="true">✓</span></Show>
            </button>
          }</For>
        </div>
      </Show>
    </div>
  );
}
