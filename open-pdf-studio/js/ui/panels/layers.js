import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import {
  setLayerItems as setItems, setLayerCountText as setCountText, setLayerEmptyMessage as setEmptyMessage,
  setLayerViewDiffers, setLayerViewUnsupported,
} from '../../bridge.js';
import { lagenLijst } from './lagen-lijst.js';
import { layerPanelRows } from '../../pdf/native-ocg-view.js';
import {
  nativeOcgPdfJsConfig, initializeNativeOcgSelection, nativeOcgLayerStates, nativeOcgSelectionDiffers,
  nativeOcgRenderSupport,
} from '../../pdf/native-ocg-selection.js';

export { layerPanelRows };

function geenLagen(melding) {
  setItems([]);
  setLayerViewDiffers(false);
  setLayerViewUnsupported(null);
  setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
  setEmptyMessage(melding);
}


// Het paneel toont de gekozen weergave van de tekeninglagen; schakelen loopt
// via native-ocg-selection.js (docs/foundation/PDF-LAYERS.md).
export async function updateLayersList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    geenLagen(i18next.t('leftPanel.noDocumentOpen'));
    return;
  }

  setEmptyMessage(i18next.t('loading'));

  try {
    await initializeNativeOcgSelection(activeDoc);
    const ocConfig = await nativeOcgPdfJsConfig(activeDoc);
    if (getActiveDocument() !== activeDoc) return;
    // De annotatielagen van deze app zijn ook OCG's (#468), maar staan in het
    // paneel Markeringslagen; hier alleen de lagen van de tekening zelf.
    const regels = lagenLijst(ocConfig, { overslaan: activeDoc._annotatieLaagOcgIds || new Set() });
    const aantal = regels.filter((r) => !r.kop).length;
    if (!aantal) {
      geenLagen(i18next.t('leftPanel.noLayers'));
      return;
    }
    setEmptyMessage(null);
    setItems(layerPanelRows(regels, nativeOcgLayerStates(activeDoc)));
    setLayerViewDiffers(nativeOcgSelectionDiffers(activeDoc));
    setLayerViewUnsupported(null);
    setCountText(i18next.t('leftPanel.layersCount', { count: aantal }));
    // A PDF whose layer view PDFium cannot show: the toggles go off with the
    // reason (native-ocg-support.js), before a change could fail a render.
    const support = await nativeOcgRenderSupport(activeDoc);
    if (getActiveDocument() !== activeDoc || support?.supported !== false) return;
    setItems(layerPanelRows(regels, nativeOcgLayerStates(activeDoc), support));
    setLayerViewUnsupported(support.reason);
  } catch (e) {
    console.warn('Failed to load layers:', e);
    geenLagen(i18next.t('leftPanel.noLayers'));
  }
}
