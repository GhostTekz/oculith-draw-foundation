import { Show } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { state, noPdf } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { clearSelection, selectAllOnPage } from '../../../core/stores/selection-helpers.js';
import { contextualTabsVisible } from '../../stores/ribbonStore.js';
import { flipHorizontal, flipVertical } from '../../../annotations/z-order.js';
import { alignLeft } from '../../../annotations/alignment.js';
import {
  handIcon, selectCommentsIcon, findIcon,
  lineIcon, arrowIcon, drawIcon, eraserIcon, rectIcon, polylineIcon, textboxIcon, noteIcon, ellipseIcon, circleIcon,
  calloutIcon, cloudIcon, polygonIcon, cloudPolylineIcon,
  typewriterIcon, hyperlinkIcon, flagIcon, snapshotIcon, formatPainterIcon, multiplyIcon,
  measureDistanceIcon, measureAngleIcon, measurePerimeterIcon, measureAreaIcon,
  alignLeftIcon, alignTopIcon, alignBottomIcon,
  flipHIcon, flipVIcon, rotateCwIcon,
  clearAllIcon, calibrateIcon, setScaleIcon,
  placeholderIcon, arcIcon, splineIcon, splineArrowIcon, hatchIcon, imageIcon, removeImageIcon, moveIcon, copyAnnIcon, arrayIcon, trimIcon, extendIcon, pasteIcon, pasteInPlaceIcon, cutIcon, deleteIcon, tableIcon, knipselIcon, knipselPlakIcon, scaleRegionIcon, labelIcon, lShapeIcon, radiusIcon, diameterIcon, explodeIcon, joinIcon, splitIcon, breakIcon, lengthenIcon, collectionCreateIcon, collectionExplodeIcon, countIcon, dimensionIcon, selectAllIcon, deselectIcon
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { runCommand } from '../../commands/registry.js';

// The drawing groups are exported as a standalone fragment so the merged
// "Tekenen & annotatie" tab (AnnotateTab) can compose them alongside the
// comment groups inside a single AdaptiveGroups container.
export function DrawingGroups() {
  const { t } = useTranslation('ribbon');
  const { t: tProperties } = useTranslation('properties');
  const { t: tDialogs } = useTranslation('dialogs');
  const ro = () => noPdf() || isPdfAReadOnly();
  const cs = t('common.comingSoon') || 'Coming soon';

  return (
    <>

        {/* SELECTION */}
        <RibbonGroup label={t('drawing.selection')}>
          <RibbonButton id="dr-select" title={t('home.select')} icon={selectCommentsIcon} label={t('home.select')}
            disabled={noPdf()} active={state.currentTool === 'select'} onClick={() => runCommand('edit.select')} />
          <RibbonButton id="dr-pan" title={t('home.handTool')} icon={handIcon} label={t('home.hand')}
            disabled={noPdf()} active={state.currentTool === 'hand'} onClick={() => runCommand('edit.pan')} />
          <RibbonButtonStack>
            {/* selectAllOnPage/clearSelection zetten alleen state; zonder
                redraw blijven selectiehandvatten en de contextuele tabs
                (Opmaak/Schikken) achter op de werkelijke selectie. */}
            <RibbonButton size="small" id="dr-select-all" title={t('drawing.selectAll')} icon={selectAllIcon} label={t('drawing.selectAll')}
              disabled={noPdf()} onClick={() => runCommand('edit.selectAll')} />
            <RibbonButton size="small" id="dr-deselect" title={t('drawing.deselect')} icon={deselectIcon} label={t('drawing.deselect')}
              disabled={noPdf()} onClick={() => runCommand('edit.deselect')} />
            <RibbonButton size="small" id="dr-find" title={t('drawing.findReplace')} icon={findIcon} label={t('drawing.findReplace')}
              disabled={noPdf()} onClick={() => runCommand('edit.find')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* SCHAAL — Add Viewport (a named viewport with its own scale) and
            the page-scale entry points of the Measure tab. */}
        <RibbonGroup label={t('measure.scaleGroup') || 'Schaal'}>
          <RibbonButton id="btn-create-scale-region"
            title={t('comment.addViewportTitle')}
            icon={scaleRegionIcon}
            label={t('comment.addViewport')}
            disabled={ro()}
            active={state.currentTool === 'scaleRegion'}
            onClick={() => runCommand('tools.measure.addViewport')} />
          {/* Same document-scale entry points as the Measure tab. */}
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-calibrate" title={t('measure.selectPointsTitle')}
              icon={calibrateIcon} label={t('comment.calibrate')}
              disabled={ro()} active={state.currentTool === 'calibrationPick'}
              onClick={() => runCommand('tools.measure.calibrate')} />
            <RibbonButton size="small" id="dr-set-scale" title={tDialogs('setScale.title')}
              icon={setScaleIcon} label={tDialogs('setScale.title')}
              disabled={ro()} onClick={() => runCommand('tools.measure.setScale')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Keep the daily takeoff tools together and ahead of the broad CAD
            palette, which may move into the adaptive overflow on small screens. */}
        <RibbonGroup label={t('measure.tools')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-length" title={t('measure.measureDistance')} icon={measureDistanceIcon} label={t('measure.distance')}
              disabled={ro()} active={state.currentTool === 'measureDistance'} onClick={() => runCommand('tools.measure.length')} />
            <RibbonButton size="small" id="dr-area" title={t('measure.measureArea')} icon={measureAreaIcon} label={t('measure.area')}
              disabled={ro()} active={state.currentTool === 'measureArea'} onClick={() => runCommand('tools.measure.area')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-measure" title={t('measure.measurePerimeter')} icon={measurePerimeterIcon} label={t('measure.perimeter')}
              disabled={ro()} active={state.currentTool === 'measurePerimeter'} onClick={() => runCommand('tools.measure.perimeter')} />
            <RibbonButton size="small" id="dr-count" title={tProperties('quantities.type.count')} icon={countIcon} label={tProperties('quantities.type.count')}
              disabled={ro()} active={state.currentTool === 'count'} onClick={() => runCommand('tools.measure.count')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* DRAW — uniform grid of small icon-only buttons (CAD toolbar style).
            All buttons are 26×26 size=small; the compact group's flex-wrap CSS
            arranges them into 2 rows × 7 cols. */}
        <RibbonGroup label={t('drawing.draw')} compact>
          {/* Row 1 */}
          <RibbonButton size="small" id="dr-line" title={t('comment.line')} icon={lineIcon}
            disabled={ro()} active={state.currentTool === 'line'} onClick={() => runCommand('tools.markup.line')} />
          <RibbonButton size="small" id="dr-arrow" title={t('comment.arrow')} icon={arrowIcon}
            disabled={ro()} active={state.currentTool === 'arrow'} onClick={() => runCommand('tools.markup.arrow')} />
          <RibbonButton size="small" id="dr-spline-arrow" title={t('comment.splineArrowTitle')} icon={splineArrowIcon}
            disabled={ro()} active={state.currentTool === 'splineArrow'} onClick={() => runCommand('tools.markup.curvedArrow')} />
          <RibbonButton size="small" id="dr-draw" title={t('comment.freehand')} icon={drawIcon}
            disabled={ro()} active={state.currentTool === 'draw'} onClick={() => runCommand('tools.markup.pen')} />
          <RibbonButton size="small" id="dr-eraser" title={t('drawing.eraser')} icon={eraserIcon}
            disabled={ro()} active={state.currentTool === 'eraser'} onClick={() => runCommand('tools.markup.eraser')} />
          <RibbonButton size="small" id="dr-rect" title={t('comment.rectangle')} icon={rectIcon}
            disabled={ro()} active={state.currentTool === 'box'} onClick={() => runCommand('tools.markup.rectangle')} />
          <RibbonButton size="small" id="dr-arc" title="Arc" icon={arcIcon}
            disabled={ro()} active={state.currentTool === 'arc'} onClick={() => runCommand('tools.markup.arc')} />
          <RibbonButton size="small" id="dr-polyline" title={t('comment.polylineTitle')} icon={polylineIcon}
            disabled={ro()} active={state.currentTool === 'polyline'} onClick={() => runCommand('tools.markup.polyline')} />
          <RibbonButton size="small" id="dr-hatch" title={t('comment.filledArea')} icon={hatchIcon}
            disabled={ro()} active={state.currentTool === 'filledArea'} onClick={() => runCommand('tools.markup.filledArea')} />
          <RibbonButton size="small" id="dr-text" title={t('comment.textBox')} icon={textboxIcon}
            disabled={ro()} active={state.currentTool === 'textbox'} onClick={() => runCommand('tools.markup.textBox')} />
          <RibbonButton size="small" id="dr-note" title={t('comment.note')} icon={noteIcon}
            disabled={ro()} active={state.currentTool === 'comment'} onClick={() => runCommand('tools.markup.note')} />
          {/* Row 2 */}
          <RibbonButton size="small" id="dr-spline" title={t('comment.splineTitle')} icon={splineIcon}
            disabled={ro()} active={state.currentTool === 'spline'} onClick={() => runCommand('tools.markup.spline')} />
          <RibbonButton size="small" id="dr-circle" title={t('format.circle') || 'Cirkel'} icon={circleIcon}
            disabled={ro()} active={state.currentTool === 'circle'} onClick={() => runCommand('tools.markup.circle')} />
          <RibbonButton size="small" id="dr-ellipse" title={t('comment.ellipse') || 'Ellips'} icon={ellipseIcon}
            disabled={ro()} active={state.currentTool === 'ellipse'} onClick={() => runCommand('tools.markup.ellipse')} />
          <RibbonButton size="small" id="dr-l-shape" title={t('drawing.lShape')} icon={lShapeIcon}
            disabled={ro()} active={state.currentTool === 'lshape'} onClick={() => runCommand('tools.markup.lShape')} />
          <RibbonButton size="small" id="dr-image" title={t('drawing.image')} icon={imageIcon}
            disabled={ro()} onClick={() => runCommand('tools.markup.image')} />
          <RibbonButton size="small" id="dr-remove-image" title={t('drawing.removeImage')} icon={removeImageIcon}
            disabled={ro()} active={state.currentTool === 'removeImage'} onClick={() => runCommand('tools.markup.removeImage')} />
        </RibbonGroup>

        {/* LIJN-OPTIES — alleen zichtbaar bij het lijn-gereedschap. Bevat het
            'Doorlopend'-vinkje dat de doorlopende (keten) tekenmodus schakelt.
            Deelt exact dezelfde preference (state.preferences.lineContinue) als
            het vinkje in het eigenschappen-paneel — één bron van waarheid. */}
        <Show when={state.currentTool === 'line'}>
          <RibbonGroup label={t('comment.line') || 'Lijn'}>
            <label class="ribbon-checkbox-option" title={t('drawing.lineContinueTip') || 'Elke klik verbindt het volgende segment met het vorige'}>
              <input
                type="checkbox"
                checked={state.preferences.lineContinue === true}
                onChange={(e) => { state.preferences.lineContinue = e.currentTarget.checked; savePreferences(); }}
              />
              <span>{t('drawing.lineContinue') || 'Doorlopend'}</span>
            </label>
          </RibbonGroup>
        </Show>

        {/* VECTORKNIPSEL — een gebied uit deze tekening knippen en elders
            vectorieel plakken. Zie js/pdf/vector-embed.js. */}
        <RibbonGroup label={t('drawing.snippetGroup') || 'Knipsel'}>
          <RibbonButton id="btn-vector-snippet"
            title={t('drawing.vectorSnippetTitle') || 'Knip een gebied uit deze tekening; het blijft vector'}
            icon={knipselIcon}
            label={t('drawing.vectorSnippet') || 'Vectorknipsel'}
            disabled={ro()}
            active={state.currentTool === 'vectorSnippet'}
            onClick={() => runCommand('edit.vectorSnippet')} />
          <RibbonButton id="btn-vector-snippet-paste"
            title={t('drawing.vectorSnippetPasteTitle') || 'Plak het geknipte gebied hier, met behoud van vectordata'}
            icon={knipselPlakIcon}
            label={t('drawing.vectorSnippetPaste') || 'Plak knipsel'}
            disabled={ro()}
            onClick={() => runCommand('edit.vectorSnippetPaste')} />
        </RibbonGroup>

        {/* De stavenreeks staat bewust NIET op de ribbon maar in het
            toolpalette (NL IFC Bouw), bij de andere constructieve objecten. */}

        {/* ANNOTATE */}
        <RibbonGroup label={t('drawing.annotate')}>
          <RibbonButtonStack>
            {/* "Uitgelijnd" + "Lineair" merged into a single Maatlijn button —
                both fired the same measureDistance tool anyway. */}
            <RibbonButton size="small" id="dr-dimension" title={t('measure.measureDistance')} icon={dimensionIcon} label={t('drawing.dimension') || 'Maatlijn'}
              disabled={ro()} active={state.currentTool === 'measureDistance'} onClick={() => runCommand('tools.measure.length')} />
            <RibbonButton size="small" id="dr-angular" title={t('measure.measureAngle')} icon={measureAngleIcon} label={t('drawing.angular')}
              disabled={ro()} active={state.currentTool === 'measureAngle'} onClick={() => runCommand('tools.measure.angle')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            {/* Spot Coord — placeholder icon, deferred */}
            <RibbonButton size="small" id="dr-spot-coord" title={cs} icon={placeholderIcon} label={t('drawing.spotCoord')}
              disabled={true} />
            {/* Radius — 2-click radius dimension (centre → rim) */}
            <RibbonButton size="small" id="dr-radius" title={t('drawing.radius')} icon={radiusIcon} label={t('drawing.radius')}
              disabled={ro()} active={state.currentTool === 'radius'} onClick={() => runCommand('tools.measure.radius')} />
            {/* Diameter — 2-click diameter dimension (side → side) */}
            <RibbonButton size="small" id="dr-diameter" title={t('drawing.diameter')} icon={diameterIcon} label={t('drawing.diameter')}
              disabled={ro()} active={state.currentTool === 'diameter'} onClick={() => runCommand('tools.measure.diameter')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-leader" title={t('comment.callout')} icon={calloutIcon} label={t('drawing.leader')}
              disabled={ro()} active={state.currentTool === 'callout'} onClick={() => runCommand('tools.markup.callout')} />
            <RibbonButton size="small" id="dr-label" title={t('drawing.label')} icon={labelIcon} label={t('drawing.label')}
              disabled={ro()} active={state.currentTool === 'textbox'} onClick={() => runCommand('tools.markup.textBox')} />
            {/* Table — no scheduleTable tool registered; deferred */}
            <RibbonButton size="small" id="dr-table" title={cs} icon={tableIcon} label={t('drawing.table')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-cloud" title={t('comment.cloud')} icon={cloudIcon} label={t('comment.cloud')}
              disabled={ro()} active={state.currentTool === 'cloud'} onClick={() => runCommand('tools.markup.cloud')} />
            <RibbonButton size="small" id="dr-cloud-polyline" title={t('comment.cloudPolylineTitle')} icon={cloudPolylineIcon} label={t('comment.cloudPolyline')}
              disabled={ro()} active={state.currentTool === 'cloudPolyline'} onClick={() => runCommand('tools.markup.cloudPolyline')} />
            <RibbonButton size="small" id="dr-polygon" title={t('comment.polygonTitle')} icon={polygonIcon} label={t('comment.polygon')}
              disabled={ro()} active={state.currentTool === 'polygon'} onClick={() => runCommand('tools.markup.polygon')} />
          </RibbonButtonStack>
          {/* the external editor markups: Typewriter (W), Hyperlink (Shift+H), Flag (Shift+F) */}
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-typewriter" title={t('comment.typewriterTitle')} icon={typewriterIcon} label={t('comment.typewriter')}
              disabled={ro()} active={state.currentTool === 'typewriter'} onClick={() => runCommand('tools.markup.typewriter')} />
            <RibbonButton size="small" id="dr-hyperlink" title={t('comment.hyperlinkTitle')} icon={hyperlinkIcon} label={t('comment.hyperlink')}
              disabled={ro()} active={state.currentTool === 'hyperlink'} onClick={() => runCommand('tools.markup.hyperlink')} />
            <RibbonButton size="small" id="dr-flag" title={t('comment.flagTitle')} icon={flagIcon} label={t('comment.flag')}
              disabled={ro()} active={state.currentTool === 'flag'} onClick={() => runCommand('tools.markup.flag')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* MODIFY — icon-only buttons (issue #278: "Wijzigen" toont alleen
            iconen; volledige naam blijft als tooltip beschikbaar). */}
        <RibbonGroup label={t('drawing.modify')} iconOnly>
          {/* Bloksgewijs: 3 kolommen × 2 kleine iconen zodat de groep een
              net, gelijkmatig blok vormt i.p.v. een mix van grote losse
              knoppen en een kleine stapel. */}
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-move" title={t('drawing.move')} icon={moveIcon} label={t('drawing.move')}
              disabled={ro()} onClick={() => runCommand('edit.move')} />
            <RibbonButton size="small" id="dr-copy" title={t('drawing.copy')} icon={copyAnnIcon} label={t('drawing.copy')}
              disabled={ro()} onClick={() => runCommand('edit.duplicate')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-mirror-h" title={t('arrange.flipHorizontally')} icon={flipHIcon} label={t('drawing.mirrorH')}
              disabled={ro()} onClick={() => runCommand('arrange.flipHorizontal')} />
            <RibbonButton size="small" id="dr-mirror-v" title={t('arrange.flipVertically')} icon={flipVIcon} label={t('drawing.mirrorV')}
              disabled={ro()} onClick={() => runCommand('arrange.flipVertical')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-array" title={t('drawing.array')} icon={arrayIcon} label={t('drawing.array')}
              disabled={ro()} active={state.currentTool === 'array'} onClick={() => runCommand('tools.array')} />
            {/* Rotate — roteer de selectie 90° CW (zelfde operatie als de Schikken-tab) */}
            <RibbonButton size="small" id="dr-rotate" title={t('drawing.rotate')} icon={rotateCwIcon} label={t('drawing.rotate')}
              disabled={ro()} onClick={() => runCommand('arrange.rotateCw')} />
          </RibbonButtonStack>
          {/* the external editor: Format Painter (Ctrl+Shift+C) and Multiply */}
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-format-painter" title={t('drawing.formatPainterTitle')} icon={formatPainterIcon} label={t('drawing.formatPainter')}
              disabled={ro()} active={state.currentTool === 'formatPainter'} onClick={() => runCommand('edit.formatPainter')} />
            <RibbonButton size="small" id="dr-multiply" title={t('drawing.multiplyTitle')} icon={multiplyIcon} label={t('drawing.multiply')}
              disabled={ro() || !contextualTabsVisible()} onClick={() => runCommand('edit.multiply')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* EDIT — modify-gereedschappen (Inkorten, Verlengen, Uitlijnen, …).
            Deze werken uitsluitend op bestaande geometrie / een geselecteerd
            object, dus de hele groep is alleen zichtbaar zodra er een selectie
            actief is. Hergebruikt hetzelfde reactieve signaal dat de
            contextuele tabs (Opmaak/Schikken) toont: contextualTabsVisible()
            == selectedAnnotations.length > 0. Bij deselectie verdwijnt de
            volledige RibbonGroup (geen lege groep-kop). (issue #280) */}
        <Show when={contextualTabsVisible()}>
        <RibbonGroup label={t('drawing.edit')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-trim" title={t('drawing.trim')} icon={trimIcon} label={t('drawing.trim')}
              disabled={ro()} active={state.currentTool === 'trim'} onClick={() => runCommand('tools.trim')} />
            <RibbonButton size="small" id="dr-extend" title={t('drawing.extend')} icon={extendIcon} label={t('drawing.extend')}
              disabled={ro()} active={state.currentTool === 'extend'} onClick={() => runCommand('tools.extend')} />
            <RibbonButton size="small" id="dr-offset" title={cs} icon={placeholderIcon} label={t('drawing.offset')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-fillet" title={cs} icon={placeholderIcon} label={t('drawing.fillet')}
              disabled={true} />
            <RibbonButton size="small" id="dr-chamfer" title={cs} icon={placeholderIcon} label={t('drawing.chamfer')}
              disabled={true} />
            <RibbonButton size="small" id="dr-stretch" title={cs} icon={placeholderIcon} label={t('drawing.stretch')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-split" title={t('drawing.split')} icon={splitIcon} label={t('drawing.split')}
              disabled={ro()} active={state.currentTool === 'split'} onClick={() => runCommand('tools.split')} />
            <RibbonButton size="small" id="dr-align" title={t('arrange.alignLeft')} icon={alignLeftIcon} label={t('drawing.align')}
              disabled={ro()} onClick={() => runCommand('arrange.alignLeft')} />
            <RibbonButton size="small" id="dr-explode" title={t('drawing.explode')} icon={explodeIcon} label={t('drawing.explode')}
              disabled={ro()} onClick={() => runCommand('tools.explode')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-break" title={t('drawing.break')} icon={breakIcon} label={t('drawing.break')}
              disabled={ro()} active={state.currentTool === 'break'} onClick={() => runCommand('tools.break')} />
            <RibbonButton size="small" id="dr-join" title={t('drawing.join')} icon={joinIcon} label={t('drawing.join')}
              disabled={ro()} onClick={() => runCommand('tools.join')} />
            <RibbonButton size="small" id="dr-lengthen" title={t('drawing.lengthen')} icon={lengthenIcon} label={t('drawing.lengthen')}
              disabled={ro()} active={state.currentTool === 'lengthen'} onClick={() => runCommand('tools.lengthen')} />
          </RibbonButtonStack>
        </RibbonGroup>
        </Show>

        {/* CLIPBOARD */}
        <RibbonGroup label={t('drawing.clipboard')}>
          <RibbonButton id="dr-snapshot" title={t('comment.snapshotTitle')} icon={snapshotIcon} label={t('comment.snapshot')}
            disabled={ro()} active={state.currentTool === 'snapshot'} onClick={() => runCommand('edit.snapshot')} />
          <RibbonButton id="dr-paste" title={t('drawing.paste')} icon={pasteIcon} label={t('drawing.paste')}
            disabled={ro()} onClick={() => runCommand('edit.paste')} />
          <RibbonButton id="dr-paste-in-place" title={`${t('drawing.pasteInPlace')} (Ctrl+Shift+V)`} icon={pasteInPlaceIcon} label={t('drawing.pasteInPlace')}
            disabled={ro()} onClick={() => runCommand('edit.pasteInPlace')} />
          {/* Knippen / Kopiëren / Verwijderen — icon-only (issue #278);
              de naam blijft als tooltip beschikbaar. */}
          <RibbonButtonStack>
            <RibbonButton size="small" iconOnly id="dr-cut" title={t('drawing.cut')} icon={cutIcon} label={t('drawing.cut')}
              disabled={ro()} onClick={() => runCommand('edit.cut')} />
            <RibbonButton size="small" iconOnly id="dr-clip-copy" title={t('drawing.copy')} icon={copyAnnIcon} label={t('drawing.copy')}
              disabled={ro()} onClick={() => runCommand('edit.copy')} />
            <RibbonButton size="small" iconOnly id="dr-delete" title={t('drawing.delete')} icon={deleteIcon} label={t('drawing.delete')}
              disabled={ro()} onClick={() => runCommand('edit.delete')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* COLLECTION */}
        <RibbonGroup label={t('drawing.collection')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-coll-create" title={t('drawing.collectionCreate')} icon={collectionCreateIcon} label={t('drawing.collectionCreate')}
              disabled={ro()} onClick={() => runCommand('edit.group')} />
            <RibbonButton size="small" id="dr-coll-explode" title={t('drawing.collectionExplode')} icon={collectionExplodeIcon} label={t('drawing.collectionExplode')}
              disabled={ro()} onClick={() => runCommand('edit.ungroup')} />
          </RibbonButtonStack>
        </RibbonGroup>

    </>
  );
}

export default function DrawingTab() {
  return (
    <div class="ribbon-content active" id="tab-drawing">
      <AdaptiveGroups>
        <DrawingGroups />
      </AdaptiveGroups>
    </div>
  );
}
