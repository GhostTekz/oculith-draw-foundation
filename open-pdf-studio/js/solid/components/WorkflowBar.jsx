// The workflow toolbar (workspaceLayout toolbar 'standard'; View ▸ Workflow
// Toolbar). Two compact rows under the menu bar:
//   1. Workflow tabs (Review, Markup, Measure, Takeoff, an edition's own,
//      Sheets, Compare, Output, View; the profile picks which show) and,
//      while a markup or image is selected, its contextual tab in the
//      accent colour. At the right: the search box that opens the command
//      palette (Ctrl+K), the Quick Access commands the user pinned, and the
//      fold toggle.
//   2. The active workflow's tools, grouped, each an icon with its label.
//      When the row is too narrow the labels go first, then the last tools
//      move into a "More" menu.
// Every button runs a registry command; right-click pins or unpins it in
// Quick Access. Tooltips show the label and the shortcut (TooltipLayer).

import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import {
  getCommand, commandLabel, isCommandEnabled, isCommandChecked, runCommand, commandsVersion,
} from '../commands/registry.js';
import { getWorkflow } from '../commands/workflows.js';
import { shortcutParts } from '../commands/shortcut-display.js';
import { isToolbarVisible } from '../stores/workspaceLayout.js';
import {
  activeWorkflow, setActiveWorkflow, shownWorkflowIds, contextualWorkflowIds,
  workflowBarCollapsed, setWorkflowBarCollapsed,
} from '../stores/workflowStore.js';
import {
  quickAccessIds, isPinned, togglePinned, unpinCommand, movePinned, resetQuickAccess,
} from '../stores/quickAccess.js';
import { openPanelMenu } from './panels/PanelMenu.jsx';
import { lucide } from '../data/lucideIcons.js';
import { planFit, ROW_PADDING_PX } from './workflow-fit.js';
import { useTranslation } from '../../i18n/useTranslation.js';

/** Flat list of the tools of a workflow: { id, group, first } (registered ids only). */
export function workflowItems(workflow, known = (id) => !!getCommand(id)) {
  const out = [];
  for (const group of workflow?.groups || []) {
    const ids = group.items.filter(known);
    ids.forEach((id, i) => out.push({ id, group: group.id, groupLabel: group.label, first: i === 0 }));
  }
  return out;
}

function pinMenuItems(id, t) {
  const pinned = isPinned(id);
  return [{ label: pinned ? t('workflow.unpin') : t('workflow.pin'), icon: lucide(pinned ? 'pin-off' : 'pin'), run: () => togglePinned(id) }];
}

export default function WorkflowBar() {
  const { t } = useTranslation('common');
  const [compactFrom, setCompactFrom] = createSignal(Infinity);
  const [visibleCount, setVisibleCount] = createSignal(Infinity);
  let row;
  let tabsEl;

  const workflow = () => getWorkflow(activeWorkflow());
  const items = createMemo(() => { commandsVersion(); return workflowItems(workflow()); });
  const overflow = () => items().slice(visibleCount());

  // Fit: labels on every tool when the row has room; else the last groups
  // drop their labels first (one group at a time, from the end), then the
  // tools that still do not fit go into More. Measured once per change.
  let frame = 0;
  const fit = () => {
    cancelAnimationFrame(frame);
    setCompactFrom(Infinity);
    setVisibleCount(Infinity);
    frame = requestAnimationFrame(() => {
      if (!row) return;
      const groupEls = [...row.querySelectorAll('.wf-group')];
      const plan = planFit({
        available: row.clientWidth - 2 * ROW_PADDING_PX,
        groups: groupEls.map((el) => ({ full: el.getBoundingClientRect().width, count: el.querySelectorAll('[data-wf-index]').length })),
      });
      setCompactFrom(plan.compactFrom);
      setVisibleCount(plan.visibleCount);
    });
  };
  createEffect(on([activeWorkflow, () => items().length, workflowBarCollapsed], () => queueMicrotask(fit)));
  let observer = null;
  let lastWidth = 0;
  const bindRow = (el) => {
    row = el;
    observer?.disconnect();
    lastWidth = 0;
    if (!el) return;
    observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    observer.observe(el);
  };
  onCleanup(() => { observer?.disconnect(); cancelAnimationFrame(frame); });

  const tabIds = () => shownWorkflowIds();
  const contextIds = () => contextualWorkflowIds();

  const onTabsKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...tabsEl.querySelectorAll('[role="tab"]')];
    const at = tabs.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  const onToolsKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const buttons = [...e.currentTarget.querySelectorAll('button:not(:disabled):not(.wf-hidden)')];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
      : (at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    e.preventDefault();
    buttons[next].focus();
  };

  const toolMenu = (e, id) => {
    e.preventDefault();
    openPanelMenu(e.clientX, e.clientY, pinMenuItems(id, t));
  };
  const openMore = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const list = [];
    let lastGroup = null;
    for (const item of overflow()) {
      if (lastGroup && item.group !== lastGroup) list.push({ separator: true });
      lastGroup = item.group;
      const cmd = getCommand(item.id);
      list.push({
        label: commandLabel(cmd, t), icon: cmd.icon, checked: isCommandChecked(cmd),
        disabled: !isCommandEnabled(cmd), run: () => runCommand(item.id),
      });
    }
    openPanelMenu(Math.max(4, r.right - 220), r.bottom + 2, list);
  };
  const quickMenu = (e, id) => {
    e.preventDefault();
    const ids = quickAccessIds();
    const at = ids.indexOf(id);
    openPanelMenu(e.clientX, e.clientY, [
      { label: t('workflow.unpin'), icon: lucide('pin-off'), run: () => unpinCommand(id) },
      { separator: true },
      { label: t('workflow.moveLeft'), icon: lucide('chevron-left'), disabled: at <= 0, run: () => movePinned(id, -1) },
      { label: t('workflow.moveRight'), icon: lucide('chevron-right'), disabled: at >= ids.length - 1, run: () => movePinned(id, 1) },
    ]);
  };
  const openQuickCustomize = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const pinned = quickAccessIds().filter((id) => getCommand(id));
    openPanelMenu(Math.max(4, r.right - 220), r.bottom + 2, [
      ...pinned.map((id) => ({
        label: commandLabel(getCommand(id), t), icon: getCommand(id).icon, checked: true, run: () => unpinCommand(id),
      })),
      ...(pinned.length ? [{ separator: true }] : [{ label: t('workflow.quickAccessEmpty'), disabled: true }]),
      { label: t('commands.findCommands'), icon: lucide('search'), run: () => runCommand('help.findCommands') },
      { label: t('workflow.resetQuickAccess'), icon: lucide('rotate-ccw'), run: () => resetQuickAccess() },
    ]);
  };

  const ToolButton = (props) => {
    const cmd = () => getCommand(props.item.id);
    const label = () => commandLabel(cmd(), t);
    const checked = () => isCommandChecked(cmd());
    return (
      <button
        type="button"
        class="wf-tool"
        classList={{ active: !!checked(), 'wf-hidden': props.hidden, 'wf-icon-only': props.compact }}
        data-command={props.item.id}
        data-wf-index={props.index}
        data-tip={label()}
        data-tip-key={cmd().shortcut || ''}
        aria-label={label()}
        aria-pressed={checked() === undefined ? undefined : String(!!checked())}
        disabled={!isCommandEnabled(cmd())}
        onClick={() => runCommand(props.item.id)}
        onContextMenu={(e) => toolMenu(e, props.item.id)}
      >
        <span class="wf-tool-icon" innerHTML={cmd().icon || ''} />
        <Show when={!props.compact}><span class="wf-tool-label">{label()}</span></Show>
      </button>
    );
  };

  // Groups of the active workflow with each item's flat index.
  const groups = createMemo(() => {
    const out = [];
    items().forEach((item, index) => {
      if (item.first || !out.length) out.push({ id: item.group, label: item.groupLabel, items: [] });
      out.at(-1).items.push({ item, index });
    });
    return out;
  });

  return (
    <Show when={isToolbarVisible('standard')}>
      <div class="wf-bar" id="workflow-bar" role="region" aria-label={t('workflow.bar')}
        classList={{ 'wf-contextual-active': !!getWorkflow(activeWorkflow())?.contextual }}>
        <div class="wf-head">
          <div class="wf-tabs" role="tablist" aria-label={t('workflow.tabs')} ref={tabsEl} onKeyDown={onTabsKeyDown}>
            <For each={tabIds()}>{(id) => {
              const wf = getWorkflow(id);
              const command = getCommand(`view.workflow.${id}`);
              return (
                <button type="button" role="tab" class="wf-tab" data-workflow={id}
                  aria-selected={activeWorkflow() === id} tabIndex={activeWorkflow() === id ? 0 : -1}
                  data-tip={t(wf.label)} data-tip-key={command?.shortcut || ''}
                  onClick={() => { setActiveWorkflow(id); if (workflowBarCollapsed()) setWorkflowBarCollapsed(false); }}>
                  <span class="wf-tab-icon" innerHTML={wf.icon || ''} />
                  <span class="wf-tab-label">{t(wf.label)}</span>
                </button>
              );
            }}</For>
            <Show when={contextIds().length}>
              <span class="wf-tab-sep" aria-hidden="true" />
              <For each={contextIds()}>{(id) => {
                const wf = getWorkflow(id);
                return (
                  <button type="button" role="tab" class="wf-tab wf-tab-contextual" data-workflow={id}
                    aria-selected={activeWorkflow() === id} tabIndex={activeWorkflow() === id ? 0 : -1}
                    data-tip={t(wf.label)} data-tip-desc={t('workflow.contextual')}
                    onClick={() => { setActiveWorkflow(id); if (workflowBarCollapsed()) setWorkflowBarCollapsed(false); }}>
                    <span class="wf-tab-icon" innerHTML={wf.icon || ''} />
                    <span class="wf-tab-label">{t(wf.label)}</span>
                  </button>
                );
              }}</For>
            </Show>
          </div>
          <div class="wf-head-end">
            <button type="button" class="wf-search" id="workflow-search"
              data-tip={t('workflow.search')} data-tip-key={getCommand('help.findCommands')?.shortcut || ''}
              aria-label={t('workflow.search')} onClick={() => runCommand('help.findCommands')}>
              <span class="wf-search-icon" innerHTML={lucide('search')} />
              <span class="wf-search-text">{t('workflow.search')}</span>
              <span class="wf-search-keys" aria-hidden="true">
                <For each={shortcutParts(getCommand('help.findCommands')?.shortcut)}>{(k) => <kbd>{k}</kbd>}</For>
              </span>
            </button>
            <div class="wf-quick" role="toolbar" aria-label={t('workflow.quickAccess')}>
              <For each={quickAccessIds().filter((id) => { commandsVersion(); return !!getCommand(id); })}>{(id) => {
                const cmd = getCommand(id);
                const label = () => commandLabel(cmd, t);
                return (
                  <button type="button" class="wf-quick-btn" data-command={id}
                    classList={{ active: !!isCommandChecked(cmd) }}
                    data-tip={label()} data-tip-key={cmd.shortcut || ''} aria-label={label()}
                    disabled={!isCommandEnabled(cmd)}
                    onClick={() => runCommand(id)} onContextMenu={(e) => quickMenu(e, id)}
                    innerHTML={cmd.icon || lucide('command')} />
                );
              }}</For>
              <button type="button" class="wf-quick-menu" aria-haspopup="menu"
                data-tip={t('workflow.quickAccessMenu')} aria-label={t('workflow.quickAccessMenu')}
                onClick={openQuickCustomize} innerHTML={lucide('chevron-down')} />
            </div>
            <button type="button" class="wf-fold"
              data-tip={workflowBarCollapsed() ? t('workflow.expand') : t('workflow.collapse')}
              aria-label={workflowBarCollapsed() ? t('workflow.expand') : t('workflow.collapse')}
              aria-expanded={!workflowBarCollapsed()}
              onClick={() => setWorkflowBarCollapsed(!workflowBarCollapsed())}
              innerHTML={lucide(workflowBarCollapsed() ? 'panel-top-open' : 'panel-top-close')} />
          </div>
        </div>
        <Show when={!workflowBarCollapsed()}>
          <div class="wf-tools" role="toolbar"
            aria-label={workflow() ? t(workflow().label) : ''} ref={bindRow} onKeyDown={onToolsKeyDown}>
            <For each={groups()}>{(group, gi) => (
              <Show when={group.items.some(({ index }) => index < visibleCount())}>
                <Show when={gi() > 0}><span class="wf-sep" role="separator" /></Show>
                <div class="wf-group" role="group" aria-label={t(group.label)} data-group={group.id}>
                  <For each={group.items}>{({ item, index }) => (
                    <ToolButton item={item} index={index} hidden={index >= visibleCount()} compact={gi() >= compactFrom()} />
                  )}</For>
                </div>
              </Show>
            )}</For>
            <Show when={overflow().length}>
              <button type="button" class="wf-more" aria-haspopup="menu" data-tip={t('workflow.more')}
                onClick={openMore}>
                <span>{t('workflow.moreShort')}</span>
                <span class="wf-more-icon" innerHTML={lucide('chevron-down')} />
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
