// ============================================================
// Context menu icons
// ============================================================
// Lucide geometry (lucideIcons.js, ISC) and Oculith tool drawings, in the
// shared 24px / currentColor / 1.75 stroke treatment; see ribbonIcons.js.
import { lucide } from './lucideIcons.js';
import { toolIcon } from './oculithToolIcons.js';

// --- Annotation context menu icons ---
export const openPopupIcon = lucide('message-square');
export const hidePopupIcon = lucide('message-square-off');
export const resetPopupIcon = lucide('rotate-ccw');
export const cutIcon = lucide('scissors');
export const copyIcon = lucide('copy');
export const pasteIcon = lucide('clipboard-paste');
export const deleteIcon = lucide('trash-2');
export const flattenIcon = lucide('file-down');
export const addReplyIcon = lucide('message-square-reply');
export const lockedIcon = lucide('lock');
export const unlockedIcon = lucide('lock-open');
export const markedIcon = lucide('bookmark');
export const printableIcon = lucide('printer-check');
export const statusIcon = lucide('circle-check');
export const reviewHistoryIcon = lucide('history');
export const layerIcon = lucide('layers');
export const arrangeIcon = lucide('bring-to-front');
export const flipLineIcon = lucide('arrow-down-up');
export const convertMeasurementIcon = lucide('ruler-dimension-line');
export const convertPolylineIcon = toolIcon('polyline');
export const convertPolygonIcon = lucide('pentagon');
export const styleToolsIcon = lucide('paintbrush');
export const exportIcon = lucide('download');
export const propertiesIcon = lucide('settings');
export const transformIcon = lucide('scaling');
export const duplicateIcon = lucide('copy');

// --- Page context menu icons ---
export const bookmarkIcon = lucide('bookmark');
export const stickyNoteIcon = lucide('sticky-note');
export const imageIcon = lucide('image');
export const qrCodeIcon = lucide('qr-code');
export const handToolIcon = lucide('hand');
export const snapshotIcon = lucide('camera');
export const selectTextPageIcon = lucide('text-cursor');
export const zoomIcon = lucide('zoom-in');
export const pageCutIcon = lucide('scissors');
export const pageCopyIcon = lucide('copy');
export const pagePasteIcon = lucide('clipboard-paste');
export const pageDeleteIcon = lucide('trash-2');
export const selectAllIcon = lucide('square-dashed-mouse-pointer');
export const deselectIcon = lucide('square-x');
export const goToIcon = lucide('arrow-right-to-line');
export const printIcon = lucide('printer');
export const findIcon = lucide('search');
export const searchIcon = lucide('search');

// --- Arrange / transform submenu icons ---
export const bringToFrontSvg = lucide('bring-to-front');
export const sendToBackSvg = lucide('send-to-back');
export const bringForwardSvg = lucide('arrow-up-to-line');
export const sendBackwardSvg = lucide('arrow-down-to-line');
export const rotateLeftSvg = lucide('rotate-ccw');
export const rotateRightSvg = lucide('rotate-cw');
export const flipHorizontalSvg = lucide('flip-horizontal-2');
export const flipVerticalSvg = lucide('flip-vertical-2');
