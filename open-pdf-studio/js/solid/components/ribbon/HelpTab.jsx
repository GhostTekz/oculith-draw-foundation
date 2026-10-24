import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import { aboutIcon, shortcutsIcon, updatesIcon, fileAssocIcon, extensionsIcon } from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { runCommand } from '../../commands/registry.js';

export default function HelpTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-help">
      <AdaptiveGroups>
        <RibbonGroup label={t('help.settings')}>
          <RibbonButton
            id="ribbon-extensions"
            title={t('help.extensionsTitle')}
            icon={extensionsIcon}
            label={t('help.extensions')}
            onClick={() => runCommand('help.extensions')}
          />
          <RibbonButton
            id="ribbon-file-assoc"
            title={t('help.setDefaultPdf')}
            icon={fileAssocIcon}
            label={t('help.fileAssociations')}
            onClick={() => runCommand('help.fileAssociations')}
          />
        </RibbonGroup>

        <RibbonGroup label={t('help.help')}>
          <RibbonButton
            id="ribbon-shortcuts"
            title={t('help.keyboardShortcutsTitle')}
            icon={shortcutsIcon}
            label={t('help.shortcuts')}
            onClick={() => runCommand('oculith.keyboardShortcuts')}
          />
          <RibbonButton
            id="ribbon-about"
            title={t('help.aboutTitle')}
            icon={aboutIcon}
            label={t('help.about')}
            onClick={() => runCommand('oculith.about')}
          />
          <RibbonButton
            id="ribbon-startup-diagnostics"
            title={t('help.startupDiagnosticsTitle')}
            icon={updatesIcon}
            label={t('help.startupDiagnostics')}
            onClick={() => runCommand('help.startupDiagnostics')}
          />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
