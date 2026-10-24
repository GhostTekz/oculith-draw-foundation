import { onMount, createEffect } from 'solid-js';
import { layoutLineStyle } from '../../../annotations/line-styles.js';
import { drawLineStyleLayout } from '../../../annotations/rendering/line-style-draw.js';

// A small canvas sample of a line style: a straight run, a bend and a
// descending run, so text readability and corners show. Drawn at the
// style's real size in page points (1 pt = 1 CSS px).
export function previewPath(width, height) {
  const m = 10;
  if (height < 40) return [{ x: m, y: height / 2 }, { x: width - m, y: height / 2 }];
  return [
    { x: m, y: height * 0.35 }, { x: width * 0.45, y: height * 0.35 },
    { x: width * 0.6, y: height * 0.75 }, { x: width - m, y: height * 0.75 },
  ];
}

export default function LineStylePreview(props) {
  let canvas;
  const draw = () => {
    if (!canvas) return;
    const w = props.width || 220, h = props.height || 28;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const style = typeof props.style === 'function' ? props.style() : props.style;
    if (!style) return;
    const layout = layoutLineStyle(style, previewPath(w, h), { lineWidth: props.lineWidth || 1 });
    const color = props.color || getComputedStyle(canvas).color || '#000';
    drawLineStyleLayout(ctx, layout, color);
  };
  onMount(draw);
  createEffect(() => {
    // Track the style (and its nested fields) for a redraw.
    const style = typeof props.style === 'function' ? props.style() : props.style;
    JSON.stringify(style);
    void props.color; void props.width; void props.height;
    draw();
  });
  return <canvas ref={canvas} class={`ls-preview ${props.class || ''}`} aria-hidden="true" />;
}
