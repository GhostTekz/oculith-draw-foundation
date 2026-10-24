import { Show, Index, createSignal, createEffect, onCleanup, untrack } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { layerRows } from '../../../annotations/annotatie-lagen.js';
import { lucide } from '../../data/lucideIcons.js';
import {
  layersVersion,
  addAnnotationLayer, renameAnnotationLayer, setAnnotationLayerFlag, setAllAnnotationLayersFlag,
  setAnnotationLayerColor, moveAnnotationLayerBy, setCurrentAnnotationLayer,
  requestDeleteAnnotationLayer, moveSelectionToAnnotationLayer, selectAnnotationsOnLayer,
  renameRequest, setRenameRequest,
} from '../../stores/annotationLayersStore.js';

// De sectie "Markeringslagen" (#468) bovenaan het paneel Lagen (links), zoals
// in the external editor: markeringen groeperen op benoemde lagen. Per laag een keuzerondje
// voor de huidige laag (daar landen nieuwe markeringen), een kleur, de naam,
// het aantal markeringen, en de schakelaars zichtbaar, afdrukbaar en
// vergrendeld. Een klik op de rij selecteert de markeringen van die laag in de
// Markups List. Rechtsklik: hernoemen, verwijderen, alles selecteren, de
// selectie hierheen verplaatsen, huidige laag maken.
// De regels staan in annotations/annotatie-lagen.js; hier alleen de weergave.
// De rijen staan in een <Index>: de DOM per plek blijft staan als het paneel
// opnieuw rekent, zodat een open naamveld een verversing overleeft.

const ICOON = {
  add: lucide('plus'),
  rename: lucide('pencil'),
  moveUp: lucide('chevron-up'),
  moveDown: lucide('chevron-down'),
  delete: lucide('trash-2'),
  moveSelection: lucide('arrow-right-to-line'),
  visible: lucide('eye'),
  hidden: lucide('eye-off'),
  printer: lucide('printer'),
  locked: lucide('lock'),
  unlocked: lucide('lock-open'),
};

export default function AnnotationLayersPanel() {
  const { t } = useTranslation('ribbon');
  const [gekozen, setGekozen] = createSignal(null);
  const [bewerkId, setBewerkId] = createSignal(null);
  const [fout, setFout] = createSignal('');
  // Het contextmenu van een rij: { id, x, y } of null.
  const [menu, setMenu] = createSignal(null);

  const rows = () => {
    layersVersion();
    const naam = t('annotationLayers.defaultName');
    // The counts read every annotation: untracked, layersVersion is the
    // trigger (every list update bumps it), so a change does not re-subscribe
    // the panel to each markup (#491).
    return untrack(() => layerRows(getActiveDocument(), naam));
  };
  const gekozenRij = () => rows().find((r) => r.id === gekozen()) || null;
  const gekozenIndex = () => rows().findIndex((r) => r.id === gekozen());
  const menuRij = () => rows().find((r) => r.id === menu()?.id) || null;
  const heeftSelectie = () => {
    layersVersion();
    return (getActiveDocument()?.selectedAnnotations || []).length > 0;
  };

  const foutTekst = (code) => (code === 'name-taken'
    ? t('annotationLayers.nameTaken')
    : t('annotationLayers.nameEmpty'));

  function beginHernoemen(rij) {
    if (!rij || rij.isDefault) return;
    setFout('');
    setBewerkId(rij.id);
  }

  function hernoem(id, waarde) {
    const code = renameAnnotationLayer(id, waarde);
    if (code) {
      setFout(foutTekst(code));
      return false;
    }
    setFout('');
    setBewerkId(null);
    return true;
  }

  // "Nieuwe laag…" uit het contextmenu: die laag kiezen en meteen hernoemen.
  createEffect(() => {
    const id = renameRequest();
    if (!id) return;
    setRenameRequest(null);
    setGekozen(id);
    setFout('');
    setBewerkId(id);
  });

  function nieuw() {
    const id = addAnnotationLayer();
    if (!id) return;
    setGekozen(id);
    setFout('');
    setBewerkId(id);
  }

  // Het rijmenu sluit bij een klik ernaast of met Escape.
  // (Solid delegeert onMouseDown naar document: stopPropagation in het menu
  // houdt deze luisteraar niet tegen, dus kijken waar de klik viel.)
  const sluitMenu = () => setMenu(null);
  const opKlik = (e) => { if (!e.target?.closest?.('#al-row-menu')) sluitMenu(); };
  const opToets = (e) => { if (e.key === 'Escape') sluitMenu(); };
  document.addEventListener('mousedown', opKlik);
  document.addEventListener('keydown', opToets);
  onCleanup(() => {
    document.removeEventListener('mousedown', opKlik);
    document.removeEventListener('keydown', opToets);
  });

  function kiesLaag(id) {
    setGekozen(id);
    selectAnnotationsOnLayer(id);
  }

  function openMenu(e, rij) {
    e.preventDefault();
    e.stopPropagation();
    setGekozen(rij.id);
    setMenu({ id: rij.id, x: e.clientX, y: e.clientY });
  }

  function menuActie(actie) {
    const rij = menuRij();
    sluitMenu();
    if (rij) actie(rij);
  }

  const Schakelaar = (p) => (
    <button type="button" class="al-flag" aria-pressed={p.aan() ? 'true' : 'false'}
      classList={{ 'al-flag-off': !p.aan() }}
      title={p.title} aria-label={p.title}
      onClick={(e) => { e.stopPropagation(); p.onToggle(); }}
      innerHTML={p.icon()} />
  );

  return (
    <div class="annotation-layers-panel" id="annotation-layers-panel">
      <div class="al-toolbar">
        {/* Met tekst: de eerste vraag in dit paneel is hoe je een laag maakt. */}
        <button type="button" class="al-tool al-tool-text" id="al-new-layer"
          title={t('annotationLayers.add')}
          disabled={!getActiveDocument()} onClick={nieuw}>
          <span class="al-tool-icon" innerHTML={ICOON.add} />
          <span>{t('annotationLayers.add')}</span>
        </button>
        <span class="al-tool-sep" />
        <button type="button" class="al-tool" title={t('annotationLayers.rename')}
          disabled={!gekozenRij() || gekozenRij().isDefault}
          onClick={() => beginHernoemen(gekozenRij())} innerHTML={ICOON.rename} />
        <button type="button" class="al-tool" title={t('annotationLayers.moveUp')}
          disabled={gekozenIndex() <= 0}
          onClick={() => moveAnnotationLayerBy(gekozen(), -1)} innerHTML={ICOON.moveUp} />
        <button type="button" class="al-tool" title={t('annotationLayers.moveDown')}
          disabled={gekozenIndex() < 0 || gekozenIndex() >= rows().length - 1}
          onClick={() => moveAnnotationLayerBy(gekozen(), 1)} innerHTML={ICOON.moveDown} />
        <button type="button" class="al-tool" title={t('annotationLayers.delete')}
          disabled={!gekozenRij() || gekozenRij().isDefault}
          onClick={() => requestDeleteAnnotationLayer(gekozen())} innerHTML={ICOON.delete} />
        <button type="button" class="al-tool" title={t('annotationLayers.moveSelection')}
          disabled={!gekozenRij()}
          onClick={() => moveSelectionToAnnotationLayer(gekozen())} innerHTML={ICOON.moveSelection} />
        <span class="al-tool-sep" />
        <button type="button" class="al-tool" id="al-show-all" title={t('annotationLayers.showAll')}
          disabled={!getActiveDocument()}
          onClick={() => setAllAnnotationLayersFlag('visible', true)} innerHTML={ICOON.visible} />
        <button type="button" class="al-tool" id="al-hide-all" title={t('annotationLayers.hideAll')}
          disabled={!getActiveDocument()}
          onClick={() => setAllAnnotationLayersFlag('visible', false)} innerHTML={ICOON.hidden} />
        <button type="button" class="al-tool" id="al-lock-all" title={t('annotationLayers.lockAll')}
          disabled={!getActiveDocument()}
          onClick={() => setAllAnnotationLayersFlag('locked', true)} innerHTML={ICOON.locked} />
        <button type="button" class="al-tool" id="al-unlock-all" title={t('annotationLayers.unlockAll')}
          disabled={!getActiveDocument()}
          onClick={() => setAllAnnotationLayersFlag('locked', false)} innerHTML={ICOON.unlocked} />
      </div>

      {/* Kolomkoppen als iconen (het paneel is smal); de naam staat in de tooltip. */}
      <div class="al-column-head">
        <span class="al-col-cur" title={t('annotationLayers.setCurrent')} aria-label={t('annotationLayers.colCurrent')} />
        <span class="al-col-name">{t('annotationLayers.colName')}</span>
        <span class="al-col-count" title={t('annotationLayers.colCount')} aria-label={t('annotationLayers.colCount')}>#</span>
        <span class="al-col-flag" title={t('annotationLayers.toggleVisible')} aria-label={t('annotationLayers.colVisible')} innerHTML={ICOON.visible} />
        <span class="al-col-flag" title={t('annotationLayers.togglePrintable')} aria-label={t('annotationLayers.colPrintable')} innerHTML={ICOON.printer} />
        <span class="al-col-flag" title={t('annotationLayers.toggleLocked')} aria-label={t('annotationLayers.colLocked')} innerHTML={ICOON.locked} />
      </div>

      <div class="al-panel-body">
        <Index each={rows()}>
          {(rij) => (
            <div class="al-row" data-layer-id={rij().id}
              classList={{
                'al-row-selected': gekozen() === rij().id,
                'al-row-hidden': !rij().visible,
                'al-row-locked': rij().locked,
                'al-row-current': rij().current,
              }}
              onClick={() => kiesLaag(rij().id)}
              onContextMenu={(e) => openMenu(e, rij())}>
              <label class="al-cell-center" title={t('annotationLayers.setCurrent')}>
                <input type="radio" name="al-current" checked={rij().current}
                  onChange={() => setCurrentAnnotationLayer(rij().id)} />
              </label>
              <div class="al-name-cell">
                <input type="color" class="al-swatch" title={t('annotationLayers.color')}
                  value={rij().color || '#808080'}
                  onChange={(e) => setAnnotationLayerColor(rij().id, e.currentTarget.value)} />
                <Show when={bewerkId() === rij().id} fallback={
                  <span class="al-name" title={rij().name}
                    onDblClick={() => beginHernoemen(rij())}>{rij().name}</span>
                }>
                  {/* Niet aan value={} gebonden: een verversing van de rijen
                      zou de getypte tekst dan overschrijven. */}
                  <input type="text" class="al-name-input"
                    ref={(el) => { el.value = rij().name; queueMicrotask(() => { el.focus(); el.select(); }); }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') hernoem(rij().id, e.currentTarget.value);
                      else if (e.key === 'Escape') { setFout(''); setBewerkId(null); }
                    }}
                    onBlur={(e) => { if (!hernoem(rij().id, e.currentTarget.value)) { setFout(''); setBewerkId(null); } }} />
                </Show>
              </div>
              <span class="al-count">{rij().count}</span>
              <Schakelaar aan={() => rij().visible} title={t('annotationLayers.toggleVisible')}
                icon={() => (rij().visible ? ICOON.visible : ICOON.hidden)}
                onToggle={() => setAnnotationLayerFlag(rij().id, 'visible', !rij().visible)} />
              <Schakelaar aan={() => rij().printable} title={t('annotationLayers.togglePrintable')}
                icon={() => ICOON.printer}
                onToggle={() => setAnnotationLayerFlag(rij().id, 'printable', !rij().printable)} />
              <Schakelaar aan={() => !rij().locked} title={t('annotationLayers.toggleLocked')}
                icon={() => (rij().locked ? ICOON.locked : ICOON.unlocked)}
                onToggle={() => setAnnotationLayerFlag(rij().id, 'locked', !rij().locked)} />
            </div>
          )}
        </Index>
        <Show when={fout()}>
          <div class="al-error">{fout()}</div>
        </Show>
      </div>

      <Show when={menu() && menuRij()}>
        <div class="al-row-menu" role="menu" id="al-row-menu"
          style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
          onContextMenu={(e) => e.preventDefault()}>
          <button type="button" role="menuitem" disabled={menuRij().isDefault}
            onClick={() => menuActie(beginHernoemen)}>{t('annotationLayers.rename')}</button>
          <button type="button" role="menuitem" disabled={menuRij().isDefault}
            onClick={() => menuActie((r) => requestDeleteAnnotationLayer(r.id))}>{t('annotationLayers.delete')}</button>
          <div class="al-row-menu-sep" />
          <button type="button" role="menuitem" disabled={menuRij().count === 0}
            onClick={() => menuActie((r) => selectAnnotationsOnLayer(r.id))}>{t('annotationLayers.selectAll')}</button>
          <button type="button" role="menuitem" disabled={!heeftSelectie()}
            onClick={() => menuActie((r) => moveSelectionToAnnotationLayer(r.id))}>{t('annotationLayers.moveSelectionHere')}</button>
          <button type="button" role="menuitem" disabled={menuRij().current}
            onClick={() => menuActie((r) => setCurrentAnnotationLayer(r.id))}>{t('annotationLayers.makeCurrent')}</button>
        </div>
      </Show>
    </div>
  );
}
