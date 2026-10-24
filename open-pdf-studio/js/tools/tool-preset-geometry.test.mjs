import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDrawingGeometry, captureToolGeometry, cleanToolGeometry } from './tool-preset-geometry.js';

test('Drawing Mode captures a relative line vector and places it at a new point', () => {
  const source = { type: 'arrow', page: 7, id: 'source', subject: 'Private note',
    startX: 125, startY: 80, endX: 45, endY: 140 };
  const geometry = captureToolGeometry(source);
  assert.deepEqual(geometry, { kind: 'line', dx: -80, dy: 60 });
  const placed = applyDrawingGeometry('arrow', { type: 'arrow', page: 2, subject: '', startX: 0, startY: 0 },
    geometry, 300, 400);
  assert.deepEqual(placed, { type: 'arrow', page: 2, subject: '', startX: 300, startY: 400,
    endX: 220, endY: 460 });
  assert.equal(JSON.stringify(geometry).includes('Private'), false);
});

test('Drawing Mode captures only dimensions and rotation for rectangular shapes', () => {
  for (const type of ['box', 'circle', 'highlight', 'cloud']) {
    const geometry = captureToolGeometry({ type, x: 800, y: 900, width: 110, height: 65,
      rotation: 15, contents: 'Do not copy', page: 8 });
    assert.deepEqual(geometry, { kind: 'box', width: 110, height: 65, rotation: 15 });
    assert.deepEqual(applyDrawingGeometry(type, { type, page: 1, x: 0, y: 0 }, geometry, 14, 21),
      { type, page: 1, x: 14, y: 21, width: 110, height: 65, rotation: 15 });
  }
});

test('point-defined clouds retain their contour as source-independent offsets', () => {
  const source = { type: 'cloud', page: 7, id: 'private-id', subject: 'Private note',
    x: 800, y: 900, width: 120, height: 80,
    points: [{ x: 800, y: 900 }, { x: 920, y: 920 },
      { x: 880, y: 980 }, { x: 810, y: 970 }] };
  const geometry = captureToolGeometry(source);
  assert.deepEqual(geometry, { kind: 'points', points: [
    { x: 0, y: 0 }, { x: 120, y: 20 }, { x: 80, y: 80 }, { x: 10, y: 70 },
  ] });
  const placed = applyDrawingGeometry('cloud', { type: 'cloud', page: 2, subject: '' }, geometry, 30, 40);
  assert.deepEqual(placed, { type: 'cloud', page: 2, subject: '', x: 30, y: 40,
    width: 120, height: 80, points: [
      { x: 30, y: 40 }, { x: 150, y: 60 }, { x: 110, y: 120 }, { x: 40, y: 110 },
    ] });
  assert.equal(JSON.stringify(geometry).includes('Private'), false);
  assert.equal(JSON.stringify(geometry).includes('800'), false);
  assert.equal(JSON.stringify(geometry).includes('900'), false);
});

test('invalid or document-specific geometry cannot become a Drawing Mode preset', () => {
  assert.equal(captureToolGeometry({ type: 'highlight', x: 0, y: 0, width: 40, height: 10,
    rects: [{ x: 0, y: 0, width: 40, height: 10 }] }), null);
  assert.equal(captureToolGeometry({ type: 'box', x: 0, y: 0, width: 0, height: 10 }), null);
  assert.equal(captureToolGeometry({ type: 'line', startX: 0, startY: 0, endX: 0, endY: 0 }), null);
  assert.equal(cleanToolGeometry('line', { kind: 'line', dx: 20, dy: 0, page: 3 }), null);
  assert.equal(cleanToolGeometry('box', { kind: 'box', width: 20, height: 30, rotation: 0,
    contents: 'source text' }), null);
  assert.equal(cleanToolGeometry('box', { kind: 'box', width: 1e9, height: 30, rotation: 0 }), null);
  assert.equal(cleanToolGeometry('cloud', { kind: 'points', points: [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10, page: 7 },
  ] }), null);
  assert.equal(cleanToolGeometry('cloud', { kind: 'points', points: [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 },
  ] }), null);
  assert.equal(captureToolGeometry({ type: 'cloud', rotation: 15, points: [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 },
  ] }), null);
});

test('callout Drawing Mode keeps only box and leader offsets from the new arrow tip', () => {
  const source = { type: 'callout', page: 7, id: 'private-id',
    x: 180, y: 120, width: 150, height: 60,
    arrowX: 100, arrowY: 200, kneeX: 140, kneeY: 155,
    armOriginX: 180, armOriginY: 150,
    text: 'PRIVATE NOTE', author: 'PRIVATE AUTHOR', replies: [{ text: 'PRIVATE REPLY' }] };
  const geometry = captureToolGeometry(source);
  assert.deepEqual(geometry, { kind: 'callout', boxDx: 80, boxDy: -80,
    width: 150, height: 60, kneeDx: 40, kneeDy: -45, armDx: 80, armDy: -50 });
  const fresh = { type: 'callout', page: 2, text: '', subject: '' };
  assert.deepEqual(applyDrawingGeometry('callout', fresh, geometry, 300, 400),
    { ...fresh, x: 380, y: 320, width: 150, height: 60,
      arrowX: 300, arrowY: 400, kneeX: 340, kneeY: 355,
      armOriginX: 380, armOriginY: 350 });
  for (const value of ['PRIVATE', '"page"', '"x":180', '"arrowX":100']) {
    assert.equal(JSON.stringify(geometry).includes(value), false);
  }
});

test('callout Drawing Mode rejects malformed and unsafe geometry', () => {
  const valid = { type: 'callout', x: 180, y: 120, width: 150, height: 60,
    arrowX: 100, arrowY: 200, kneeX: 140, kneeY: 155,
    armOriginX: 180, armOriginY: 150 };
  const geometry = captureToolGeometry(valid);
  for (const invalid of [
    { ...valid, rotation: 15 }, { ...valid, flipX: true },
    { ...valid, arrowX: Infinity }, { ...valid, width: 0 },
    { ...valid, armOriginX: 195 }, { ...valid, armOriginY: 210 },
    { ...valid, kneeX: NaN },
  ]) assert.equal(captureToolGeometry(invalid), null);
  for (const invalid of [
    { ...geometry, page: 7 }, { ...geometry, boxDx: Infinity },
    { ...geometry, width: -1 }, { ...geometry, kneeDx: 1e9 },
    { ...geometry, armDx: 81 }, { ...geometry, armDy: 10 },
  ]) assert.equal(cleanToolGeometry('callout', invalid), null);
  assert.equal(cleanToolGeometry('box', geometry), null);
});
