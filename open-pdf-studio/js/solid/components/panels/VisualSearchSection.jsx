// Search panel ▸ Visual Search (the external editor Visual Search): pick a symbol on the
// page, search this page or all pages, filter the results with the
// similarity slider and per-result checkboxes, then create numbered count
// markers in a count category or rectangle highlights.
import { For, Show, createSignal, createEffect } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  template, status, scope, setScope, rotations, setRotations, scaleStep, setScaleStep,
  threshold, setThreshold, results, visibleResults, chosenResults, progress, lastMessage, elapsedMs,
  setResultIncluded, setAllIncluded, resultsDocId, docKey,
} from '../../stores/visualSearchStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { countCategories, activeCountCategoryId } from '../../stores/countStore.js';

const session = () => import('../../../tools/visual-search/session.js');

/** A grey 8-bit thumbnail ({ width, height, data }) on a canvas. */
function Thumb(props) {
  let canvas;
  createEffect(() => {
    const t = props.thumb;
    if (!canvas || !t) return;
    canvas.width = t.width;
    canvas.height = t.height;
    const img = canvas.getContext('2d').createImageData(t.width, t.height);
    for (let i = 0; i < t.data.length; i++) {
      const v = t.data[i];
      img.data[4 * i] = v; img.data[4 * i + 1] = v; img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255;
    }
    canvas.getContext('2d').putImageData(img, 0, 0);
  });
  return <canvas ref={canvas} class={props.class || 'vs-thumb'} aria-hidden="true" />;
}

export default function VisualSearchSection() {
  const { t } = useTranslation('common');
  const [category, setCategory] = createSignal(null);
  const categoryId = () => category() || activeCountCategoryId();
  const searching = () => status() === 'searching';
  const pages = () => new Set(visibleResults().map((r) => r.page)).size;
  // Template and results belong to the document they came from.
  const activeKey = () => docKey(getActiveDocument());
  const templateHere = () => !!template() && template().docId === activeKey();
  const resultsHere = () => results().length > 0 && resultsDocId() === activeKey();

  const message = () => {
    const m = lastMessage();
    if (m) return t(`visualSearch.${m.key}`, { count: m.count });
    if (status() === 'picking') return t('visualSearch.picking');
    if (searching()) return t('visualSearch.searching', progress());
    if (status() === 'cancelled') return t('visualSearch.cancelled');
    if (status() === 'error') return t('visualSearch.error');
    if (status() === 'done') {
      return t('visualSearch.doneSummary', {
        count: visibleResults().length, pages: pages(), seconds: (elapsedMs() / 1000).toFixed(1),
      });
    }
    return template() ? '' : t('visualSearch.pickHint');
  };

  return (
    <section class="vs-section" aria-label={t('visualSearch.title')}>
      <div class="vs-head">{t('visualSearch.title')}</div>
      <div class="vs-pick">
        <Show when={template()}>
          {(tpl) => <Thumb thumb={tpl().thumb} class="vs-template" />}
        </Show>
        <div class="vs-pick-text">
          <Show when={template()}>
            {(tpl) => <span>{t('visualSearch.template', { page: tpl().page })}</span>}
          </Show>
          <button type="button" class="vs-btn" disabled={searching() || status() === 'picking'}
            onClick={() => session().then((m) => m.pickSymbol())}>
            {template() ? t('visualSearch.repick') : t('visualSearch.pick')}
          </button>
        </div>
      </div>
      <div class="vs-options">
        <label class="vs-field">
          <span>{t('visualSearch.scope')}</span>
          <select value={scope()} onChange={(e) => setScope(e.currentTarget.value)}>
            <option value="page">{t('visualSearch.scopePage')}</option>
            <option value="all">{t('visualSearch.scopeAll')}</option>
          </select>
        </label>
        <label class="vs-check">
          <input type="checkbox" checked={rotations()} onChange={(e) => setRotations(e.currentTarget.checked)} />
          {t('visualSearch.rotations')}
        </label>
        <label class="vs-check">
          <input type="checkbox" checked={scaleStep()} onChange={(e) => setScaleStep(e.currentTarget.checked)} />
          {t('visualSearch.scaleStep')}
        </label>
        <div class="vs-actions">
          <Show when={!searching()} fallback={
            <button type="button" class="vs-btn" onClick={() => session().then((m) => m.cancelSearch())}>
              {t('visualSearch.cancel')}
            </button>
          }>
            <button type="button" class="vs-btn primary" disabled={!templateHere()}
              onClick={() => session().then((m) => m.runSearch())}>
              {t('visualSearch.search')}
            </button>
          </Show>
          <button type="button" class="vs-btn" disabled={!resultsHere()}
            onClick={() => session().then((m) => m.clearResults())}>
            {t('visualSearch.clear')}
          </button>
        </div>
      </div>
      <div class="vs-status" role="status">{message()}</div>
      <Show when={resultsHere()}>
        <label class="vs-slider">
          <span>{t('visualSearch.similarity')}</span>
          <input type="range" min="50" max="100" step="1" value={Math.round(threshold() * 100)}
            onInput={(e) => {
              setThreshold(Number(e.currentTarget.value) / 100);
              session().then((m) => m.redrawResults());
            }} />
          <span class="vs-slider-value">{Math.round(threshold() * 100)}%</span>
        </label>
        <div class="vs-bulk">
          <span>{t('visualSearch.chosen', { count: chosenResults().length })}</span>
          <button type="button" class="vs-link" onClick={() => { setAllIncluded(true); session().then((m) => m.redrawResults()); }}>
            {t('visualSearch.includeAll')}
          </button>
          <button type="button" class="vs-link" onClick={() => { setAllIncluded(false); session().then((m) => m.redrawResults()); }}>
            {t('visualSearch.excludeAll')}
          </button>
        </div>
        <div class="vs-results">
          <Show when={visibleResults().length} fallback={<div class="vs-empty">{t('visualSearch.noResults')}</div>}>
            <For each={visibleResults()}>{(r) => (
              <div class={`vs-row${r.included === false ? ' excluded' : ''}`}>
                <input type="checkbox" checked={r.included !== false} aria-label={t('visualSearch.include')}
                  onChange={(e) => { setResultIncluded(r.id, e.currentTarget.checked); session().then((m) => m.redrawResults()); }} />
                <button type="button" class="vs-row-main" onClick={() => session().then((m) => m.revealResult(r))}>
                  <Thumb thumb={r.thumb} />
                  <span class="vs-row-page">{t('visualSearch.resultPage', { page: r.page })}</span>
                  <span class="vs-row-rot">{t('visualSearch.resultRotation', { deg: r.rotation })}</span>
                  <span class="vs-row-score">{Math.round(r.score * 100)}%</span>
                </button>
              </div>
            )}</For>
          </Show>
        </div>
        <div class="vs-create">
          <label class="vs-field">
            <span>{t('visualSearch.category')}</span>
            <select value={categoryId()} onChange={(e) => setCategory(e.currentTarget.value)}>
              <For each={countCategories()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
            </select>
          </label>
          <div class="vs-actions">
            <button type="button" class="vs-btn primary" disabled={!chosenResults().length || searching()}
              onClick={() => session().then((m) => m.createCountMarkups(categoryId()))}>
              {t('visualSearch.createCounts')}
            </button>
            <button type="button" class="vs-btn" disabled={!chosenResults().length || searching()}
              onClick={() => session().then((m) => m.highlightResults())}>
              {t('visualSearch.highlight')}
            </button>
          </div>
        </div>
      </Show>
    </section>
  );
}
