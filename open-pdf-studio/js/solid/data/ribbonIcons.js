// ============================================================
// Ribbon and tool icons
// ============================================================
// Every ribbon, tool palette and command icon is named here. Generic commands
// use the vendored Lucide set (lucideIcons.js, ISC); construction tools with
// no Lucide equivalent use the Oculith drawings in oculithToolIcons.js. Both
// draw on a 24px viewBox with currentColor and a 1.75 stroke, following the
// Oculith desktop design system. Keep the export names stable: ribbon
// tabs, the tool palette and tests import them by name.

import { lucide } from './lucideIcons.js';
import { toolIcon } from './oculithToolIcons.js';

/** The same icon with fixed width/height (and optional class) on its root. */
function sized(svg, size, className) {
  const cls = className ? ` class="${className}"` : '';
  return svg.replace('<svg ', `<svg${cls} width="${size}" height="${size}" `);
}

const caret = (size, className) => sized(lucide('chevron-down'), size, className);

// --- View tab: Fullscreen ---
export const fullscreenIcon = lucide('maximize');
export const fullscreenExitIcon = lucide('minimize');

// --- Home tab: Tools ---
export const handIcon = lucide('hand');
export const selectTextIcon = lucide('mouse-pointer-2');
export const selectToolIcon = lucide('mouse-pointer-click');
export const selectCommentsIcon = lucide('mouse-pointer-2');
export const selectAllIcon = lucide('square-dashed-mouse-pointer');
export const deselectIcon = lucide('square-x');
export const screenshotIcon = lucide('camera');
export const screenshotDropdownArrow = caret(8);
export const screenshotPageMenuIcon = sized(lucide('camera'), 14);
export const screenshotRegionMenuIcon = sized(lucide('scan'), 14);

// --- Home tab: Zoom ---
export const zoomInIcon = lucide('zoom-in');
export const zoomOutIcon = lucide('zoom-out');
export const fitWidthIcon = lucide('arrow-left-right');
export const actualSizeIcon = lucide('scan-search');
export const fitPageIcon = lucide('expand');
export const rotateLeftIcon = lucide('rotate-ccw');
export const rotateRightIcon = lucide('rotate-cw');

// --- Home tab: Edit ---
export const editTextIcon = lucide('square-pen');
export const addTextIcon = lucide('type');
export const ocrIcon = lucide('scan-text');
export const cropMarginsIcon = lucide('crop');
export const resizePagesIcon = lucide('scaling');
export const straightenIcon = toolIcon('straighten');
export const shiftPageIcon = lucide('move');

// --- Home tab: File and export ---
export const newDocIcon = lucide('file-plus');
export const ifcExportIcon = lucide('box');
export const cadExportIcon = lucide('drafting-compass');
export const emailIcon = lucide('mail');
export const rasterPdfIcon = lucide('file-image');

// --- Home tab: Navigate ---
export const firstPageIcon = lucide('chevron-first');
export const prevPageIcon = lucide('chevron-left');
export const nextPageIcon = lucide('chevron-right');
export const lastPageIcon = lucide('chevron-last');
export const findIcon = lucide('search');

// --- Markup tools ---
export const highlightIcon = lucide('highlighter');
export const freehandIcon = lucide('pencil');
export const lineIcon = toolIcon('line');
export const arrowIcon = lucide('arrow-up-right');
export const drawIcon = lucide('pen-tool');
export const eraserIcon = lucide('eraser');
export const polylineIcon = toolIcon('polyline');
export const rectIcon = lucide('square');
export const circleIcon = lucide('circle');
export const ellipseIcon = toolIcon('ellipse');
export const polygonIcon = lucide('pentagon');
export const cloudIcon = toolIcon('cloud');
export const cloudPlusIcon = toolIcon('cloud-plus');
export const cloudPolylineIcon = toolIcon('cloud-polyline');
export const textAnnotIcon = lucide('type');
export const textboxIcon = lucide('text-cursor-input');
export const noteIcon = lucide('sticky-note');
export const calloutIcon = toolIcon('callout');
export const sketchIcon = toolIcon('sketch');
export const stampIcon = lucide('stamp');
export const signatureIcon = lucide('signature');
export const northArrowIcon = toolIcon('north-arrow');
export const arcIcon = toolIcon('arc');
export const splineIcon = lucide('spline');
export const splineArrowIcon = lucide('spline-pointer');
export const hatchIcon = toolIcon('hatch');
export const imageIcon = lucide('image');
export const removeImageIcon = lucide('image-off');
export const tableIcon = lucide('table');
export const labelIcon = lucide('tag');
export const placeholderIcon = lucide('square-dashed');

// --- Measure tools ---
export const measureDistanceIcon = lucide('ruler-dimension-line');
export const measureAreaIcon = toolIcon('area');
export const measurePerimeterIcon = toolIcon('perimeter');
export const dynamicFillIcon = toolIcon('dynamic-fill');
export const conduitIcon = toolIcon('conduit');
export const cableTrayIcon = toolIcon('cable-tray');
export const measureAngleIcon = toolIcon('angle');
export const polylengthIcon = toolIcon('polylength');
export const volumeIcon = toolIcon('volume');
export const arcLengthIcon = toolIcon('arc-length');
export const radius3Icon = toolIcon('radius-3pt');
export const countIcon = toolIcon('count');
export const dimensionIcon = toolIcon('dimension');
export const scaleBarIcon = toolIcon('scale-bar');
export const calibrateIcon = toolIcon('calibrate');
export const setScaleIcon = toolIcon('set-scale');
export const addViewportIcon = toolIcon('viewport');
export const scaleRegionIcon = toolIcon('viewport');
export const quantitiesIcon = toolIcon('takeoff');
export const scheduleIcon = lucide('sheet');
export const snapToDrawingIcon = lucide('magnet');

// --- Drawing (CAD) edit tools ---
export const moveIcon = lucide('move');
export const copyAnnIcon = lucide('copy');
export const arrayIcon = lucide('grid-2x2');
export const trimIcon = toolIcon('trim');
export const extendIcon = lucide('arrow-right-to-line');
export const pasteIcon = lucide('clipboard');
export const pasteInPlaceIcon = lucide('clipboard-paste');
export const cutIcon = lucide('scissors');
export const deleteIcon = lucide('trash-2');
export const knipselIcon = lucide('scissors-line-dashed');
export const knipselPlakIcon = lucide('clipboard-copy');
export const lShapeIcon = toolIcon('l-shape');
export const radiusIcon = toolIcon('radius');
export const diameterIcon = lucide('diameter');
export const explodeIcon = lucide('expand');
export const joinIcon = lucide('merge');
export const splitIcon = lucide('split');
export const breakIcon = lucide('unlink');
export const lengthenIcon = lucide('move-horizontal');
export const collectionCreateIcon = lucide('group');
export const collectionExplodeIcon = lucide('ungroup');

// --- Redaction ---
export const redactionIcon = lucide('square-dashed');
export const applyRedactionsIcon = lucide('shield-check');

// --- Comment tab: Manage ---
export const undoIcon = lucide('undo-2');
export const clearPageIcon = lucide('file-x');
export const clearAllIcon = lucide('trash-2');

// --- View tab ---
export const singlePageIcon = lucide('file');
export const continuousIcon = lucide('gallery-vertical');
export const bookViewIcon = lucide('book-open');
export const facingPagesIcon = lucide('columns-2');
export const splitViewIcon = lucide('columns-2');
export const presentationIcon = lucide('monitor');
export const navigationIcon = lucide('panel-left');
export const propertiesIcon = lucide('panel-right');
export const annotationsListIcon = lucide('list');
export const thinLinesIcon = toolIcon('thin-lines');
export const themeDropdownArrow = caret(10);
export const annotationLayersIcon = lucide('layers');
export const elementVisibilityIcon = lucide('eye');

// --- Organize tab ---
export const insertPageIcon = lucide('file-plus');
export const deletePageIcon = lucide('file-minus');
export const extractPagesIcon = lucide('file-output');
export const mergePdfsIcon = lucide('combine');
export const watermarkIcon = lucide('droplet');
export const headerFooterIcon = lucide('panel-top');
export const manageWatermarksIcon = lucide('droplets');
export const reorderIcon = lucide('arrow-up-down');
export const compressIcon = lucide('file-archive');

// --- Help tab ---
export const aboutIcon = lucide('info');
export const shortcutsIcon = lucide('keyboard');
export const updatesIcon = lucide('refresh-cw');
export const fileAssocIcon = lucide('file-cog');
export const preferencesIcon = lucide('settings');
export const extensionsIcon = lucide('puzzle');

// --- Format tab: Gallery & Arrows ---
export const styleMoreArrow = lucide('chevron-right');
export const colorDropdownArrow = caret(8, 'ribbon-color-dd-arrow');
export const dropdownArrowSmall = caret(8, 'dropdown-arrow');

// --- Format tab: Style Tools & Properties ---
export const styleToolsIcon = lucide('paintbrush');
export const resetLocationIcon = lucide('locate');
export const openPropertiesIcon = lucide('sliders-horizontal');
export const hideAnnotationIcon = lucide('eye-off');

// --- Image tab (contextual) ---
export const cropIcon = lucide('crop');
export const grayscaleIcon = lucide('blend');
export const brightnessIcon = lucide('sun');
export const contrastIcon = lucide('contrast');
export const resetAdjustIcon = lucide('rotate-ccw');
export const editTypeIcon = lucide('square-pen');

// --- Arrange tab: Alignment ---
export const alignLeftIcon = lucide('align-start-vertical');
export const alignCenterIcon = lucide('align-center-vertical');
export const alignRightIcon = lucide('align-end-vertical');
export const alignTopIcon = lucide('align-start-horizontal');
export const alignMiddleIcon = lucide('align-center-horizontal');
export const alignBottomIcon = lucide('align-end-horizontal');

// --- Arrange tab: Distribute ---
export const distSpaceHIcon = lucide('align-horizontal-space-around');
export const distSpaceVIcon = lucide('align-vertical-space-around');
export const distLeftIcon = lucide('align-horizontal-distribute-start');
export const distTopIcon = lucide('align-vertical-distribute-start');
export const distCenterIcon = lucide('align-horizontal-distribute-center');
export const distMiddleIcon = lucide('align-vertical-distribute-center');
export const distRightIcon = lucide('align-horizontal-distribute-end');
export const distBottomIcon = lucide('align-vertical-distribute-end');

// --- Arrange tab: Order ---
export const bringForwardIcon = lucide('arrow-up-to-line');
export const bringToFrontIcon = lucide('bring-to-front');
export const sendBackwardIcon = lucide('arrow-down-to-line');
export const sendToBackIcon = lucide('send-to-back');

// --- Arrange tab: Size / Rotate / Reflect ---
export const sameSize16Icon = lucide('proportions');
export const rotateCcwIcon = lucide('rotate-ccw');
export const rotateCwIcon = lucide('rotate-cw');
export const rotate180Icon = lucide('refresh-ccw');
export const flipHIcon = lucide('flip-horizontal-2');
export const flipVIcon = lucide('flip-vertical-2');

// --- Tool palette ---
export const toolPaletteIcon = lucide('toolbox');
export const toolChestIcon = lucide('toolbox');

// --- Review tab: Compare / Display ---
export const compareIcon = lucide('git-compare-arrows');
export const readerModeIcon = lucide('book-open-text');
export const keystrokesIcon = lucide('keyboard');

// --- Markup tab: the external editor markup tools (shortcuts PR) ---
export const typewriterIcon = lucide('type');
export const hyperlinkIcon = lucide('link');
export const flagIcon = lucide('flag');
export const snapshotIcon = lucide('camera');
export const formatPainterIcon = lucide('paintbrush');
export const multiplyIcon = lucide('copy-plus');
