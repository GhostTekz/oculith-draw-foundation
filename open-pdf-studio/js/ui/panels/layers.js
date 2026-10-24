import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { setLayerItems as setItems, setLayerCountText as setCountText, setLayerEmptyMessage as setEmptyMessage } from '../../bridge.js';
import { lagenLijst } from './lagen-lijst.js';
import { nativeOcgPdfJsConfig } from '../../pdf/native-ocg-selection.js';

function geenLagen(melding) {
  setItems([]);
  setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
  setEmptyMessage(melding);
}

// Het paneel toont de geselecteerde stand, maar de bediening blijft uit totdat
// ook de overige bestands- en exportpaden geaccepteerd zijn.
export async function updateLayersList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    geenLagen(i18next.t('leftPanel.noDocumentOpen'));
    return;
  }

  setEmptyMessage(i18next.t('loading'));

  try {
    const ocConfig = await nativeOcgPdfJsConfig(activeDoc);
    // De annotatielagen van deze app zijn ook OCG's (#468), maar staan in het
    // paneel Markeringslagen; hier alleen de lagen van de tekening zelf.
    const regels = lagenLijst(ocConfig, { overslaan: activeDoc._annotatieLaagOcgIds || new Set() });
    const aantal = regels.filter((r) => !r.kop).length;
    if (!aantal) {
      geenLagen(i18next.t('leftPanel.noLayers'));
      return;
    }
    setEmptyMessage(null);
    setItems(regels);
    setCountText(i18next.t('leftPanel.layersCount', { count: aantal }));
  } catch (e) {
    console.warn('Failed to load layers:', e);
    geenLagen(i18next.t('leftPanel.noLayers'));
  }
}
