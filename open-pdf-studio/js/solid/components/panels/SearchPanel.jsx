// Search panel (the external editor Alt+1): a search field that drives the existing find bar
// (search/find-bar.js) and lists its hits per page; clicking a row goes there.
// Below it: Visual Search (VisualSearchSection.jsx).
import { For, Show } from 'solid-js';
import { state } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { resultGroups, currentResultPage, searching } from '../../stores/findBarStore.js';
import VisualSearchSection from './VisualSearchSection.jsx';

export default function SearchPanel() {
  const { t } = useTranslation('common');
  const { t: tStatus } = useTranslation('statusbar');
  const run = (value) => import('../../../search/find-bar.js').then((m) => {
    m.openFindBar();
    m.handleSearchInput(value);
  });
  return (
    <div class="ws-search-panel">
      <form class="ws-search-form" onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget.elements.query.value);
      }}>
        <input name="query" type="search" placeholder={t('panelHost.searchPlaceholder')}
          aria-label={t('search')} value={state.search?.query || ''} />
        <button type="submit">{t('panelHost.searchRun')}</button>
      </form>
      <Show when={searching()}><div class="ws-search-status">…</div></Show>
      <div class="ws-search-results">
        <For each={resultGroups()}>{(g) => (
          <button type="button" class={`ws-search-row${g.pagina === currentResultPage() ? ' current' : ''}`}
            onClick={() => import('../../../search/find-bar.js').then((m) => m.goToResultIndex(g.eersteIndex))}>
            <span>{tStatus('searchResultPage', { page: g.pagina })}</span>
            <span class="ws-search-count">
              {g.totaal === 1 ? tStatus('searchHitsOne') : tStatus('searchHitsMany', { count: g.totaal })}
            </span>
          </button>
        )}</For>
      </div>
      <VisualSearchSection />
    </div>
  );
}
