import { state, getActiveDocument } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { clearTextSelection } from '../../text/text-selection.js';
import { replaceParentOf } from '../../annotations/corrections/model.js';
import {
  storeShowProperties,
  storeHideProperties,
  storeClosePanel,
  storeShowMultiSelection,
  storeShowTextEditProperties,
  setPropertiesPanelVisible as setPanelVisible,
  setPropertiesPanelCollapsed as setPanelCollapsed,
  isPanelShown,
} from '../../bridge.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Show properties panel for a single annotation. A caller that redraws right
// after (undo/redo) passes { redraw: false }, so the canvas is drawn once.
export function showProperties(annotation, options) {
  clearTextSelection();
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) {
    doc.selectedAnnotation = annotation;
  }
  storeShowProperties(annotation);
  if (options?.redraw !== false) redraw();
}

// Hide properties (deselect annotation, show doc info). { redraw: false } as
// with showProperties.
export function hideProperties(options) {
  const doc = getActiveDocument();
  if (doc) { doc.selectedAnnotation = null; doc.selectedAnnotations = []; }
  storeHideProperties();
  if (options?.redraw !== false) redraw();
}

// Collapse the host that shows the Properties panel (the panel hosts own
// the Properties panel's place, size and collapse).
export function closePropertiesPanel() {
  if (isPanelShown('properties')) {
    import('../../solid/components/panels/panelActions.js').then(m => m.togglePanel('properties'));
  }
}

// Toggle the Properties panel (F12, Alt+P, ribbon): shown → collapse its
// host; otherwise bring it up where it lives (left host in the Oculith profile).
export function togglePropertiesPanel() {
  const opening = !isPanelShown('properties');
  if (opening) {
    setPanelVisible(true);
    setPanelCollapsed(false);
    const _togDoc = getActiveDocument();
    if (_togDoc?.selectedAnnotation) {
      showProperties(_togDoc.selectedAnnotation);
    } else {
      hideProperties();
    }
  }
  import('../../solid/components/panels/panelActions.js').then(m => m.togglePanel('properties'));
}

// Initialize panel — restore visibility from saved preferences
export function initPropertiesPanel() {
  const visible = state.preferences?.propertiesPanelVisible !== false;
  setPanelVisible(visible);
  setPanelCollapsed(false);
}

// Show properties panel for multi-selection
export function showMultiSelectionProperties() {
  clearTextSelection();
  const _multiDoc = getActiveDocument();
  const selected = _multiDoc ? _multiDoc.selectedAnnotations : [];
  if (!selected || selected.length < 2) return;
  // Een vervanging (#508) is één correctie: het paneel van het invoegteken,
  // het paar blijft geselecteerd. Geldt voor elke aanroeper (undo, z-volgorde,
  // opmaak, lagen).
  const ouder = replaceParentOf(selected, _multiDoc?.annotations);
  if (ouder) { showProperties(ouder, { redraw: false }); return; }
  storeShowMultiSelection(selected);
  // A grouped click does not redraw before the drag flag is set, so the
  // Markups List would stay on the previous row until pointer-up.
  import('./annotations-list.js').then((m) => m.updateAnnotationsList()).catch(() => {});
}

// Show text edit properties (PDF text editing mode)
export function showTextEditProperties(info) {
  storeShowTextEditProperties(info);
}

// No-op functions - Solid handles these inline now
export function updateAnnotationProperties() {}
export function updateArrowProperties() {}
export function updateTextFormatProperties() {}
export function updateColorDisplay() {}
