import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import ThemePicker from './ThemePicker.jsx';
import { singlePageIcon, continuousIcon, bookViewIcon, facingPagesIcon, navigationIcon, propertiesIcon, annotationsListIcon, toolPaletteIcon, fullscreenIcon, fullscreenExitIcon, elementVisibilityIcon, annotationLayersIcon, rotateLeftIcon, rotateRightIcon, handIcon, fitWidthIcon, fitPageIcon, actualSizeIcon, zoomInIcon, zoomOutIcon, compareIcon, thinLinesIcon, readerModeIcon, keystrokesIcon } from '../../data/ribbonIcons.js';
import { isFullscreen } from '../../stores/ribbonStore.js';
import { keystrokeOverlayVisible } from '../KeystrokeOverlay.jsx';
import { fitWidth, fitPage, actualSize, zoomIn, zoomOut } from '../../../pdf/renderer.js';
import { state, noPdf, getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { readerTrackingPath } from '../../../core/reader-mode-tracking.js';
import { compareActive } from '../../../compare/compare-store.js';
import { runCommand, isCommandChecked } from '../../commands/registry.js';

// Panel buttons light up when their Window ▸ Panels command is checked (the
// panel is on screen in its host, or the Tool Chest floats).
const panelOn = (id) => !!isCommandChecked(id);

export default function ViewTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-view">
      <AdaptiveGroups>
        <RibbonGroup label={t('home.view')}>
          <RibbonButton id="review-hand" title={t('home.handTool')} icon={handIcon} label={t('home.hand')}
            disabled={noPdf()} active={state.currentTool === 'hand'} onClick={() => runCommand('edit.pan')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="review-fit-page" title={t('home.fitPage')} icon={fitPageIcon} label={t('home.fitPageLabel')}
              disabled={noPdf()} onClick={() => runCommand('view.fitPage')} />
            <RibbonButton size="small" id="review-fit-width" title={t('home.fitWidth')} icon={fitWidthIcon} label={t('home.fitWidth')}
              disabled={noPdf()} onClick={() => runCommand('view.fitWidth')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="review-zoom-in" title={t('home.zoomIn')} icon={zoomInIcon} label={t('home.zoomIn')}
              disabled={noPdf()} onClick={() => runCommand('view.zoomIn')} />
            <RibbonButton size="small" id="review-zoom-out" title={t('home.zoomOut')} icon={zoomOutIcon} label={t('home.zoomOut')}
              disabled={noPdf()} onClick={() => runCommand('view.zoomOut')} />
            <RibbonButton size="small" id="review-actual-size" title={t('home.actualSize')} icon={actualSizeIcon} label={t('home.hundredPercent')}
              disabled={noPdf()} onClick={() => runCommand('view.actualSize')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('view.compareGroup') || 'Compare'}>
          <RibbonButton id="ribbon-compare"
            title={t('compare.title') || 'Compare PDFs'}
            icon={compareIcon}
            label={t('compare.title') || 'Compare'}
            disabled={(state.documents?.length || 0) < 2}
            active={compareActive()}
            onClick={() => runCommand('document.compare')} />
        </RibbonGroup>

        <RibbonGroup label={t('view.pageDisplay')}>
          <RibbonButton id="single-page" title={t('view.singlePage')} icon={singlePageIcon} label={t('view.single')}
            disabled={noPdf()} active={(state.documents[state.activeDocumentIndex]?.viewMode || 'single') === 'single'}
            onClick={() => runCommand('view.singlePage')} />
          <RibbonButton id="continuous" title={t('view.continuousTitle')} icon={continuousIcon} label={t('view.continuous')}
            active={(state.documents[state.activeDocumentIndex]?.viewMode || 'single') === 'continuous'
              && !state.documents[state.activeDocumentIndex]?.bookSpread
              && !state.documents[state.activeDocumentIndex]?.facingSpread}
            disabled={noPdf()} onClick={() => runCommand('view.continuous')} />
          {/* Boekweergave bouwt op het doorlopende pad (grid-layout via
              bookSpread); nu dat pad weer werkt, is ook deze knop actief. */}
          <RibbonButton id="book-view" title={t('view.bookTitle')} icon={bookViewIcon} label={t('view.book')}
            active={(state.documents[state.activeDocumentIndex]?.viewMode === 'continuous')
              && !!state.documents[state.activeDocumentIndex]?.bookSpread
              && !state.documents[state.activeDocumentIndex]?.facingSpread}
            disabled={noPdf()} onClick={() => runCommand('view.continuousSideBySide')} />
          {/* Facing (issue #164): twee pagina's naast elkaar als één spread
              tegelijk, niet-doorlopend — bladert per spread. Intern ook
              continuous, maar met facingSpread i.p.v. bookSpread. */}
          <RibbonButton id="facing-view" title={t('view.facingTitle')} icon={facingPagesIcon} label={t('view.facing')}
            active={(state.documents[state.activeDocumentIndex]?.viewMode === 'continuous')
              && !!state.documents[state.activeDocumentIndex]?.facingSpread}
            disabled={noPdf()} onClick={() => runCommand('view.sideBySide')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="view-rotate-left" title={t('view.rotateViewLeftTitle')} icon={rotateLeftIcon} label={t('view.rotateViewLeft')}
              disabled={noPdf()} onClick={() => runCommand('view.rotateLeft')} />
            <RibbonButton size="small" id="view-rotate-right" title={t('view.rotateViewRightTitle')} icon={rotateRightIcon} label={t('view.rotateViewRight')}
              disabled={noPdf()} onClick={() => runCommand('view.rotateRight')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('view.display') || 'Display'}>
          <RibbonButton id="thin-lines-toggle"
            title={t('view.thinLines') || 'Thin Lines'}
            icon={thinLinesIcon}
            label={t('view.thinLines') || 'Thin Lines'}
            disabled={noPdf()}
            active={state.preferences?.thinLines}
            onClick={() => runCommand('view.thinLines')} />
          <RibbonButton id="reader-mode-toggle"
            title={t('view.readerModeTip') || 'Remember this PDF\'s page, scroll position and zoom across closing and reopening it. While switched on, a small file is kept next to this PDF, so it also appears in cloud-synced folders (OneDrive, Dropbox, etc.); switching it off removes that file.'}
            icon={readerModeIcon}
            label={t('view.readerMode') || 'Reader Mode'}
            disabled={noPdf() || !readerTrackingPath(getActiveDocument()) || !!getActiveDocument()?._isLoading}
            active={!!getActiveDocument()?.readerModeActive}
            onClick={() => runCommand('view.readerMode')} />
        </RibbonGroup>

        <RibbonGroup label={t('view.panels')}>
          <RibbonButton id="ribbon-nav-panel" title={t('view.navigationPanel')} icon={navigationIcon} label={t('view.navigation')}
            disabled={noPdf()} active={panelOn('window.leftPanel')} onClick={() => runCommand('window.leftPanel')} />
          <RibbonButton id="ribbon-properties-panel" title={t('view.propertiesPanel')} icon={propertiesIcon} label={t('view.propertiesLabel')}
            disabled={noPdf()}
            active={panelOn('window.panel.properties')}
            onClick={() => runCommand('window.panel.properties')} />
          <RibbonButton id="ribbon-annotations-list" title={t('view.annotationsList')} icon={annotationsListIcon} label={t('view.annotationsLabel')}
            disabled={noPdf()} active={panelOn('window.panel.markupsList')} onClick={() => runCommand('window.panel.markupsList')} />
          <RibbonButton id="ribbon-element-visibility" title={t('elementVisibility.buttonTitle')} icon={elementVisibilityIcon} label={t('elementVisibility.buttonLabel')}
            disabled={noPdf()} active={panelOn('window.panel.elementVisibility')} onClick={() => runCommand('window.panel.elementVisibility')} />
          <RibbonButton id="ribbon-annotation-layers" title={t('annotationLayers.buttonTitle')} icon={annotationLayersIcon} label={t('annotationLayers.buttonLabel')}
            disabled={noPdf()} active={panelOn('window.panel.annotationLayers')} onClick={() => runCommand('window.panel.annotationLayers', { reveal: true })} />
          {/* The symbol library IS the tool palette for the user — single
              button, named accordingly. The old generic Tool Palette button
              and the plugin extension-palette buttons were removed from this
              tab on request (the palettes themselves still exist and can be
              re-exposed later if needed). */}
          <RibbonButton id="ribbon-symbol-palette" title="Toolpalette" icon={toolPaletteIcon} label="Toolpalette"
            active={panelOn('window.panel.toolChest')} onClick={() => runCommand('window.panel.toolChest')} />
        </RibbonGroup>

        <RibbonGroup label={t('view.appearance')}>
          <ThemePicker />
        </RibbonGroup>

        <RibbonGroup label={t('view.window') || 'Window'}>
          <RibbonButton id="ribbon-fullscreen"
            title={(t('view.fullscreen') || 'Fullscreen') + ' (Ctrl+L / F11)'}
            icon={isFullscreen() ? fullscreenExitIcon : fullscreenIcon}
            label={t('view.fullscreen') || 'Fullscreen'}
            active={isFullscreen()}
            onClick={() => runCommand('window.fullScreen')} />
          <RibbonButton id="ribbon-keystroke-overlay"
            title={t('view.keystrokesHint')}
            icon={keystrokesIcon}
            label={t('view.keystrokes')}
            active={keystrokeOverlayVisible()}
            onClick={() => runCommand('view.keystrokes')} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
