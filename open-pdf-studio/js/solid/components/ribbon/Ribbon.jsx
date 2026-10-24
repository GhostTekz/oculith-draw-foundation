import { Show, Switch, Match, ErrorBoundary, onMount, onCleanup, createSignal, For } from 'solid-js';
import RibbonTab from './RibbonTab.jsx';
import HomeTab from './HomeTab.jsx';
import DrawingTab from './DrawingTab.jsx';
import MeasureTab from './MeasureTab.jsx';
import CommentTab from './CommentTab.jsx';
import ViewTab from './ViewTab.jsx';
import OrganizeTab from './OrganizeTab.jsx';
import HelpTab from './HelpTab.jsx';
import FormatTab from './FormatTab.jsx';
import ArrangeTab from './ArrangeTab.jsx';
import ImageTab from './ImageTab.jsx';
import { activeTab, setActiveTab, contextualTabsVisible } from '../../stores/ribbonStore.js';
import { imageSelected } from '../../stores/imageEditStore.js';
import { openAppMenu } from '../../../ui/chrome/menus.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import WorkspaceProfilePicker from './WorkspaceProfilePicker.jsx';
// The tabs run registry commands; make sure they are registered.
import '../../commands/index.js';

export default function Ribbon() {
  const { t } = useTranslation('ribbon');
  const { t: tPreferences } = useTranslation('preferences');
  const [moreOpen, setMoreOpen] = createSignal(false);
  let moreButton;
  let moreMenu;

  const secondaryTabs = () => [
    { id: 'comment', label: t('tabs.comment') },
    { id: 'home', label: t('tabs.home') },
    { id: 'organize', label: t('tabs.organize') },
    { id: 'help', label: t('tabs.help') },
  ];
  const secondaryActive = () => secondaryTabs().some(tab => tab.id === activeTab());
  const focusMoreItem = (last = false) => {
    const items = moreMenu?.querySelectorAll('[role="menuitem"]');
    items?.[last ? items.length - 1 : 0]?.focus();
  };
  const openMore = (last = false) => {
    setMoreOpen(true);
    queueMicrotask(() => focusMoreItem(last));
  };
  const selectSecondaryTab = (id) => {
    setActiveTab(id);
    setMoreOpen(false);
    moreButton?.focus();
  };
  const onMoreKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    if (moreOpen()) focusMoreItem(event.key === 'ArrowUp');
    else openMore(event.key === 'ArrowUp');
  };
  const onMoreMenuKeyDown = (event) => {
    const items = [...moreMenu.querySelectorAll('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (current + items.length - 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setMoreOpen(false);
      moreButton?.focus();
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  };

  // Put markup and takeoff tools in front when the drawing workspace opens.
  // Opening a PDF does not change a later, user-selected tab.
  onMount(() => {
    if (activeTab() === 'home') {
      setActiveTab('drawing');
    }
    const dismissMore = (event) => {
      if (moreButton?.contains(event.target) || moreMenu?.contains(event.target)) return;
      setMoreOpen(false);
    };
    const escapeMore = (event) => {
      if (event.key !== 'Escape' || !moreOpen()) return;
      setMoreOpen(false);
      moreButton?.focus();
    };
    document.addEventListener('pointerdown', dismissMore);
    document.addEventListener('keydown', escapeMore);
    onCleanup(() => {
      document.removeEventListener('pointerdown', dismissMore);
      document.removeEventListener('keydown', escapeMore);
    });
  });

  const ribbonCollapsed = () => state.preferences.ribbonCollapsed === true;
  const toggleCollapsed = () => {
    state.preferences.ribbonCollapsed = !ribbonCollapsed();
    savePreferences();
  };

  return (
    <>
      <div class="ribbon-tabs">
        <RibbonTab label={t('tabs.file')} isFileTab={true} id="file-tab"
          onClick={() => openAppMenu()} />
        <RibbonTab label={t('tabs.review')} dataTab="view"
          isActive={activeTab() === 'view'}
          onClick={() => setActiveTab('view')} />
        <RibbonTab label={tPreferences('tabs.markup')} dataTab="drawing"
          isActive={activeTab() === 'drawing'}
          onClick={() => setActiveTab('drawing')} />
        <RibbonTab label={t('tabs.measure')} dataTab="measure"
          isActive={activeTab() === 'measure'}
          onClick={() => setActiveTab('measure')} />
        <div class="ribbon-more-wrap" onFocusOut={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setMoreOpen(false);
        }}>
          <button type="button" class={`ribbon-tab ribbon-more-tab${secondaryActive() ? ' active' : ''}`}
            id="ribbon-more-tab" ref={moreButton}
            aria-haspopup="menu" aria-expanded={moreOpen()} aria-controls="ribbon-more-menu"
            onKeyDown={onMoreKeyDown}
            onClick={() => { if (moreOpen()) setMoreOpen(false); else openMore(); }}>
            {t('common.more')} <span aria-hidden="true">▾</span>
          </button>
          <Show when={moreOpen()}>
            <div class="ribbon-more-menu" id="ribbon-more-menu" role="menu" ref={moreMenu}
              onKeyDown={onMoreMenuKeyDown}>
              <For each={secondaryTabs()}>{(tab) =>
                <button type="button" class="ribbon-more-item" role="menuitem" tabIndex="-1"
                  aria-current={activeTab() === tab.id ? 'page' : undefined}
                  onClick={() => selectSecondaryTab(tab.id)}>{tab.label}</button>
              }</For>
            </div>
          </Show>
        </div>
        <Show when={contextualTabsVisible()}>
          <span class="ribbon-tab-separator contextual-tabs visible" id="contextual-tabs-separator"></span>
          <RibbonTab label={t('tabs.format')} dataTab="format" isContextual={true} id="tab-format-btn"
            isActive={activeTab() === 'format'}
            onClick={() => setActiveTab('format')} />
          <RibbonTab label={t('tabs.arrange')} dataTab="arrange" isContextual={true} id="tab-arrange-btn"
            isActive={activeTab() === 'arrange'}
            onClick={() => setActiveTab('arrange')} />
        </Show>
        <Show when={imageSelected()}>
          <Show when={!contextualTabsVisible()}>
            <span class="ribbon-tab-separator contextual-tabs visible" id="contextual-image-separator"></span>
          </Show>
          <RibbonTab label={t('tabs.image')} dataTab="image" isContextual={true} id="tab-image-btn"
            isActive={activeTab() === 'image'}
            onClick={() => setActiveTab('image')} />
        </Show>
        <WorkspaceProfilePicker />
        {/* Collapse/expand toggle (issue #278): hides the ribbon body so only
            the tab strip remains. State is remembered in preferences. */}
        <button
          type="button"
          class="ribbon-collapse-toggle"
          id="ribbon-collapse-toggle"
          title={ribbonCollapsed() ? (t('common.expandRibbon') || 'Expand ribbon') : (t('common.collapseRibbon') || 'Collapse ribbon')}
          onClick={toggleCollapsed}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d={ribbonCollapsed() ? 'M2 4 L6 8 L10 4' : 'M2 8 L6 4 L10 8'}
              fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      <Show when={!ribbonCollapsed()}>
        <Switch>
          <Match when={activeTab() === 'drawing'}><DrawingTab /></Match>
          <Match when={activeTab() === 'measure'}><MeasureTab /></Match>
          <Match when={activeTab() === 'comment'}><CommentTab /></Match>
          <Match when={activeTab() === 'home'}><HomeTab /></Match>
          <Match when={activeTab() === 'view'}><ViewTab /></Match>
          <Match when={activeTab() === 'organize'}><OrganizeTab /></Match>
          <Match when={activeTab() === 'help'}><HelpTab /></Match>
          <Match when={activeTab() === 'format'}><FormatTab /></Match>
          <Match when={activeTab() === 'arrange'}><ArrangeTab /></Match>
          <Match when={activeTab() === 'image'}><ImageTab /></Match>
        </Switch>
      </Show>
    </>
  );
}
