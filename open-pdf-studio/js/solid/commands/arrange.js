// Arrange and Format commands for the selected markups: the old contextual
// ribbon tabs Arrange, Format and Image (spec §4.2: Edit ▸ Arrange ▸ and the
// markup context menu; the Properties toolbar takes the format fields).
//
// The arrange.* commands are shared by Edit ▸ Arrange ▸, the command palette
// and the markup context menu's Arrange ▸ submenu (layout and selection
// minimums in arrange-menu.js). Order, rotate and flip take an optional array
// of markups (the context menu passes the right-clicked one); without it they
// act on the selection. Align, distribute and size always use the selection
// (alignment.js).

import { registerCommand } from './registry.js';
import {
  alignLeftIcon, alignCenterIcon, alignRightIcon, alignTopIcon, alignMiddleIcon, alignBottomIcon,
  distSpaceHIcon, distSpaceVIcon, distLeftIcon, distTopIcon, distCenterIcon, distMiddleIcon, distRightIcon,
  distBottomIcon, bringForwardIcon, bringToFrontIcon, sendBackwardIcon, sendToBackIcon, sameSize16Icon,
  rotateCcwIcon, rotateCwIcon, rotate180Icon, flipHIcon, flipVIcon, editTypeIcon, resetLocationIcon,
  openPropertiesIcon, hideAnnotationIcon, cropIcon, grayscaleIcon, resetAdjustIcon, styleToolsIcon,
} from '../data/ribbonIcons.js';
import { editable, pdfaReadOnly, hasPdf, selection, hasSelection, activeDoc, lazyModule } from './util.js';
import { arrangeAllowed } from './arrange-menu.js';

const alignment = () => import('../../annotations/alignment.js');
const alignmentNow = lazyModule(alignment);
const imageStore = lazyModule(() => import('../stores/imageEditStore.js'));
const stylePresets = lazyModule(() => import('../stores/stylePresetsStore.js'));
const formatStore = lazyModule(() => import('../stores/formatStore.js'));
// An open, writable PDF and enough selected markups for the command (align and
// size need two, distribute three: arrange-menu.js).
const arrangeEnabled = (id) => () => hasPdf() && !pdfaReadOnly() && arrangeAllowed(id, selection().length);
const targets = (annotations) => (Array.isArray(annotations) ? annotations : [...selection()]).filter(Boolean);

// --- Align, distribute, size ------------------------------------------------------------

for (const [key, icon] of [
  ['alignLeft', alignLeftIcon], ['alignCenter', alignCenterIcon], ['alignRight', alignRightIcon],
  ['alignTop', alignTopIcon], ['alignMiddle', alignMiddleIcon], ['alignBottom', alignBottomIcon],
  ['distributeSpaceH', distSpaceHIcon], ['distributeSpaceV', distSpaceVIcon], ['distributeLeft', distLeftIcon],
  ['distributeCenter', distCenterIcon], ['distributeRight', distRightIcon], ['distributeTop', distTopIcon],
  ['distributeMiddle', distMiddleIcon], ['distributeBottom', distBottomIcon],
  ['sameSize', sameSize16Icon], ['sameWidth', null], ['sameHeight', null],
]) {
  registerCommand({
    id: `arrange.${key}`, label: `common:commands.arrange.${key}`, icon, category: 'arrange',
    enabled: arrangeEnabled(`arrange.${key}`), keywords: ['align', 'distribute', 'arrange', 'match', 'centre'],
    run: () => alignment().then((m) => m[key]()),
  });
}
for (const [target, key] of [['selection', 'alignToSelection'], ['last', 'alignToLast']]) {
  registerCommand({
    id: `arrange.${key}`, label: `common:commands.arrange.${key}`, icon: null, category: 'arrange',
    checked: () => alignmentNow()?.alignTarget() === target, keywords: ['align'],
    run: () => alignment().then((m) => m.setAlignTarget(target)),
  });
}

// --- Rotate, flip, order --------------------------------------------------------------------

// One undo step for a transform applied to each unlocked markup; z-order.js
// redraws after each rotate/flip.
async function transformEach(annotations, apply) {
  const anns = targets(annotations).filter((a) => !a.locked);
  if (!anns.length) return;
  const [z, { cloneAnnotation }, { recordBulkModify }] = await Promise.all([
    import('../../annotations/z-order.js'), import('../../annotations/factory.js'), import('../../core/undo-manager.js'),
  ]);
  const originals = anns.map((a) => cloneAnnotation(a));
  for (const ann of anns) apply(z, ann);
  recordBulkModify(anns, originals);
}
const rotate = (deg) => (anns) => transformEach(anns, (z, a) => z.rotateAnnotation(a, deg));
const flip = (fn) => (anns) => transformEach(anns, (z, a) => z[fn](a));
const order = (fn) => (anns) => import('../../annotations/z-order.js').then((z) => z[fn](targets(anns)));

for (const [key, icon, run] of [
  ['rotateCcw', rotateCcwIcon, rotate(-90)], ['rotateCw', rotateCwIcon, rotate(90)], ['rotate180', rotate180Icon, rotate(180)],
  ['flipHorizontal', flipHIcon, flip('flipHorizontal')], ['flipVertical', flipVIcon, flip('flipVertical')],
  ['bringForward', bringForwardIcon, order('bringForward')], ['bringToFront', bringToFrontIcon, order('bringToFront')],
  ['sendBackward', sendBackwardIcon, order('sendBackward')], ['sendToBack', sendToBackIcon, order('sendToBack')],
]) {
  registerCommand({
    id: `arrange.${key}`, label: `common:commands.arrange.${key}`, icon, category: 'arrange',
    enabled: arrangeEnabled(`arrange.${key}`), keywords: ['rotate', 'flip', 'mirror', 'reflect', 'order', 'z-order'], run,
  });
}

// --- Format (selected markups) ---------------------------------------------------------------

const formatEnabled = () => editable() && hasSelection();
const format = () => import('../stores/formatStore.js');

registerCommand({
  // Apply one of the gallery styles (formatStore STYLE_DEFS), e.g. 'red'.
  id: 'format.applyStyle', label: 'common:commands.format.applyStyle', icon: styleToolsIcon, category: 'format',
  enabled: formatEnabled, keywords: ['colour', 'style', 'cloudy'],
  run: async (styleName) => {
    const { STYLE_DEFS, applyToSelected, syncFormatStore } = await format();
    const style = STYLE_DEFS[styleName];
    if (!style) return;
    applyToSelected((ann) => {
      if (style.strokeColor) { ann.strokeColor = style.strokeColor; ann.color = style.color; }
      ann.fillColor = style.fillColor || null;
      if (style.borderStyle) ann.borderStyle = style.borderStyle;
    });
    syncFormatStore(selection());
  },
});
registerCommand({
  id: 'format.applyStylePreset', label: 'common:commands.format.applyStylePreset', icon: null, category: 'format',
  enabled: () => formatEnabled() && !formatStore()?.isLocked(), keywords: ['style', 'preset'],
  run: (presetId) => import('../stores/stylePresetsStore.js').then((m) => m.applyStylePresetById(presetId)),
});
registerCommand({
  id: 'format.copyStyle', label: 'common:commands.format.copyStyle', icon: null, category: 'format',
  enabled: formatEnabled, keywords: ['style', 'copy'],
  run: () => import('../stores/stylePresetsStore.js').then((m) => m.copyStyleFromSelection()),
});
registerCommand({
  id: 'format.pasteStyle', label: 'common:commands.format.pasteStyle', icon: null, category: 'format',
  enabled: () => formatEnabled() && !!stylePresets()?.copiedStyle() && !formatStore()?.isLocked(),
  keywords: ['style', 'paste'],
  run: () => import('../stores/stylePresetsStore.js').then((m) => m.pasteStyleToSelection()),
});
registerCommand({
  // Back to rotation 0 and the centre of its page (page space, #200).
  id: 'format.resetLocation', label: 'common:commands.format.resetLocation', icon: resetLocationIcon, category: 'format',
  enabled: formatEnabled, keywords: ['centre', 'rotation'],
  run: async () => {
    const [{ applyToSelected }, { paginaMaat }] = await Promise.all([format(), import('../../pdf/weergave-ruimte.js')]);
    applyToSelected((ann) => {
      ann.rotation = 0;
      if (ann.x === undefined) return;
      const canvas = document.getElementById('annotation-canvas');
      if (!canvas) return;
      const doc = activeDoc();
      const scale = doc?.scale || 1.5;
      const dpr = window.devicePixelRatio || 1;
      const maat = paginaMaat(ann.page ?? doc?.currentPage ?? 1, doc);
      const cx = maat ? maat.breedte / 2 : (canvas.width / (scale * dpr)) / 2;
      const cy = maat ? maat.hoogte / 2 : (canvas.height / (scale * dpr)) / 2;
      ann.x = cx - (ann.width || 100) / 2;
      ann.y = cy - (ann.height || 50) / 2;
    });
  },
});
registerCommand({
  id: 'format.openProperties', label: 'common:commands.format.openProperties', icon: openPropertiesIcon, category: 'format',
  enabled: hasSelection, keywords: ['properties', 'panel'],
  run: async () => {
    const [{ setPanelVisible }, panel] = await Promise.all([
      import('../stores/propertiesStore.js'), import('../../ui/panels/properties-panel.js'),
    ]);
    setPanelVisible(true);
    const sel = selection();
    if (sel.length === 1) panel.showProperties(sel[0]);
    else if (sel.length > 1) panel.showMultiSelectionProperties();
  },
});
registerCommand({
  id: 'format.hideMarkup', label: 'common:commands.format.hideMarkup', icon: hideAnnotationIcon, category: 'format',
  enabled: formatEnabled, keywords: ['hide', 'invisible'],
  run: () => format().then((m) => m.applyToSelected((ann) => { ann.hidden = !ann.hidden; })),
});
registerCommand({
  id: 'format.editSymbolType', label: 'common:commands.format.editSymbolType', icon: editTypeIcon, category: 'format',
  enabled: () => !!formatStore()?.isSingleSymbolStamp(), keywords: ['symbol', 'type', 'block'],
  run: () => {
    const sel = selection();
    if (sel.length === 1) return import('../stores/symbolEditStore.js').then((m) => m.openSymbolTypeEditor(sel[0]));
  },
});

// --- Image (selected image markup) --------------------------------------------------------

const imageEnabled = () => hasPdf() && !pdfaReadOnly();
registerCommand({
  id: 'format.imageCrop', label: 'common:commands.format.imageCrop', icon: cropIcon, category: 'format',
  enabled: imageEnabled, checked: () => !!imageStore()?.cropModeActive(), keywords: ['image', 'crop'],
  run: () => import('../stores/imageEditStore.js').then((m) => m.toggleCropMode()),
});
registerCommand({
  id: 'format.imageGrayscale', label: 'common:commands.format.imageGrayscale', icon: grayscaleIcon, category: 'format',
  enabled: imageEnabled, checked: () => !!imageStore()?.grayscale(), keywords: ['image', 'black and white'],
  run: () => import('../stores/imageEditStore.js').then((m) => m.toggleGrayscale()),
});
registerCommand({
  id: 'format.imageReset', label: 'common:commands.format.imageReset', icon: resetAdjustIcon, category: 'format',
  enabled: imageEnabled, keywords: ['image', 'brightness', 'contrast', 'reset'],
  run: () => import('../stores/imageEditStore.js').then((m) => m.resetImageAdjustments()),
});
