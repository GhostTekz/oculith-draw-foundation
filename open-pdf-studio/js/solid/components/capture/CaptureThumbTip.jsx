import { createSignal, Show, For } from 'solid-js';
import { Portal } from 'solid-js/web';
import { capturePhotos, attachmentNames } from '../../../annotations/capture.js';
import { findAnnotation } from '../../../annotations/capture-actions.js';

// Thumbnail tooltip for the Markups List Attachments cell: up to four photo
// thumbnails and the attachment names, next to the hovered cell.
const [tip, setTip] = createSignal(null);

export function showCaptureTip(annotationId, event) {
  const ann = findAnnotation(annotationId);
  const names = ann ? attachmentNames(ann) : [];
  if (!names.length) { setTip(null); return; }
  const rect = event.currentTarget.getBoundingClientRect();
  const x = rect.right + 276 < window.innerWidth ? rect.right + 6 : Math.max(4, rect.left - 270);
  const y = Math.max(4, Math.min(rect.top, window.innerHeight - 160));
  setTip({ x, y, photos: capturePhotos(ann).slice(0, 4), names: names.join('; ') });
}

export function hideCaptureTip() {
  setTip(null);
}

export default function CaptureThumbTip() {
  return (
    <Show when={tip()}>
      <Portal>
        <div class="capture-thumb-tip" role="tooltip" style={{ left: `${tip().x}px`, top: `${tip().y}px` }}>
          <For each={tip().photos}>{(photo) => <img src={photo.dataUrl} alt={photo.name} />}</For>
          <div class="capture-thumb-names">{tip().names}</div>
        </div>
      </Portal>
    </Show>
  );
}
