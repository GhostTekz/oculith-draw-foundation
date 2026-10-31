import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 layers');
const [emptyMessage, setEmptyMessage] = createSignal('No layers in this document');
// The drawing-layer view differs from the PDF's default layer visibility.
const [layerViewDiffers, setLayerViewDiffers] = createSignal(false);
// Why the drawing layers cannot be switched in this document (a
// native-ocg-support.js reason), or null.
const [layerViewUnsupported, setLayerViewUnsupported] = createSignal(null);

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  layerViewDiffers, setLayerViewDiffers,
  layerViewUnsupported, setLayerViewUnsupported,
};
