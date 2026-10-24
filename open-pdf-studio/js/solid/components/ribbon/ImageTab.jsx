import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import {
  cropModeActive, grayscale, brightness, setBrightness, contrast, setContrast
} from '../../stores/imageEditStore.js';
import {
  cropIcon, grayscaleIcon, brightnessIcon, contrastIcon, resetAdjustIcon,
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { runCommand } from '../../commands/registry.js';

export default function ImageTab() {
  const { t } = useTranslation('ribbon');
  const disabled = () => isPdfAReadOnly();

  return (
    <div class="ribbon-content active" id="tab-image">
      <AdaptiveGroups>
        {/* Croppen */}
        <RibbonGroup label={t('image.cropGroup')}>
          <button
            class={`ribbon-btn${cropModeActive() ? ' active' : ''}`}
            id="img-crop"
            title={t('image.cropHint')}
            disabled={disabled()}
            onClick={() => runCommand('format.imageCrop')}
          >
            <div class="ribbon-btn-icon" ref={el => { el.innerHTML = cropIcon; }}></div>
            <span class="ribbon-btn-label">{t('image.crop')}</span>
          </button>
        </RibbonGroup>

        {/* Beeldbewerking */}
        <RibbonGroup label={t('image.adjustGroup')}>
          <div class="ribbon-grid-col">
            <button
              class={`ribbon-row-btn${grayscale() ? ' active' : ''}`}
              id="img-grayscale"
              title={t('image.grayscaleHint')}
              disabled={disabled()}
              onClick={() => runCommand('format.imageGrayscale')}
            >
              <span ref={el => { el.innerHTML = grayscaleIcon; }} />
              <span>{t('image.grayscale')}</span>
            </button>
            <button
              class="ribbon-row-btn"
              id="img-reset-adjust"
              title={t('image.resetAdjustHint')}
              disabled={disabled()}
              onClick={() => runCommand('format.imageReset')}
            >
              <span ref={el => { el.innerHTML = resetAdjustIcon; }} />
              <span>{t('image.resetAdjust')}</span>
            </button>
          </div>

          <div class="ribbon-slider-grid">
            <div class="ribbon-slider-row">
              <span class="ribbon-slider-icon" ref={el => { el.innerHTML = brightnessIcon; }} />
              <label>{t('image.brightness')}</label>
              <input
                type="range" class="ribbon-slider" id="img-brightness"
                min="0" max="200" step="1"
                value={brightness()}
                disabled={disabled()}
                onInput={(e) => setBrightness(parseInt(e.currentTarget.value, 10))}
              />
              <span class="ribbon-slider-value">{brightness()}%</span>
            </div>
            <div class="ribbon-slider-row">
              <span class="ribbon-slider-icon" ref={el => { el.innerHTML = contrastIcon; }} />
              <label>{t('image.contrast')}</label>
              <input
                type="range" class="ribbon-slider" id="img-contrast"
                min="0" max="200" step="1"
                value={contrast()}
                disabled={disabled()}
                onInput={(e) => setContrast(parseInt(e.currentTarget.value, 10))}
              />
              <span class="ribbon-slider-value">{contrast()}%</span>
            </div>
          </div>
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
