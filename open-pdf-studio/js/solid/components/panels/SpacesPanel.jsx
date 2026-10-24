// Spaces panel (the external editor Window ▸ Spaces, Alt+S): the named, nested spaces of the
// document per page. Draw a space (rectangle or polygon), make one from the
// selected area measurement or shape, rename, recolour, re-parent, hide its
// outline or delete it. Floor-plan rooms (and Dynamic Fill "Space" output)
// are listed as spaces too. Markups get their Space in the Markups List.
import { For, Show, createMemo, createSignal } from 'solid-js';
import { state, getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { lucide } from '../../data/lucideIcons.js';
import { spaceTree, spacePathText, isRoomSpaceId } from '../../../spaces/model.js';
import { spaceBid, spaceBidCsv, bidQuantityText } from '../../../spaces/space-bid.js';
import {
  documentSpaces, spaceMarkupCounts, selectedSpaceId, selectSpace, outlinesShown, setOutlinesShown,
  pageFilter, setPageFilter,
} from '../../stores/spacesStore.js';

const actions = () => import('../../../spaces/actions.js');

export default function SpacesPanel() {
  const { t } = useTranslation('common');
  const [message, setMessage] = createSignal('');
  const doc = () => state.documents[state.activeDocumentIndex] || null;
  const currentPage = () => doc()?.currentPage || 1;
  const rows = createMemo(() => spaceTree(documentSpaces(), pageFilter() === 'current' ? currentPage() : null));
  const bid = createMemo(() => {
    const d = doc();
    if (!d) return null;
    void d.annotations?.length;
    void d.spaces?.length;
    void d.formulaCaptions;
    void documentSpaces().length;
    return spaceBid(d);
  });
  const quantity = (row, key) => (row[`${key}Mixed`]
    ? t('spaces.bidMixed')
    : bidQuantityText(row[key], row[`${key}Unit`], false));
  const downloadBid = async () => {
    const d = doc();
    if (!d) return;
    try {
      const bytes = new TextEncoder().encode(`\uFEFF${spaceBidCsv(d)}`);
      const base = String(d.filePath || d.fileName || 'drawing').split(/[/\\]/u).pop().replace(/\.pdf$/iu, '') || 'drawing';
      const platform = await import('../../../core/platform.js');
      const path = await platform.saveFileDialog(`${base}-spaces-bid.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
      if (!path) return;
      await platform.writeBinaryFile(path, bytes);
    } catch (error) {
      setMessage(String(error?.message || error));
    }
  };
  const selected = createMemo(() => documentSpaces().find((s) => s.id === selectedSpaceId()) || null);
  const parentOptions = createMemo(() => {
    const s = selected();
    if (!s) return [];
    // Not itself and not one of its descendants (that would be a loop).
    const all = documentSpaces();
    const byId = new Map(all.map((x) => [x.id, x]));
    const inside = (x) => {
      for (let p = x; p; p = p.parent ? byId.get(p.parent) : null) if (p.id === s.id) return true;
      return false;
    };
    return all.filter((x) => x.page === s.page && !inside(x));
  });

  const draw = (tool) => {
    setMessage(t(tool === 'spaceRect' ? 'spaces.drawRectHint' : 'spaces.drawPolygonHint'));
    import('../../../tools/manager.js').then((m) => m.setTool(tool));
  };
  const fromSelection = async () => {
    const m = await actions();
    const r = m.addSpacesFromSelection();
    if (r.added.length) {
      selectSpace(r.added[r.added.length - 1]);
      setMessage(t('spaces.fromSelectionDone', { count: r.added.length }));
    } else if (r.rooms) setMessage(t('spaces.fromSelectionRooms'));
    else setMessage(t('spaces.fromSelectionNone'));
  };
  const goTo = (space) => {
    setMessage('');
    selectSpace(space.id);
    if (space.page !== currentPage()) import('../../../pdf/renderer.js').then((m) => m.goToPage(space.page));
  };
  const remove = async (space) => {
    const m = await actions();
    if (m.deleteSpace(space.id)) {
      selectSpace(null);
      setMessage(t('spaces.deleted', { name: space.name }));
    }
  };

  return (
    <div class="ws-spaces-panel">
      <div class="ws-spaces-toolbar" role="toolbar" aria-label={t('spaces.title')}>
        <button type="button" class="ws-spaces-btn" disabled={!doc()} title={t('spaces.addRectangleHint')}
          onClick={() => draw('spaceRect')}>
          <span innerHTML={lucide('square')} /><span>{t('spaces.addRectangle')}</span>
        </button>
        <button type="button" class="ws-spaces-btn" disabled={!doc()} title={t('spaces.addPolygonHint')}
          onClick={() => draw('spacePolygon')}>
          <span innerHTML={lucide('pentagon')} /><span>{t('spaces.addPolygon')}</span>
        </button>
        <button type="button" class="ws-spaces-btn" disabled={!doc()} title={t('spaces.fromSelectionHint')}
          onClick={fromSelection}>
          <span innerHTML={lucide('mouse-pointer-2')} /><span>{t('spaces.fromSelection')}</span>
        </button>
        <span class="ws-spaces-spacer" />
        <button type="button" class={`ws-spaces-icon-btn${outlinesShown() ? ' active' : ''}`}
          aria-pressed={outlinesShown()} title={t('spaces.outlinesHint')} aria-label={t('spaces.outlines')}
          onClick={() => setOutlinesShown(!outlinesShown())}>
          <span innerHTML={lucide(outlinesShown() ? 'eye' : 'eye-off')} />
        </button>
      </div>
      <div class="ws-spaces-filter">
        <select class="ws-spaces-select" value={pageFilter()} aria-label={t('spaces.pageFilter')}
          onChange={(e) => setPageFilter(e.currentTarget.value)}>
          <option value="all">{t('spaces.allPages')}</option>
          <option value="current">{t('spaces.currentPage')}</option>
        </select>
        <span class="ws-spaces-count">{t('spaces.count', { count: documentSpaces().length })}</span>
      </div>
      <Show when={message()}><div class="ws-spaces-message" role="status">{message()}</div></Show>
      <div class="ws-spaces-list" role="tree" aria-label={t('spaces.title')}>
        <Show when={doc()} fallback={<div class="ws-spaces-empty">{t('spaces.noDocument')}</div>}>
          <Show when={rows().length} fallback={<div class="ws-spaces-empty">{t('spaces.empty')}</div>}>
            <For each={rows()}>{(row, i) => (
              <>
                <Show when={pageFilter() === 'all' && (i() === 0 || rows()[i() - 1].space.page !== row.space.page)}>
                  <div class="ws-spaces-page">{t('spaces.page', { page: row.space.page })}</div>
                </Show>
                <div role="treeitem" tabIndex={0} aria-selected={selectedSpaceId() === row.space.id}
                  class={`ws-spaces-row${selectedSpaceId() === row.space.id ? ' selected' : ''}${row.space.hidden ? ' hidden-outline' : ''}`}
                  style={{ 'padding-left': `${8 + row.level * 14}px` }}
                  title={spacePathText(row.space)}
                  onClick={() => goTo(row.space)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(row.space); } if (e.key === 'Delete') remove(row.space); }}>
                  <span class="ws-spaces-swatch" style={{ 'background-color': row.space.color }} />
                  <span class="ws-spaces-name">{row.space.name}</span>
                  <Show when={row.space.source === 'room'}><span class="ws-spaces-badge">{t('spaces.roomBadge')}</span></Show>
                  <span class="ws-spaces-markups" title={t('spaces.markups')}>{spaceMarkupCounts().get(row.space.id) || 0}</span>
                  <button type="button" class="ws-spaces-icon-btn" aria-label={t(row.space.hidden ? 'spaces.showOutline' : 'spaces.hideOutline')}
                    title={t(row.space.hidden ? 'spaces.showOutline' : 'spaces.hideOutline')}
                    onClick={(e) => { e.stopPropagation(); actions().then((m) => m.setSpaceHidden(row.space.id, !row.space.hidden)); }}>
                    <span innerHTML={lucide(row.space.hidden ? 'eye-off' : 'eye')} />
                  </button>
                </div>
              </>
            )}</For>
          </Show>
        </Show>
      </div>
      <Show when={doc()}>
        <div class="ws-spaces-bid" role="region" aria-label={t('spaces.bid')}>
          <div class="ws-spaces-bid-head">
            <span class="ws-spaces-bid-title" title={t('spaces.bidHint')}>{t('spaces.bid')}</span>
            <span class="ws-spaces-spacer" />
            <button type="button" class="ws-spaces-btn" title={t('spaces.bidCsvHint')} onClick={() => void downloadBid()}>
              <span innerHTML={lucide('download')} /><span>{t('spaces.bidCsv')}</span>
            </button>
          </div>
          <Show when={bid()?.rows.length} fallback={<div class="ws-spaces-empty">{t('spaces.bidEmpty')}</div>}>
            <div class="ws-spaces-bid-scroll">
              <table class="ws-spaces-bid-table">
                <thead>
                  <tr>
                    <th scope="col">{t('spaces.path')}</th>
                    <th scope="col">{t('spaces.bidPage')}</th>
                    <th scope="col">{t('spaces.bidCount')}</th>
                    <th scope="col">{t('spaces.bidLength')}</th>
                    <th scope="col">{t('spaces.bidArea')}</th>
                    <th scope="col">{t('spaces.bidVolume')}</th>
                    <th scope="col">{t('spaces.bidWallArea')}</th>
                    <For each={bid().formulaNames}>{(name) => <th scope="col">{name}</th>}</For>
                    <th scope="col" title={t('spaces.bidScaleNotSetHint')}>{t('spaces.bidScaleNotSet')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={bid().rows}>{(row) => (
                    <tr>
                      <td class="ws-spaces-bid-path" style={{ 'padding-left': `${8 + row.level * 12}px` }} title={row.path}>{row.path}</td>
                      <td>{row.page}</td>
                      <td>{row.count}</td>
                      <td>{quantity(row, 'length')}</td>
                      <td>{quantity(row, 'area')}</td>
                      <td>{quantity(row, 'volume')}</td>
                      <td>{quantity(row, 'wallArea')}</td>
                      <For each={row.formulas}>{(formula) => <td>{formula.text}</td>}</For>
                      <td>{row.scaleNotSet}</td>
                    </tr>
                  )}</For>
                </tbody>
              </table>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={selected()}>{(s) => (
        <div class="ws-spaces-details">
          <label class="ws-spaces-field">
            <span>{t('spaces.name')}</span>
            <input type="text" maxLength="128" value={s().name}
              onChange={(e) => { const el = e.currentTarget; actions().then((m) => { if (!m.renameSpace(s().id, el.value)) el.value = s().name; }); }} />
          </label>
          <label class="ws-spaces-field">
            <span>{t('spaces.color')}</span>
            <input type="color" value={s().color}
              onChange={(e) => { const v = e.currentTarget.value; actions().then((m) => m.recolorSpace(s().id, v)); }} />
          </label>
          <label class="ws-spaces-field">
            <span>{t('spaces.parent')}</span>
            <select class="ws-spaces-select" disabled={isRoomSpaceId(s().id)}
              value={isRoomSpaceId(s().id) ? (s().parent || '') : ((getActiveDocument()?.spaces || []).find((x) => x.id === s().id)?.parentId || '')}
              onChange={(e) => { const v = e.currentTarget.value; actions().then((m) => m.setSpaceParent(s().id, v || null)); }}>
              <option value="">{t('spaces.parentAuto')}</option>
              <For each={parentOptions()}>{(p) => <option value={p.id}>{spacePathText(p)}</option>}</For>
            </select>
          </label>
          <div class="ws-spaces-meta">
            <span>{t('spaces.path')}: {spacePathText(s())}</span>
            <span>{t('spaces.markupCount', { count: spaceMarkupCounts().get(s().id) || 0 })}</span>
            <Show when={s().source === 'room'}><span>{t('spaces.roomHint')}</span></Show>
          </div>
          <button type="button" class="ws-spaces-btn danger" onClick={() => remove(s())}>
            <span innerHTML={lucide('trash-2')} /><span>{t(s().source === 'room' ? 'spaces.deleteRoom' : 'spaces.delete')}</span>
          </button>
        </div>
      )}</Show>
    </div>
  );
}
