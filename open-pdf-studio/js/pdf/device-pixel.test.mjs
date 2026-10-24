import assert from 'node:assert/strict';
import test from 'node:test';
import { snapNaarDevicePixel, regioOpRenderRaster, tekenKwaliteit } from './device-pixel.js';

test('offsets snap to whole device pixels at dpr 1, 1.25, 1.5, 2', () => {
  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const v of [0, 0.3, -17.77, 123.4567, 845.1]) {
      const s = snapNaarDevicePixel(v, dpr);
      const px = s * dpr;
      assert.ok(Math.abs(px - Math.round(px)) < 1e-9, `${v}@${dpr}`);
      assert.ok(Math.abs(s - v) <= 0.5 / dpr + 1e-9, 'moves less than half a device pixel');
      assert.equal(snapNaarDevicePixel(s, dpr), s, 'idempotent');
    }
  }
});

test('a tile region lands on its render grid and still covers the request', () => {
  const schaal = 4.37;
  const regio = { x: 101.23, y: 57.9, w: 333.3, h: 211.1 };
  const r = regioOpRenderRaster(regio, schaal, 3024, 2160);
  for (const v of [r.x * schaal, r.y * schaal, r.w * schaal, r.h * schaal]) {
    assert.ok(Math.abs(v - Math.round(v)) < 1e-6);
  }
  assert.ok(r.x <= regio.x && r.y <= regio.y);
  assert.ok(r.x + r.w >= regio.x + regio.w - 1e-9 && r.y + r.h >= regio.y + regio.h - 1e-9);
  // Clamped to the page.
  const rand = regioOpRenderRaster({ x: 3000, y: 2100, w: 100, h: 100 }, schaal, 3024, 2160);
  assert.ok(rand.x + rand.w <= Math.ceil(3024 * schaal) / schaal + 1e-9);
});

test('downscaled bitmaps get the high-quality filter, 1:1 and upscale do not', () => {
  assert.equal(tekenKwaliteit(6, 4), 'high');
  assert.equal(tekenKwaliteit(4, 4), null);
  assert.equal(tekenKwaliteit(2, 4), null);
});

test('backing size follows the exact device-pixel box when it belongs to the CSS size', async () => {
  const { backingMaat } = await import('./device-pixel.js');
  assert.deepEqual(backingMaat({ cssW: 855, cssH: 697, dpr: 1.25 }), { w: 1069, h: 871 });
  // Compositor snapped the box down (element at a fractional position).
  assert.deepEqual(backingMaat({ cssW: 855, cssH: 697, dpr: 1.25, deviceBox: { w: 1068, h: 872, cssW: 855, cssH: 697 } }), { w: 1068, h: 872 });
  // Stale box from before a resize: ignored.
  assert.deepEqual(backingMaat({ cssW: 900, cssH: 697, dpr: 1.25, deviceBox: { w: 1068, h: 872, cssW: 855, cssH: 697 } }), { w: 1125, h: 871 });
  // Box from another dpr (monitor change in flight): ignored.
  assert.deepEqual(backingMaat({ cssW: 855, cssH: 697, dpr: 2, deviceBox: { w: 1068, h: 872, cssW: 855, cssH: 697 } }), { w: 1710, h: 1394 });
});

test('continuous view renders at zoom x dpr up to the axis cap', async () => {
  const { doorlopendeRenderSchaal } = await import('./device-pixel.js');
  // 42 x 30 in sheet (3024 pt) at fit width 0.4: 1210 CSS px.
  assert.equal(doorlopendeRenderSchaal(0.4, 1209.6, 1, 4096), 0.4);
  assert.equal(doorlopendeRenderSchaal(0.4, 1209.6, 1.5, 4096), 0.4 * 1.5);
  assert.equal(doorlopendeRenderSchaal(0.4, 1209.6, 2, 4096), 0.8);
  // At 150 % the dpr-2 render would be 9072 px: capped to 4096 px.
  const s = doorlopendeRenderSchaal(1.5, 4536, 2, 4096);
  assert.ok(Math.abs(3024 * s - 4096) < 1e-6);
});
