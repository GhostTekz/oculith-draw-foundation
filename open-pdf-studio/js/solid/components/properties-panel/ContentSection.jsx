import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { textFieldHandlers, mixedPlaceholder } from './multi-edit.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ContentSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.content}>
      <CollapsibleSection title={t('content.title')} name="content" id="prop-content-section">
        <Show when={sectionVis.textGroup}>
          <div class="property-group">
            <label>{t('content.text')}</label>
            {/* Bij een meervoudige selectie: leeg als de teksten verschillen,
                en wat je typt gaat bij het verlaten naar alle markeringen. */}
            <textarea rows="4" value={annotProps.text} disabled={isLocked()}
              placeholder={mixedPlaceholder('text', tCommon('mixed'), '')}
              {...textFieldHandlers('text')} />
          </div>
        </Show>

        <Show when={sectionVis.fontSizeGroup}>
          <div class="property-group">
            <label>{t('content.fontSize')}</label>
            <input type="number" min="8" max="72"
              value={annotProps.fontSize} disabled={isLocked()}
              onInput={(e) => updateAnnotProp('fontSize', e.target.value)} />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
