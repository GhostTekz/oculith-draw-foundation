import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import { state, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { scheduleVisible } from '../../stores/scheduleStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  calibrateIcon, measureDistanceIcon, measureAreaIcon,
  measurePerimeterIcon, measureAngleIcon, setScaleIcon, detectScalesIcon,
  polylengthIcon, volumeIcon, arcLengthIcon, radius3Icon, addViewportIcon, quantitiesIcon, countIcon
} from '../../data/ribbonIcons.js';
import { runCommand } from '../../commands/registry.js';
import { createSignal } from 'solid-js';
import { setMeasureDisplay } from '../../../annotations/measure-display-setting.js';

const UNIT_OPTIONS = [['auto', 'unitAuto'], ['ft-in', 'unitFtIn'], ['in', 'unitIn'], ['ft', 'unitFt'],
  ['mm', 'unitMm'], ['cm', 'unitCm'], ['m', 'unitM']];

export default function MeasureTab() {
  const { t } = useTranslation('ribbon');
  const { t: tProperties } = useTranslation('properties');
  const { t: tDialogs } = useTranslation('dialogs');
  const unavailable = () => noPdf() || isPdfAReadOnly();
  // Display units: every measurement is shown in this unit (and optionally
  // the other system beside it), whatever unit the page scale uses.
  const [displayUnit, setDisplayUnit] = createSignal(state.preferences.measureDisplayUnit || 'auto');
  const [dualUnits, setDualUnits] = createSignal(!!state.preferences.measureDualUnits);

  return (
    <div class="ribbon-content active" id="tab-measure">
      <AdaptiveGroups>
        <RibbonGroup label={t('measure.scaleGroup')}>
          {/* Calibrate: pick two points of a known length, then enter it in
              the calibration dialog. Set Scale: the same dialog on its
              scale-ratio tab. Both set the page scale. */}
          <RibbonButton id="measure-calibrate" title={t('measure.selectPointsTitle')}
            icon={calibrateIcon} label={t('comment.calibrate')}
            disabled={unavailable()} active={state.currentTool === 'calibrationPick'}
            onClick={() => runCommand('tools.measure.calibrate')} />
          <RibbonButton id="measure-set-scale" title={tDialogs('setScale.title')}
            icon={setScaleIcon} label={tDialogs('setScale.title')}
            disabled={unavailable()} onClick={() => runCommand('tools.measure.setScale')} />
          {/* Detect Scales: read the scale notes of every sheet and review
              them; nothing is applied until confirmed. */}
          <RibbonButton id="measure-detect-scales" title={tDialogs('scaleReview.detectAllTitle')}
            icon={detectScalesIcon} label={tDialogs('scaleReview.ribbon')}
            disabled={unavailable()} onClick={() => runCommand('tools.measure.detectScales')} />
          {/* Add Viewport: drag a rectangle that has its own scale (a named
              viewport). The whole-page case is the page scale above. */}
          <RibbonButton id="measure-add-viewport" title={t('comment.addViewportTitle')}
            icon={addViewportIcon} label={t('comment.addViewport')}
            disabled={unavailable()} active={state.currentTool === 'scaleRegion'}
            onClick={() => runCommand('tools.measure.addViewport')} />
        </RibbonGroup>

        <RibbonGroup label={t('measure.unitsGroup')}>
          <div class="ribbon-form-grid ribbon-form-grid-2col">
            <div class="ribbon-form-row">
              <label for="measure-display-unit">{t('measure.showUnit')}</label>
              <select class="ribbon-form-select" id="measure-display-unit" data-measure-display-unit
                title={t('measure.showUnitTitle')}
                value={displayUnit()}
                onChange={(e) => {
                  setDisplayUnit(e.currentTarget.value);
                  setMeasureDisplay({ unit: e.currentTarget.value });
                }}>
                {UNIT_OPTIONS.map(([value, key]) => <option value={value}>{t(`measure.${key}`)}</option>)}
              </select>
            </div>
            <div class="ribbon-form-row">
              <label class="ribbon-form-check" title={t('measure.dualUnitsTitle')}>
                <input type="checkbox" data-measure-dual-units checked={dualUnits()}
                  onChange={(e) => {
                    setDualUnits(e.currentTarget.checked);
                    setMeasureDisplay({ dual: e.currentTarget.checked });
                  }} />
                {t('measure.dualUnits')}
              </label>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('measure.tools')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="measure-distance" title={t('measure.measureDistance')}
              icon={measureDistanceIcon} label={t('measure.distance')}
              disabled={unavailable()} active={state.currentTool === 'measureDistance'}
              onClick={() => runCommand('tools.measure.length')} />
            <RibbonButton size="small" id="measure-area" title={t('measure.measureArea')}
              icon={measureAreaIcon} label={t('measure.area')}
              disabled={unavailable()} active={state.currentTool === 'measureArea'}
              onClick={() => runCommand('tools.measure.area')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="measure-perimeter" title={t('measure.measurePerimeter')}
              icon={measurePerimeterIcon} label={t('measure.perimeter')}
              disabled={unavailable()} active={state.currentTool === 'measurePerimeter'}
              onClick={() => runCommand('tools.measure.perimeter')} />
            <RibbonButton size="small" id="measure-angle" title={t('measure.measureAngle')}
              icon={measureAngleIcon} label={t('measure.angle')}
              disabled={unavailable()} active={state.currentTool === 'measureAngle'}
              onClick={() => runCommand('tools.measure.angle')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="measure-polylength"
              title={t('measure.measurePolylength', { defaultValue: 'Measure polylength (total and segment lengths)' })}
              icon={polylengthIcon} label={t('measure.polylength', { defaultValue: 'Polylength' })}
              disabled={unavailable()} active={state.currentTool === 'measurePolylength'}
              onClick={() => runCommand('tools.measure.polylength')} />
            <RibbonButton size="small" id="measure-volume"
              title={t('measure.measureVolume', { defaultValue: 'Measure volume (area \u00D7 depth)' })}
              icon={volumeIcon} label={t('measure.volume', { defaultValue: 'Volume' })}
              disabled={unavailable()} active={state.currentTool === 'measureVolume'}
              onClick={() => runCommand('tools.measure.volume')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="measure-arc"
              title={t('measure.measureArc', { defaultValue: 'Measure arc length (start, point on arc, end)' })}
              icon={arcLengthIcon} label={t('measure.arc', { defaultValue: 'Arc' })}
              disabled={unavailable()} active={state.currentTool === 'measureArc'}
              onClick={() => runCommand('tools.measure.arcLength')} />
            <RibbonButton size="small" id="measure-radius3"
              title={t('measure.measureRadius3', { defaultValue: 'Measure radius from three points on a circle' })}
              icon={radius3Icon} label={t('measure.radius3', { defaultValue: '3-point radius' })}
              disabled={unavailable()} active={state.currentTool === 'measureRadius3'}
              onClick={() => runCommand('tools.measure.radius3')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="measure-count" title={tProperties('quantities.type.count')}
              icon={countIcon} label={tProperties('quantities.type.count')}
              disabled={unavailable()} active={state.currentTool === 'count'}
              onClick={() => runCommand('tools.measure.count')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.schedule')}>
          <RibbonButton id="measure-quantities" title={t('measure.openSchedule')}
            icon={quantitiesIcon} label={t('measure.takeOff')}
            disabled={noPdf()} active={scheduleVisible()} onClick={() => runCommand('tools.quantities')} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
