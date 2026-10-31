import { Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Asked before an output that cannot use the current PDF layer view yet
// (js/pdf/layer-output-policy.js): reset the layers to the PDF default and
// continue, export a raster copy that shows the chosen layers, or cancel.
export default function LayerSelectionDialog(props) {
  const { t } = useTranslation('dialogs');
  const data = props.data || {};
  const options = Array.isArray(data.options) ? data.options : ['reset', 'cancel'];
  const raster = options.includes('raster');
  const answer = (choice) => {
    closeDialog('layer-selection');
    data.resolve?.(choice);
  };
  const footer = (
    <div class="message-dialog-footer layer-selection-footer">
      <button type="button" class="pref-btn pref-btn-primary" id="layer-selection-reset"
        onClick={() => answer('reset')}>{t('layerSelection.reset')}</button>
      <Show when={raster}>
        <button type="button" class="pref-btn" id="layer-selection-raster"
          onClick={() => answer('raster')}>{t('layerSelection.raster')}</button>
      </Show>
      <button type="button" class="pref-btn" id="layer-selection-cancel"
        onClick={() => answer('cancel')}>{t('layerSelection.cancel')}</button>
    </div>
  );
  return (
    <Dialog
      title={t('layerSelection.title')}
      overlayClass="message-dialog-overlay"
      dialogClass="message-dialog layer-selection-dialog"
      onClose={() => answer('cancel')}
      footer={footer}
    >
      <div class="message-dialog-body">
        <p>{t(`layerSelection.route.${data.route}`, { defaultValue: t('layerSelection.route.default') })}</p>
        <p>{t(raster ? 'layerSelection.explainRaster' : 'layerSelection.explain')}</p>
      </div>
    </Dialog>
  );
}
