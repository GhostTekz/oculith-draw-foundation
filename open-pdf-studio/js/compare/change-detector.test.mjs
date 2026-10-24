import assert from 'node:assert/strict';
import test from 'node:test';
import { detectChanges } from './change-detector.js';

function paper(width = 20, height = 20) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set([255, 255, 255, 255], index);
  return { width, height, data };
}

function block(image, rgb, left = 4, top = 5, size = 9) {
  for (let y = top; y < top + size; y++) {
    for (let x = left; x < left + size; x++) {
      image.data.set([...rgb, 255], (y * image.width + x) * 4);
    }
  }
  return image;
}

test('blue plan content added on white paper is a visual change', () => {
  const oldPage = paper();
  const newPage = block(paper(), [36, 94, 158]);
  assert.deepEqual(detectChanges(oldPage, newPage), [{
    type: 'added', x: 4, y: 5, width: 9, height: 9, pixelCount: 81,
  }]);
});

test('removed blue content and unchanged blue content retain their classifications', () => {
  const blue = block(paper(), [36, 94, 158]);
  assert.equal(detectChanges(blue, paper())[0]?.type, 'removed');
  assert.deepEqual(detectChanges(blue, block(paper(), [36, 94, 158])), []);
});

test('a substantial ink color change is modified, while rendering noise is ignored', () => {
  const blue = block(paper(), [36, 94, 158]);
  const red = block(paper(), [190, 45, 45]);
  assert.equal(detectChanges(blue, red)[0]?.type, 'modified');
  const nearBlue = block(paper(), [45, 101, 166]);
  assert.deepEqual(detectChanges(blue, nearBlue), []);
  assert.deepEqual(detectChanges(paper(), block(paper(), [245, 245, 245])), []);
});
