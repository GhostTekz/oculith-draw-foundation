import { For, Show, createSignal } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage, layerViewDiffers, layerViewUnsupported } from '../../../stores/panels/layersStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../../core/state.js';
import { lucide } from '../../../data/lucideIcons.js';
import { layerNameMatches } from '../../../../pdf/native-ocg-view.js';
import AnnotationLayersPanel from '../AnnotationLayersPanel.jsx';

// Het paneel Lagen: één tab met twee secties.
//   1. Markeringslagen: de lagen voor je eigen markeringen, bewerkbaar
//      (AnnotationLayersPanel.jsx).
//   2. PDF-lagen (uit de tekening): de lagen (OCG's) van de PDF zelf. Per laag
//      een oog om te tonen/verbergen en "alleen deze tonen"; daarboven alles
//      tonen/verbergen, terug naar de PDF-standaard en een naamfilter. De keuze
//      is een weergave: de app onthoudt haar per document en schrijft de PDF
//      alleen bij "Save layer visibility as the PDF default"
//      (docs/foundation/PDF-LAYERS.md, native-ocg-selection.js).

// Inspringing per niveau van de lagenboom, in px.
const INSPRINGING = 14;

const ICOON = {
  visible: lucide('eye'),
  hidden: lucide('eye-off'),
  solo: lucide('locate'),
  reset: lucide('rotate-ccw'),
  saveDefault: lucide('save'),
};

function selection() {
  return import('../../../../pdf/native-ocg-selection.js');
}

function report(error, unsupportedText) {
  if (!error) return;
  console.warn('[layers] layer change failed:', error);
  const message = error?.name === 'OcgViewUnsupported' ? unsupportedText(error.reason) : String(error?.message || error);
  import('../../../stores/dialogStore.js').then(m => m.showMessage(message));
}

export default function LayersPanel() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const { t: tRibbon } = useTranslation('ribbon');
  const [filter, setFilter] = createSignal('');
  const unsupportedText = (reason) => tCommon(`leftPanel.pdfLayerUnsupported.${reason}`,
    { defaultValue: tCommon('leftPanel.pdfLayerUnsupported.malformed') });

  const doc = () => getActiveDocument();
  const layerRows = () => items().filter(row => !row.kop);
  const shownRows = () => {
    const wanted = filter();
    if (!wanted.trim()) return items();
    const matches = items().filter(row => !row.kop && layerNameMatches(row.name, wanted));
    return matches;
  };
  const filteredIds = () => shownRows().filter(row => !row.kop && row.toggleable).map(row => row.id);
  const hasToggleable = () => layerRows().some(row => row.toggleable);

  const run = (work) => {
    const d = doc();
    if (!d) return;
    selection().then(m => work(m, d)).catch(error => report(error, unsupportedText));
  };
  const toggle = (row) => run((m, d) => m.setNativeOcgVisibility(d, row.id, !row.visible));
  const solo = (row) => run((m, d) => m.soloNativeOcg(d, row.id));
  const toggleHeading = (row) => {
    const children = layerRows().filter(r => row.children.includes(r.id));
    const anyVisible = children.some(r => r.visible);
    run((m, d) => m.setAllNativeOcg(d, !anyVisible, row.children));
  };
  // With a filter, show/hide all works on the matching layers only.
  const setAll = (visible) => run((m, d) => m.setAllNativeOcg(d, visible, filter().trim() ? filteredIds() : null));
  const reset = () => run((m, d) => m.resetNativeOcgSelection(d));
  const saveAsDefault = () => run(async (m, d) => {
    const { showConfirm } = await import('../../../../ui/chrome/confirm-dialog.js');
    const confirmed = await showConfirm({
      title: tCommon('leftPanel.pdfLayerSaveDefault'),
      message: tCommon('leftPanel.pdfLayerSaveDefaultConfirm'),
    });
    if (confirmed) await m.saveNativeOcgSelectionAsDefault(d);
  });

  return (
    <div class={`left-panel-content${activeTab() === 'layers' ? ' active' : ''}`} id="layers-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.layersTab')}</span>
      </div>
      <div class="layers-sections">
        <section class="layers-section" id="layers-markup-section">
          <div class="layers-section-head">{tRibbon('annotationLayers.title')}</div>
          <AnnotationLayersPanel />
        </section>

        <section class="layers-section" id="layers-pdf-section">
          <div class="layers-section-head">
            {t('leftPanel.layers')}
            <span class="layers-section-sub">{tCommon('leftPanel.pdfLayersFromDrawing')}</span>
          </div>
          <Show when={!emptyMessage() && layerViewUnsupported()}>
            <div class="layers-note layers-note-unsupported" id="pdf-layers-unsupported" role="note">
              {unsupportedText(layerViewUnsupported())} {tCommon('leftPanel.pdfLayerUnsupportedHint')}
            </div>
          </Show>
          <Show when={!emptyMessage() && (hasToggleable() || layerViewDiffers())}>
            <div class="al-toolbar pdf-layers-toolbar">
              <input type="search" class="pdf-layers-filter" id="pdf-layers-filter"
                placeholder={tCommon('leftPanel.pdfLayerFilter')}
                aria-label={tCommon('leftPanel.pdfLayerFilter')}
                value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
              <button type="button" class="al-tool" id="pdf-layers-show-all"
                title={tCommon('leftPanel.pdfLayerShowAll')} aria-label={tCommon('leftPanel.pdfLayerShowAll')}
                onClick={() => setAll(true)} innerHTML={ICOON.visible} />
              <button type="button" class="al-tool" id="pdf-layers-hide-all"
                title={tCommon('leftPanel.pdfLayerHideAll')} aria-label={tCommon('leftPanel.pdfLayerHideAll')}
                onClick={() => setAll(false)} innerHTML={ICOON.hidden} />
              <span class="al-tool-sep" />
              <button type="button" class="al-tool" id="pdf-layers-reset"
                title={tCommon('leftPanel.pdfLayerReset')} aria-label={tCommon('leftPanel.pdfLayerReset')}
                disabled={!layerViewDiffers()} onClick={reset} innerHTML={ICOON.reset} />
              <button type="button" class="al-tool" id="pdf-layers-save-default"
                title={tCommon('leftPanel.pdfLayerSaveDefault')} aria-label={tCommon('leftPanel.pdfLayerSaveDefault')}
                disabled={!layerViewDiffers()} onClick={saveAsDefault} innerHTML={ICOON.saveDefault} />
            </div>
          </Show>
          <div class="layers-container">
            <Show when={emptyMessage()}>
              <div class="layers-empty">{emptyMessage()}</div>
            </Show>
            <Show when={!emptyMessage()}>
              <For each={shownRows()}>
                {(layer) => (
                  <div
                    class={`layer-list-item${layer.kop ? ' layer-list-kop' : ''}${!layer.kop && !layer.visible ? ' layer-list-hidden' : ''}`}
                    style={{ 'margin-left': `${(filter().trim() ? 0 : layer.depth || 0) * INSPRINGING}px` }}
                    data-layer-id={layer.id || ''}
                  >
                    <Show when={!layer.kop}>
                      <button type="button" class="al-flag layer-list-eye"
                        aria-pressed={layer.visible ? 'true' : 'false'}
                        disabled={!layer.toggleable}
                        title={layer.toggleable
                          ? (layer.visible ? tCommon('leftPanel.pdfLayerHide') : tCommon('leftPanel.pdfLayerShow'))
                          : layerViewUnsupported() ? unsupportedText(layerViewUnsupported())
                            : tCommon('leftPanel.pdfLayerNotSwitchable')}
                        aria-label={layer.visible ? tCommon('leftPanel.pdfLayerHide') : tCommon('leftPanel.pdfLayerShow')}
                        onClick={() => toggle(layer)}
                        innerHTML={layer.visible ? ICOON.visible : ICOON.hidden} />
                    </Show>
                    <Show when={layer.kop && layer.children?.length && !layerViewUnsupported()}>
                      <button type="button" class="al-flag layer-list-eye"
                        title={tCommon('leftPanel.pdfLayerGroupToggle')}
                        aria-label={tCommon('leftPanel.pdfLayerGroupToggle')}
                        onClick={() => toggleHeading(layer)}
                        innerHTML={layerRows().some(r => layer.children.includes(r.id) && r.visible)
                          ? ICOON.visible : ICOON.hidden} />
                    </Show>
                    <span class="layer-list-name">{layer.name}</span>
                    <Show when={!layer.kop && layer.toggleable}>
                      <button type="button" class="al-flag layer-list-solo"
                        title={tCommon('leftPanel.pdfLayerSolo')} aria-label={tCommon('leftPanel.pdfLayerSolo')}
                        onClick={() => solo(layer)} innerHTML={ICOON.solo} />
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <Show when={layerViewDiffers()}>
            <div class="layers-note" id="pdf-layers-note">{tCommon('leftPanel.pdfLayerViewNote')}</div>
          </Show>
          <div class="layers-count">{countText()}</div>
        </section>
      </div>
    </div>
  );
}
