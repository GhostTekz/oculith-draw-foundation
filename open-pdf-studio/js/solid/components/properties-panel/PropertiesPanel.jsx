import { Show, onMount } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext, nativePanelHidden, hydrateCollapsedSections, getCurrentAnnotation, panelMode } from '../../stores/propertiesStore.js';
import { setAsDefaultStyle } from '../../../core/preferences.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';
import { openDialog } from '../../stores/dialogStore.js';
import { startScaleMeasureFlow } from '../../../tools/tools/scale-measure-tool.js';
import { pixelsPerUnitFor } from '../../../annotations/scale-region.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import DocInfoView from './DocInfoView.jsx';
import DimensionTypeSection from './DimensionTypeSection.jsx';
import GeneralSection from './GeneralSection.jsx';
import RepliesSection from './RepliesSection.jsx';
import CaptureSection from './CaptureSection.jsx';
import AppearanceSection from './AppearanceSection.jsx';
import HatchPatternSection from './HatchPatternSection.jsx';
import LineEndingsSection from './LineEndingsSection.jsx';
import DimensionsSection from './DimensionsSection.jsx';
import MeasurementSection from './MeasurementSection.jsx';
import TextFormatSection from './TextFormatSection.jsx';
import ParagraphSection from './ParagraphSection.jsx';
import ContentSection from './ContentSection.jsx';
import ImageSection from './ImageSection.jsx';
import ActionsSection from './ActionsSection.jsx';
import CustomFieldsSection from './CustomFieldsSection.jsx';
import CustomPluginPanel from './CustomPluginPanel.jsx';
import CollapsibleSection from './CollapsibleSection.jsx';
import ParametricSymbolSection from './ParametricSymbolSection.jsx';
import GevelelementSection from './GevelelementSection.jsx';
import StavenreeksSection from './StavenreeksSection.jsx';
import WallSection from './WallSection.jsx';
import BetonbalkSection from './BetonbalkSection.jsx';
import SysteemrasterSection from './SysteemrasterSection.jsx';

// "Meet op tekening" for an EXISTING scale region: temporary 2-click
// distance pick → small "real length" dialog → the region's scale is
// updated in place (see MeasuredLengthDialog, target kind 'annotation').
function measureScaleOnDrawing() {
  const ann = getCurrentAnnotation();
  if (!ann || ann.type !== 'scaleRegion') return;
  const annotationId = ann.id;
  const defaultUnit = ann.units || 'mm';
  startScaleMeasureFlow({
    onDone: (pixelDistance) => {
      openDialog('measured-length', {
        pixelDistance,
        target: { kind: 'annotation', annotationId, defaultUnit },
      });
    },
    onCancel: () => {},
  });
}

// Host-agnostic: the panel hosts (left / right / bottom) give it its header,
// size and collapse; this renders only the properties body. A plugin can
// still take the native panel over (nativePanelHidden).
export default function PropertiesPanel() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  // Restore remembered section-collapse state once (preferences are loaded by now).
  onMount(hydrateCollapsedSections);

  return (
    <Show when={!nativePanelHidden()}>
          <div class="properties-panel visible" id="properties-panel"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}>
            <DocInfoView />
            {/* Dimension type selector pinned at the very top for maatlijnen */}
            <DimensionTypeSection />
            {/* Label size stays with the selection, above General and Appearance. */}
            <MeasurementSection />
            <GeneralSection />
            <RepliesSection />
            <CaptureSection />
            <AppearanceSection />
            <HatchPatternSection />
            <LineEndingsSection />
            <DimensionsSection />
            <Show when={annotProps.annotationType === 'viewport'}>
              <CollapsibleSection title="Viewport" name="viewport" id="prop-viewport-section">
                <div class="property-group">
                  <label>Name</label>
                  <input type="text"
                    value={annotProps.viewportName || ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('viewportName', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>Scale</label>
                  <select
                    value={annotProps.viewportScaleRatio ? annotProps.viewportScaleRatio.replace('1:', '') : ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('viewportScaleRatio', e.target.value)}
                  >
                    <option value="" disabled>{annotProps.viewportCalibrated ? 'Custom scale' : 'Scale not set'}</option>
                    {[10,20,25,50,75,100,125,150,200,250,300,400,500,750,1000,1250,2000,2500,5000].map(r =>
                      <option value={r}>1:{r}</option>
                    )}
                  </select>
                </div>
                <div class="property-group">
                  <label>Unit</label>
                  <select
                    value={annotProps.viewportUnit || ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed' || !annotProps.viewportCalibrated}
                    onChange={(e) => updateAnnotProp('viewportUnit', e.target.value)}
                  >
                    <option value="" disabled>Unit not set</option>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="in">in</option>
                    <option value="ft">ft</option>
                  </select>
                </div>
              </CollapsibleSection>
            </Show>
            <Show when={annotProps.annotationType === 'scaleRegion'}>
              <CollapsibleSection title={t('scaleRegion.title') || 'Scale Region'} name="scaleRegion" id="prop-scaleregion-section">
                <div class="property-group">
                  <label>{t('scaleRegion.label') || 'Label'}</label>
                  <input type="text"
                    value={annotProps.scaleRegionLabel || ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleRegionLabel', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>{t('scaleRegion.scale') || 'Scale'}</label>
                  <select
                    value={annotProps.scaleRegionScale || ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleRegionScale', e.target.value)}
                  >
                    {(() => {
                      // Standard drawing scales; prepend the region's current
                      // value when it's a custom one so the select never
                      // shows blank.
                      const presets = ['1:200','1:100','1:50','1:20','1:10','1:5','1:2','1:1'];
                      const cur = annotProps.scaleRegionScale || '';
                      const list = cur && !presets.includes(cur) ? [cur, ...presets] : presets;
                      return <><option value="">Scale not set</option>{list.map(s => <option value={s}>{s}</option>)}</>;
                    })()}
                  </select>
                </div>
                <div class="property-group">
                  <button class="pref-btn" style="width:100%"
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onClick={measureScaleOnDrawing}>
                    {t('scaleRegion.measure') || 'Meet op tekening'}
                  </button>
                </div>
                <div class="property-group">
                  <label>{t('scaleRegion.unit') || 'Unit'}</label>
                  <select
                    value={annotProps.scaleRegionUnits || ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleRegionUnits', e.target.value)}
                  >
                    <option value="">Unit not set</option>
                    <Show when={annotProps.scaleRegionUnits && !['mm', 'cm', 'm', 'in', 'ft'].includes(annotProps.scaleRegionUnits)}>
                      <option value={annotProps.scaleRegionUnits}>{annotProps.scaleRegionUnits} (unsupported)</option>
                    </Show>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="in">in</option>
                    <option value="ft">ft</option>
                  </select>
                </div>
                {/* Real-world size of the region itself, in its own scale +
                    units — editable, resizes the region (top-left anchored). */}
                <div class="property-group">
                  <label>Breedte ({annotProps.scaleRegionUnits || 'unit not set'})</label>
                  <input type="number" step="1" min="1"
                    value={annotProps.scaleRegionWidth ?? ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed' ||
                      !pixelsPerUnitFor(annotProps.scaleRegionScale, annotProps.scaleRegionUnits)}
                    onChange={(e) => updateAnnotProp('scaleRegionWidth', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>Hoogte ({annotProps.scaleRegionUnits || 'unit not set'})</label>
                  <input type="number" step="1" min="1"
                    value={annotProps.scaleRegionHeight ?? ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed' ||
                      !pixelsPerUnitFor(annotProps.scaleRegionScale, annotProps.scaleRegionUnits)}
                    onChange={(e) => updateAnnotProp('scaleRegionHeight', e.target.value)}
                  />
                </div>
              </CollapsibleSection>
            </Show>
            <Show when={sectionVis.scaleBar}>
              <CollapsibleSection title={t('scaleBar.title')} name="scaleBar" id="prop-scalebar-section">
                <Show when={!annotProps.scaleBarCalibrated}>
                  <p class="property-hint" role="status">Scale not set</p>
                </Show>
                <div class="property-group">
                  <label>{t('scaleBar.unit')}</label>
                  <select value={annotProps.scaleBarUnit}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onDblClick={cycleSelectNext}
                    onChange={(e) => updateAnnotProp('scaleBarUnit', e.target.value)}>
                    <option value="" disabled>Unit not set</option>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="in">in</option>
                    <option value="ft">ft</option>
                  </select>
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.totalLength')}</label>
                  <input type="number" step="1" min="1"
                    value={annotProps.scaleBarTotalUnits}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed' || !annotProps.scaleBarUnit}
                    onChange={(e) => updateAnnotProp('scaleBarTotalUnits', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.divisions')}</label>
                  <input type="number" step="1" min="1" max="20"
                    value={annotProps.scaleBarDivisions}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleBarDivisions', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.barHeight')}</label>
                  <input type="number" step="1" min="4" max="100"
                    value={annotProps.scaleBarHeight}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleBarHeight', e.target.value)}
                  />
                </div>
              </CollapsibleSection>
            </Show>
            <ParametricSymbolSection />
            <GevelelementSection />
            <StavenreeksSection />
            <WallSection />
            <BetonbalkSection />
            <SysteemrasterSection />
            <TextFormatSection />
            <ParagraphSection />
            <ContentSection />
            <ImageSection />
            <CustomFieldsSection />
            <CustomPluginPanel />
            <ActionsSection />
            {/* the external editor: "Set as Default" at the bottom of the Properties panel
                makes this markup's appearance the default for its type. */}
            <Show when={panelMode() === 'annotation' && annotProps.annotationType}>
              <div class="pp-set-default">
                <button type="button" id="pp-set-default" class="pp-set-default-btn"
                  title={tCommon('toolSetSharing.setAsDefaultTitle')}
                  onClick={() => {
                    const ann = getCurrentAnnotation();
                    if (!ann || ann.id === '__tool-defaults__') return;
                    setAsDefaultStyle(ann);
                    try { updateStatusMessage(tCommon('toolSetSharing.setAsDefaultDone')); } catch { /* optional */ }
                  }}>{tCommon('toolSetSharing.setAsDefault')}</button>
              </div>
            </Show>
          </div>
    </Show>
  );
}
