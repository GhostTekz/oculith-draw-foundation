// Visual Search results → page geometry and markups. Raster matches
// (matcher.js) are in search-raster pixels, which are the annotation model
// space (page points, top-left of the visible CropBox, page rotation
// applied) times the raster scale; see page-raster.js.

import { createAnnotation } from '../../annotations/factory.js';

/**
 * A raster match as a result on `page` in app (annotation) points.
 * @param {{x:number,y:number,width:number,height:number,score:number,rotation:number,scale:number}} m
 * @param {number} page
 * @param {number} scale  raster px per point
 */
export function matchToResult(m, page, scale) {
  return {
    page,
    x: m.x / scale,
    y: m.y / scale,
    width: m.width / scale,
    height: m.height / scale,
    score: m.score,
    rotation: m.rotation,
    scale: m.scale,
  };
}

/** Centre of a result (where its count marker goes). */
export const resultCentre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Results at or above `threshold` that are not excluded. */
export function chosenResults(results, threshold) {
  return results.filter((r) => r.score >= threshold && r.included !== false);
}

/**
 * Reading order: page, then rows top to bottom, then left to right. A row
 * starts at the topmost remaining symbol and takes every symbol whose centre
 * lies within one symbol height below it, so a slightly uneven row still
 * reads left to right.
 */
export function inReadingOrder(results) {
  const out = [];
  const pages = [...new Set(results.map((r) => r.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const rest = results.filter((r) => r.page === page)
      .map((r) => ({ r, c: resultCentre(r) }))
      .sort((a, b) => a.c.y - b.c.y);
    while (rest.length) {
      const top = rest[0];
      const reach = top.c.y + Math.max(top.r.height, 1);
      const row = [];
      while (rest.length && rest[0].c.y <= reach) row.push(rest.shift());
      row.sort((a, b) => a.c.x - b.c.x);
      for (const e of row) out.push(e.r);
    }
  }
  return out;
}

/**
 * Count markers for `results` in `category` (countStore shape), numbered from
 * `firstNumber` in reading order.
 */
export function countAnnotationsFor(results, category, firstNumber = 1, subject = '') {
  return inReadingOrder(results).map((r, i) => {
    const c = resultCentre(r);
    const ann = createAnnotation({
      type: 'count',
      page: r.page,
      x: c.x,
      y: c.y,
      categoryId: category?.id || null,
      number: firstNumber + i,
      markerStyle: category?.markerStyle || 'dot',
      color: category?.color || '#e11d48',
      strokeColor: category?.color || '#e11d48',
      opacity: 1,
    });
    if (category?.symbolId) ann.symbolId = category.symbolId;
    if (subject) ann.subject = subject;
    return ann;
  });
}

/** Rectangle highlight markups over `results`. */
export function highlightAnnotationsFor(results, color = '#ffff00', subject = '') {
  return inReadingOrder(results).map((r) => {
    const ann = createAnnotation({
      type: 'highlight',
      page: r.page,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      color,
      fillColor: color,
    });
    if (subject) ann.subject = subject;
    return ann;
  });
}
