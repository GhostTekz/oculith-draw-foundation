import { For, Show, createMemo } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { layerRows } from '../../../annotations/annotatie-lagen.js';
import { layersVersion } from '../../stores/annotationLayersStore.js';
import {
  annotProps, panelLayerId, panelTargets, setPanelLayer, selectionRev, NEW_LAYER_VALUE,
} from '../../stores/propertiesStore.js';

// De keuzelijst Laag (the external editor): de markeringslagen van het document plus
// "Nieuwe laag…". Werkt voor één markering en voor een meervoudige selectie;
// staan de markeringen op verschillende lagen, dan blijft het veld leeg.
// Kiezen verplaatst alles in één undo-stap (moveAnnotationsToAnnotationLayer).
// Gebruikt in de sectie Algemeen van het eigenschappenpaneel en, compact, in
// de eigenschappenbalk bovenaan.

export default function LayerField(props) {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const { t: tContext } = useTranslation('context');
  const { t: tRibbon } = useTranslation('ribbon');

  const rijen = () => {
    layersVersion();
    return layerRows(getActiveDocument(), tRibbon('annotationLayers.defaultName'));
  };
  // Memos: every <option> asks for the value, and working it out looks up
  // the selection in the document (once per change, not per layer).
  const waarde = createMemo(() => {
    layersVersion();
    return panelLayerId();
  });
  const doelen = createMemo(() => { selectionRev(); layersVersion(); return panelTargets(); });
  const gemengd = () => !waarde() && doelen().length > 1;
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  async function kies(e) {
    const el = e.currentTarget;
    const gekozen = el.value;
    await setPanelLayer(gekozen);
    // Niets verplaatst (of een nieuwe laag): de lijst toont weer wat geldt.
    el.value = waarde();
  }

  return (
    <select class={props.class} id={props.id} aria-label={t('general.layer')}
      title={gemengd() ? tCommon('mixed') : t('general.layer')}
      disabled={isLocked() || doelen().length === 0}
      onChange={kies}>
      <Show when={!waarde()}>
        {/* Gemengd: leeg, zoals in the external editor; de tooltip zegt "Gemengd". */}
        <option value="" selected disabled hidden />
      </Show>
      <For each={rijen()}>
        {(r) => <option value={r.id} selected={r.id === waarde()}>{r.name}</option>}
      </For>
      <option value={NEW_LAYER_VALUE}>{tContext('annotation.newLayer')}</option>
    </select>
  );
}
