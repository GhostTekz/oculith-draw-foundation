import { createSignal, createRoot, createEffect } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { recordPropertyChange } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { showProperties } from '../../ui/panels/properties-panel.js';

// ============================================================================
// Image-edit store — drives the contextual "Afbeelding" ribbon tab.
//
// The tab is visible only when the current selection is EXACTLY one image
// annotation (type === 'image'). It exposes:
//   * live filter values (grayscale / brightness / contrast) mirrored from the
//     selected annotation, plus setters that write back + redraw
//   * an interactive crop mode (see js/annotations/image-crop-overlay.js)
//
// Filters are non-destructive: they are stored on the annotation and applied at
// render time (canvas `filter`) and baked into the saved AP stream, exactly
// like the existing non-destructive crop (#212) and tint.
// ============================================================================

// Whether exactly one image annotation is selected (drives tab visibility).
const [imageSelected, setImageSelected] = createSignal(false);

// Interactive crop mode active (canvas crop overlay installed).
const [cropModeActive, setCropModeActive] = createSignal(false);

// Mirrored filter values of the selected image (defaults = neutral).
const [grayscale, setGrayscaleSig] = createSignal(false);
const [brightness, setBrightnessSig] = createSignal(100); // percent, 100 = neutral
const [contrast, setContrastSig] = createSignal(100);     // percent, 100 = neutral

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// The single selected image annotation, or null.
export function selectedImageAnnotation() {
  const doc = getActiveDocument();
  const sel = doc ? doc.selectedAnnotations : [];
  if (sel && sel.length === 1 && sel[0].type === 'image') return sel[0];
  return null;
}

// Called from updateContextualTabs() whenever the selection changes. Keeps the
// tab visibility + mirrored filter values in sync with the selection.
export function syncImageEditStore(selectedAnnotations) {
  const isSingleImage = !!(selectedAnnotations && selectedAnnotations.length === 1 &&
    selectedAnnotations[0].type === 'image');
  setImageSelected(isSingleImage);
  if (isSingleImage) {
    const ann = selectedAnnotations[0];
    setGrayscaleSig(!!ann.grayscale);
    setBrightnessSig(Math.round((ann.brightness ?? 1) * 100));
    setContrastSig(Math.round((ann.contrast ?? 1) * 100));
  }
}

// Write a filter change back to the selected image with a single undo step.
function applyToImage(applyFn) {
  const ann = selectedImageAnnotation();
  if (!ann || ann.locked) return;
  recordPropertyChange(ann);
  applyFn(ann);
  ann.modifiedAt = new Date().toISOString();
  showProperties(ann);
  redraw();
}

export function toggleGrayscale() {
  const next = !grayscale();
  setGrayscaleSig(next);
  applyToImage(ann => { ann.grayscale = next || undefined; });
}

export function setBrightness(pct) {
  const clamped = Math.max(0, Math.min(200, Math.round(pct)));
  setBrightnessSig(clamped);
  applyToImage(ann => {
    const v = clamped / 100;
    ann.brightness = v === 1 ? undefined : v;
  });
}

export function setContrast(pct) {
  const clamped = Math.max(0, Math.min(200, Math.round(pct)));
  setContrastSig(clamped);
  applyToImage(ann => {
    const v = clamped / 100;
    ann.contrast = v === 1 ? undefined : v;
  });
}

// Reset all image adjustments (grayscale + brightness + contrast) to neutral.
export function resetImageAdjustments() {
  setGrayscaleSig(false);
  setBrightnessSig(100);
  setContrastSig(100);
  applyToImage(ann => {
    ann.grayscale = undefined;
    ann.brightness = undefined;
    ann.contrast = undefined;
  });
}

// Toggle interactive crop mode. Lazy-imports the overlay module so the store
// stays free of DOM/pointer wiring.
export function toggleCropMode() {
  if (cropModeActive()) {
    stopCropMode();
  } else {
    startCropMode();
  }
}

export async function startCropMode() {
  if (!selectedImageAnnotation()) return;
  const m = await import('../../annotations/image-crop-overlay.js');
  if (m.startImageCrop(selectedImageAnnotation())) {
    setCropModeActive(true);
  }
}

export async function stopCropMode(commit = true) {
  const m = await import('../../annotations/image-crop-overlay.js');
  m.stopImageCrop(commit);
  setCropModeActive(false);
}

// Leaving the image selection (or deselecting) must cancel any live crop mode
// so the overlay handlers don't linger. The tab fallback itself is handled
// centrally in updateContextualTabs() (restores the previous non-contextual
// tab) with a safety net in ribbonStore, so we don't force 'home' here.
createRoot(() => {
  createEffect(() => {
    if (!imageSelected()) {
      if (cropModeActive()) stopCropMode(false);
    }
  });
});

export {
  imageSelected,
  cropModeActive,
  grayscale,
  brightness,
  contrast,
};
