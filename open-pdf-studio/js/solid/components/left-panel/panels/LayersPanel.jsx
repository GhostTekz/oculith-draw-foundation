import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage } from '../../../stores/panels/layersStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import AnnotationLayersPanel from '../AnnotationLayersPanel.jsx';

// Het paneel Lagen, zoals in the external editor: één tab met twee secties.
//   1. Markeringslagen: de lagen voor je eigen markeringen, bewerkbaar
//      (AnnotationLayersPanel.jsx).
//   2. PDF-lagen (uit de tekening): de lagen (OCG's) van de PDF zelf. Die
//      toont het paneel alleen; schakelen kan nog niet (K-001), dus de
//      vinkjes staan uit met een tooltip die dat zegt.

// Inspringing per niveau van de lagenboom, in px.
const INSPRINGING = 14;

export default function LayersPanel() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const { t: tRibbon } = useTranslation('ribbon');

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
          <div class="layers-section-head" title={tCommon('leftPanel.layerToggleUnavailable')}>
            {t('leftPanel.layers')}
            <span class="layers-section-sub">{tCommon('leftPanel.pdfLayersFromDrawing')}</span>
          </div>
          <div class="layers-container">
            <Show when={emptyMessage()}>
              <div class="layers-empty">{emptyMessage()}</div>
            </Show>
            <Show when={!emptyMessage()}>
              <For each={items()}>
                {(layer) => (
                  <div
                    class={`layer-list-item${layer.kop ? ' layer-list-kop' : ''}`}
                    style={{ 'margin-left': `${(layer.depth || 0) * INSPRINGING}px` }}
                  >
                    <Show when={!layer.kop}>
                      {/* Toont de stand; schakelen volgt (K-001, zie layers.js). */}
                      <span class="layer-list-toggle" title={tCommon('leftPanel.layerToggleUnavailable')}>
                        <input type="checkbox" checked={layer.visible} disabled />
                      </span>
                    </Show>
                    <span class="layer-list-name">{layer.name}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <div class="layers-count">{countText()}</div>
        </section>
      </div>
    </div>
  );
}
