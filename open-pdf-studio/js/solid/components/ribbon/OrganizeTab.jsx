import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { insertPageIcon, deletePageIcon, extractPagesIcon, mergePdfsIcon, watermarkIcon, headerFooterIcon, manageWatermarksIcon, editTextIcon, addTextIcon, ocrIcon, cropMarginsIcon, straightenIcon, shiftPageIcon, resizePagesIcon, rotateLeftIcon, rotateRightIcon,
  reorderIcon, compressIcon, compareIcon } from '../../data/ribbonIcons.js';
import { state, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { compareActive } from '../../../compare/compare-store.js';
import { runCommand } from '../../commands/registry.js';

export default function OrganizeTab() {
  const { t } = useTranslation('ribbon');
  const ro = () => noPdf() || isPdfAReadOnly();

  return (
    <div class="ribbon-content active" id="tab-organize">
      <AdaptiveGroups>
        {/* Edit group — moved here from the Home tab */}
        <RibbonGroup label={t('home.edit')}>
          <RibbonButton id="ep-edit-text" title={t('home.editText')} icon={editTextIcon} label={t('home.editText')}
            disabled={ro()} active={state.currentTool === 'editText'} onClick={() => runCommand('edit.editText')} />
          <RibbonButton id="ep-add-text" title={t('home.addText')} icon={addTextIcon} label={t('home.addText')}
            disabled={ro()} onClick={() => runCommand('edit.addText')} />
          <RibbonButton id="ep-ocr" title={t('organize.ocr')} icon={ocrIcon} label={t('organize.ocr')}
            disabled={ro()} onClick={() => runCommand('document.ocr')} />
          <RibbonButton id="ep-crop-margins" title={t('home.cropMargins')} icon={cropMarginsIcon} label={t('home.crop')}
            disabled={ro()} onClick={() => runCommand('document.crop')} />
          <RibbonButton id="ep-straighten" title={t('organize.straighten')} icon={straightenIcon} label={t('organize.straighten')}
            disabled={ro()} onClick={() => runCommand('document.straighten')} />
          <RibbonButton id="ep-shift-page" title={t('organize.shiftPage')} icon={shiftPageIcon} label={t('organize.shiftPage')}
            disabled={ro()} onClick={() => runCommand('document.shiftPage')} />
          <RibbonButton id="ep-resize-pages" title={t('home.resizePages')} icon={resizePagesIcon} label={t('home.resize')}
            disabled={ro()} onClick={() => runCommand('document.pageSetup')} />
          <RibbonButton id="ep-compress-pdf" title={t('organize.compressPdf')} icon={compressIcon} label={t('organize.compressLabel')}
            disabled={noPdf()} onClick={() => runCommand('document.reduceFileSize')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="rotate-left" title={t('home.rotateLeft')} icon={rotateLeftIcon} label={t('home.rotateLeft')}
              disabled={ro()} onClick={() => runCommand('document.rotatePagesLeft')} />
            <RibbonButton size="small" id="rotate-right" title={t('home.rotateRight')} icon={rotateRightIcon} label={t('home.rotateRight')}
              disabled={ro()} onClick={() => runCommand('document.rotatePagesRight')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('organize.pages')}>
          <RibbonButton id="insert-page" title={t('organize.insertPage')} icon={insertPageIcon} label={t('organize.insert')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => runCommand('document.insertPages')} />
          <RibbonButton id="delete-page" title={t('organize.deletePage')} icon={deletePageIcon} label={t('organize.deleteLabel')}
            disabled={noPdf() || isPdfAReadOnly()}
            onClick={() => runCommand('document.deletePages')} />
          <RibbonButton id="extract-pages" title={t('organize.extractPages')} icon={extractPagesIcon} label={t('organize.extractLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => runCommand('document.extractPages')} />
          <RibbonButton id="reorder-pages"
            title={t('organize.reorderPagesTitle') || 'Open thumbnails to drag pages into a new order'}
            icon={reorderIcon}
            label={t('organize.reorderPages') || 'Volgorde'}
            disabled={noPdf()} onClick={() => runCommand('document.reorderPages')} />
        </RibbonGroup>

        <RibbonGroup label={t('organize.combine')}>
          <RibbonButton id="merge-pdfs" title={t('organize.mergePdfs')} icon={mergePdfsIcon} label={t('organize.mergeLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => runCommand('batch.combine')} />
          {/* Zelfde knop als op het Beeld-tabblad (ribbon-compare); hier met
              een eigen id zodat beide instanties onafhankelijk in de
              knoppen-rooktest meetellen. */}
          <RibbonButton id="organize-compare"
            title={t('compare.title') || 'Compare PDFs'}
            icon={compareIcon}
            label={t('compare.title') || 'Compare'}
            disabled={(state.documents?.length || 0) < 2}
            active={compareActive()}
            onClick={() => runCommand('document.compare')} />
        </RibbonGroup>

        <RibbonGroup label={t('organize.watermark')}>
          <RibbonButton id="add-watermark" title={t('organize.addWatermark')} icon={watermarkIcon} label={t('organize.watermarkLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => runCommand('document.addWatermark')} />
          <RibbonButton id="add-header-footer" title={t('organize.addHeaderFooter')} icon={headerFooterIcon} label={t('organize.headerFooter')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => runCommand('document.headerFooter')} />
          <RibbonButton id="manage-watermarks" title={t('organize.manageWatermarks')} icon={manageWatermarksIcon} label={t('organize.manage')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => runCommand('document.manageWatermarks')} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
