import { createSignal } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { colorPickerValue, setColorPickerValue, lineWidthValue, setLineWidthValue } from '../../stores/ribbonStore.js';
import { state, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { recordAdd } from '../../../core/undo-manager.js';
import {
  highlightIcon, freehandIcon, lineIcon, arrowIcon, polylineIcon,
  rectIcon, ellipseIcon, polygonIcon, cloudIcon, cloudPolylineIcon,
  textAnnotIcon, textboxIcon, noteIcon, calloutIcon,
  stampIcon, signatureIcon,
  redactionIcon, applyRedactionsIcon,
  clearPageIcon, clearAllIcon,
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon, measureAngleIcon, calibrateIcon,
  scheduleIcon
} from '../../data/ribbonIcons.js';

import { useTranslation } from '../../../i18n/useTranslation.js';
import { savePreferences } from '../../../core/preferences.js';
import { scheduleVisible } from '../../stores/scheduleStore.js';
import { isDynamicScalingEnabled, setDynamicScalingEnabled } from '../../../annotations/dynamic-scaling.js';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { runCommand } from '../../commands/registry.js';

// The comment groups are exported as a standalone fragment so the merged
// "Tekenen & annotatie" tab (AnnotateTab) can compose them alongside the
// drawing groups inside a single AdaptiveGroups container.
export function CommentGroups() {
  const { t } = useTranslation('ribbon');

  return (
    <>
        {/* Drawing tools (line/arrow/polyline/arc/spline/rect/ellipse/polygon/cloud/cloudPolyline/filledArea/freehand)
            were moved to the dedicated Drawing tab. Comment tab keeps only
            comment-style annotations (highlight, callout, note, stamp, etc.). */}
        <RibbonGroup label={t('comment.drawing')}>
          <RibbonButton id="tool-highlight" title={t('comment.highlight')} icon={highlightIcon} label={t('comment.highlight')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'highlight'} onClick={() => runCommand('tools.markup.highlight')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.text')}>
          <RibbonButton id="tool-textbox" title={t('comment.textBox')} icon={textboxIcon} label={t('comment.textBox')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'textbox'} onClick={() => runCommand('tools.markup.textBox')} />
          <RibbonButton id="tool-callout" title={t('comment.callout')} icon={calloutIcon} label={t('comment.callout')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'callout'} onClick={() => runCommand('tools.markup.callout')} />
          <RibbonButton id="tool-comment" title={t('comment.note')} icon={noteIcon} label={t('comment.note')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'comment'} onClick={() => runCommand('tools.markup.note')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.stamp')}>
          <RibbonButton id="tool-stamp" title={t('comment.stamp')} icon={stampIcon} label={t('comment.stamp')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'stamp'} onClick={() => runCommand('tools.stamp')} />
          <RibbonButton id="tool-signature" title={t('comment.signature')} icon={signatureIcon} label={t('comment.signature')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'signature'} onClick={() => runCommand('tools.signature.place')} />
          <RibbonButton id="tool-parametric-symbol" title={t('comment.parametricSymbol')}
            icon={stampIcon} label={t('comment.parametricSymbol')}
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'parametricSymbol'}
            onClick={() => runCommand('tools.parametricSymbol')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.redaction')}>
          <RibbonButton id="tool-redaction" title={t('comment.markForRedaction')} icon={redactionIcon} label={t('comment.redact')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'redaction'} onClick={() => runCommand('edit.redact')} />
          <RibbonButton id="btn-apply-redactions" title={t('comment.applyRedactions')} icon={applyRedactionsIcon} label={t('comment.applyLabel')}
            disabled={noPdf() || isPdfAReadOnly()} iconStyle={{ color: '#dc2626' }}
            onClick={() => runCommand('edit.applyRedactions')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.properties')}>
          <RibbonButtonStack>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">{t('comment.color')}</label>
              <input type="color" id="color-picker" class="ribbon-color-input"
                value={colorPickerValue()}
                disabled={noPdf() || isPdfAReadOnly()}
                onInput={(e) => setColorPickerValue(e.target.value)} />
            </div>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">{t('comment.width')}</label>
              <input type="number" id="line-width" class="ribbon-input" min="1" max="20"
                value={lineWidthValue()}
                disabled={noPdf() || isPdfAReadOnly()}
                onInput={(e) => setLineWidthValue(parseInt(e.target.value) || 3)} />
            </div>
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('comment.edit')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-clear" title={t('comment.clearPageAnnotations')} icon={clearPageIcon} label={t('comment.clearPage')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={() => runCommand('edit.clearPage')} />
            <RibbonButton size="small" id="ribbon-clear-all" title={t('comment.clearAllAnnotations')} icon={clearAllIcon} label={t('comment.clearAll')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={() => runCommand('edit.clearAll')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.tools') || 'METEN'}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-distance" title={t('measure.measureDistance') || 'Afstand meten'} icon={measureDistanceIcon} label={t('measure.distance') || 'Afstand'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureDistance'} onClick={() => runCommand('tools.measure.length')} />
            <RibbonButton size="small" id="tool-measure-area" title={t('measure.measureArea') || 'Oppervlakte meten'} icon={measureAreaIcon} label={t('measure.area') || 'Oppervlakte'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureArea'} onClick={() => runCommand('tools.measure.area')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-perimeter" title={t('measure.measurePerimeter') || 'Omtrek meten'} icon={measurePerimeterIcon} label={t('measure.perimeter') || 'Omtrek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measurePerimeter'} onClick={() => runCommand('tools.measure.perimeter')} />
            <RibbonButton size="small" id="tool-measure-angle" title={t('measure.measureAngle') || 'Hoek meten'} icon={measureAngleIcon} label={t('measure.angle') || 'Hoek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureAngle'} onClick={() => runCommand('tools.measure.angle')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Schaal group (Schaalgebied / Schaalgebied op pagina) moved to the
            Tekenen tab — see DrawingTab.jsx. */}

        <RibbonGroup label={t('measure.schedule') || 'HOEVEELHEDEN'}>
          <RibbonButton id="btn-open-schedule"
            title={t('measure.openSchedule') || 'Hoeveelheden'}
            icon={scheduleIcon}
            label={t('measure.takeOff') || 'Hoeveelheden'}
            disabled={noPdf()}
            active={scheduleVisible()}
            onClick={() => runCommand('tools.quantities')} />
        </RibbonGroup>
    </>
  );
}

export default function CommentTab() {
  return (
    <div class="ribbon-content active" id="tab-comment">
      <AdaptiveGroups>
        <CommentGroups />
      </AdaptiveGroups>
    </div>
  );
}
