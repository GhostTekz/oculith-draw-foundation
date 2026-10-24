// File menu commands (the external editor File menu, spec §1.9). The seed commands
// file.open, file.save, file.saveAs and file.print live in registry.js.

import { registerCommand } from './registry.js';
import { state } from '../../core/state.js';
import { lucide } from '../data/lucideIcons.js';
import { newDocIcon, ifcExportIcon, cadExportIcon, emailIcon, rasterPdfIcon } from '../data/ribbonIcons.js';
import { hasPdf, activeDoc, pageCount } from './util.js';
import { edition } from '../../editions/active.js';

const C = 'file';

/** Open the File backstage (AppMenu) on one of its panels. */
async function openBackstage(panel) {
  const m = await import('../stores/appMenuStore.js');
  m.openAppMenu();
  m.setActivePanel(panel);
}

registerCommand({
  id: 'file.new', label: 'common:commands.newPdf', icon: newDocIcon, shortcut: 'Ctrl+N', category: C,
  keywords: ['blank', 'frame', 'create'],
  run: () => import('../stores/dialogStore.js').then((m) => m.openDialog('new-doc')),
});
registerCommand({
  id: 'file.openRecent', label: 'common:commands.openRecent', icon: lucide('history'), category: C,
  keywords: ['recent', 'files'],
  run: () => openBackstage('open'),
});
registerCommand({
  id: 'file.close', label: 'common:commands.close', icon: lucide('file-x'), shortcut: 'Ctrl+W', category: C,
  enabled: () => state.documents.length > 0,
  run: () => import('../../ui/chrome/tabs.js').then((m) => m.closeActiveTab()),
});
registerCommand({
  id: 'file.closeAll', label: 'common:commands.closeAll', icon: null, category: C,
  enabled: () => state.documents.length > 0,
  run: async () => {
    const { closeActiveTab } = await import('../../ui/chrome/tabs.js');
    while (state.documents.length > 0) {
      if (!(await closeActiveTab())) return;
    }
  },
});
registerCommand({
  id: 'file.import', label: 'common:commands.import', icon: lucide('download'), category: C,
  keywords: ['fdf', 'xfdf', 'markups'],
  run: () => openBackstage('import'),
});
registerCommand({
  id: 'file.export', label: 'common:commands.export', icon: lucide('file-output'), category: C,
  keywords: ['image', 'png', 'markups', 'summary'],
  run: () => openBackstage('export'),
});
registerCommand({
  // Export the whole document as a rasterised PDF (each page flattened to an
  // image): renders the same in every viewer and printer.
  id: 'file.exportRaster', label: 'common:commands.exportRaster', icon: rasterPdfIcon, category: C,
  enabled: hasPdf, keywords: ['flatten', 'image', 'raster'],
  run: async () => {
    const doc = activeDoc();
    const total = pageCount();
    if (!total) return;
    const pages = [];
    for (let i = 1; i <= total; i++) pages.push(i);
    const m = await import('../../pdf/exporter.js');
    await m.exportAsRasterPdf({ dpi: 300, pages, doc });
  },
});
registerCommand({
  id: 'file.exportCad', label: 'common:commands.exportCad', icon: cadExportIcon, category: C,
  enabled: hasPdf, keywords: ['dxf', 'dwg', 'cad'],
  run: () => import('../stores/dialogStore.js').then((m) => m.openDialog('cad-export')),
});
registerCommand({
  id: 'file.exportIfcReport', label: 'common:commands.exportIfcReport', icon: ifcExportIcon, category: C,
  enabled: hasPdf, keywords: ['ifc', 'bim', 'report'],
  run: () => import('../../pdf/ifc-export.js').then((m) => m.exportIfcReport()),
});
registerCommand({
  id: 'file.email', label: 'common:commands.email', icon: emailIcon, category: C,
  enabled: hasPdf, keywords: ['mail', 'send', 'attachment'],
  run: () => import('../../pdf/email-pdf.js').then((m) => m.emailCurrentPdf()),
});
registerCommand({
  id: 'file.annotateScreenshot', label: 'common:commands.annotateScreenshot', icon: lucide('camera'), category: C,
  keywords: ['clipboard', 'image', 'screenshot'],
  run: () => import('../../tools/screenshot-annotate.js').then((m) => m.annotateClipboardScreenshot()),
});
