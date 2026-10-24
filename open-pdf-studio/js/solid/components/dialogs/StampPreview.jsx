import { createEffect, createSignal } from 'solid-js';
import { drawStampDesign } from '../../../annotations/stamp-draw.js';
import { stampDesignSize } from '../../../annotations/stamp-layout.js';

/**
 * A stamp design drawn with the canvas renderer (the same drawing as on the
 * page), scaled to fit maxWidth × maxHeight CSS pixels.
 */
export default function StampPreview(props) {
  let canvas;
  const [imageTick, setImageTick] = createSignal(0);
  createEffect(() => {
    imageTick();
    const design = props.design;
    if (!canvas || !design) return;
    const size = stampDesignSize(design);
    const scale = Math.min((props.maxWidth || 160) / size.width, (props.maxHeight || 60) / size.height,
      props.maxScale || 2.5);
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.round(size.width * scale));
    const cssH = Math.max(1, Math.round(size.height * scale));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / size.width, 0, 0, canvas.height / size.height, 0, 0);
    drawStampDesign(ctx, design, size.width, size.height, { onImageLoad: () => setImageTick(v => v + 1) });
  });
  return <canvas ref={canvas} class={`stamp-preview-canvas ${props.class || ''}`} aria-hidden="true" />;
}
