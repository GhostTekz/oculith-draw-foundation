// cloneAnnotation runs on every drag, resize and G-move frame. It shares an
// image data URL or stamp SVG instead of serialising it, and is otherwise
// the same deep JSON copy as before, key order included.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { createMutable } = await import('solid-js/store');
const { cloneAnnotation } = await import('./factory.js');

const jsonCopy = (a) => JSON.parse(JSON.stringify(a));
const bigImage = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`;

function imageMarkup() {
  return {
    id: 'img-1', type: 'image', page: 2, x: 10, y: 20, width: 300, height: 200,
    imageData: bigImage, rotation: 0, missing: undefined, nan: NaN,
    points: [{ x: 1, y: 2 }], meta: { layer: 'A', tags: ['x'] }, stampSvg: '<svg/>',
  };
}

test('a markup with a large image clones like the JSON copy, sharing the image', () => {
  const a = imageMarkup();
  const c = cloneAnnotation(a);
  assert.equal(JSON.stringify(c), JSON.stringify(jsonCopy(a)), 'same content and key order');
  assert.deepEqual(Object.keys(c), Object.keys(jsonCopy(a)));
  assert.equal(c.imageData, a.imageData);
  assert.equal(Object.hasOwn(c, 'missing'), false, 'undefined values are dropped, as before');
  assert.equal(c.nan, null);

  c.points[0].x = 99;
  c.meta.tags.push('y');
  assert.equal(a.points[0].x, 1, 'nested data is still a deep copy');
  assert.deepEqual(a.meta.tags, ['x']);
});

test('small strings and markups without images take the plain JSON path', () => {
  const plain = { id: 'l', type: 'line', startX: 1, startY: 2, endX: 3, endY: 4, stampSvg: '<svg/>' };
  assert.deepEqual(cloneAnnotation(plain), jsonCopy(plain));
  assert.equal(cloneAnnotation(null), null);
});

test('a store proxy clones to plain data', () => {
  const store = createMutable({ list: [imageMarkup()] });
  const c = cloneAnnotation(store.list[0]);
  assert.equal(JSON.stringify(c), JSON.stringify(jsonCopy(store.list[0])));
  assert.equal(c.imageData, bigImage);
});

test('a frame of drag clones no longer pays for the image', () => {
  const a = imageMarkup();
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) cloneAnnotation(a);
  const shared = (performance.now() - t0) / 20;
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) jsonCopy(a);
  const copied = (performance.now() - t1) / 20;
  assert.ok(shared * 5 < copied, `shared ${shared.toFixed(3)} ms vs copied ${copied.toFixed(3)} ms`);
});
